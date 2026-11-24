import type {FastifyInstance} from 'fastify';
import {Static} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import {ChatVoiceTranscribeSchema,ChatVoiceSpeakSchema,ChatVoiceTranscriptSchema,ChatVoiceAudioSchema} from '@thaara/contracts';
import {ConversationRepository,AuditEventRepository,type TransactionalDbClient} from '@thaara/db';
import type {ChatSpeech} from '../services/chat-voice-sarvam.js';
import {decodeVoiceBase64,sanitizeChatVoiceTranscript,validateVoiceWave} from '../services/chat-voice-sarvam.js';
import {asksForDetailedVoiceExplanation} from '../services/chat-voice-consultant.js';

function cleanMarkdownForSpeech(raw:string):string{
 const cleaned=raw
  .replace(/```[\w-]*\n?([\s\S]*?)```/g,'$1')
  .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g,'$1')
  .replace(/https?:\/\/(?:drive|docs)\.google\.com\/\S+/gi,'Google Drive link shown in Chat')
  .replace(/https?:\/\/([^\s/)]+)\S*/gi,'$1')
  .replace(/^#{1,6}\s+/gm,'')
  .replace(/(\*\*|__)(.*?)\1/g,'$2')
  .replace(/`([^`]+)`/g,'$1')
  .replace(/^\s*[-*•]\s+/gm,'')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'')
  .replace(/\(\s*(?:Stream ID|Approval ID|Plan ID)\s*:\s*\)/gi,'')
  .replace(/[\u0400-\u05FF\u0600-\u06FF\u0750-\u077F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g,' ')
  .replace(/[ \t]{2,}/g,' ')
  .replace(/\n{3,}/g,'\n\n')
  .trim();
 return cleaned||raw.trim();
}

const SAFETY_OR_APPROVAL_SENTENCE_RE=/\b(?:awaiting\s+approval|requires?\s+approval|confirm|confirmation|not\s+been\s+sent|not\s+sent|not\s+executed|warning|caution|permission|failed|unverified)\b/i;

/**
 * Keeps spoken playback concise for long emails/Drive reports unless the user asked for full detail,
 * while always preserving any approval/safety notice and the final spoken question. Stored Chat text is never modified.
 */
export function shapeSpokenTextForVoice(raw:string,precedingUserText?:string):string{
 const cleaned=cleanMarkdownForSpeech(raw);
 if(!cleaned)return '';
 const wantsDetail=Boolean(precedingUserText&&asksForDetailedVoiceExplanation(precedingUserText));
 if(wantsDetail||cleaned.length<=500)return cleaned;

 const sentences=cleaned.split(/(?<=[.?!।])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
 const picked:string[]=[];
 let total=0;
 for(const s of sentences){
  if(picked.length>=2&&total+s.length>340)break;
  picked.push(s);
  total+=s.length+1;
  if(picked.length>=3||total>=320)break;
 }
 const rest=sentences.slice(picked.length);
 const safetyLine=rest.find(s=>SAFETY_OR_APPROVAL_SENTENCE_RE.test(s));
 if(safetyLine&&!picked.some(p=>SAFETY_OR_APPROVAL_SENTENCE_RE.test(p))){
  picked.push(safetyLine.slice(0,220));
 }
 const lastSentence=sentences[sentences.length-1];
 const trailingQuestion=lastSentence&&/[?؟]$/.test(lastSentence)&&!picked.includes(lastSentence)?lastSentence.slice(0,220):undefined;
 let summary=picked.join(' ').trim();
 if(!summary)summary=cleaned.slice(0,380).trim();
 if(!/[.?!।]$/.test(summary))summary+='.';
 const isKn=/[\u0C80-\u0CFF]/.test(summary),isHi=!isKn&&/[\u0900-\u097F]/.test(summary);
 const suffix=isKn
  ?' ಪೂರ್ತಿ ವಿವರಗಳು ಚಾಟ್‌ನಲ್ಲಿವೆ.'
  :isHi
   ?' पूरी जानकारी चैट में उपलब्ध है।'
   :' The full details are in Chat if you would like more.';
 return trailingQuestion?`${summary}${suffix} ${trailingQuestion}`:summary+suffix;
}

/** Formats persisted assistant Markdown into natural spoken sentences without altering stored Chat content. */
export function prepareSpeechChunks(raw:string):string[]{
 const text=cleanMarkdownForSpeech(raw);
 if(!text)return[];
 if(text.length<=550)return[text];
 const chunks:string[]=[];
 let remaining=text;
 while(remaining.length>0){
  const maxLen=chunks.length===0?500:2200;
  if(remaining.length<=maxLen){chunks.push(remaining.trim());break;}
  const slice=remaining.slice(0,maxLen);
  let cut=Math.max(slice.lastIndexOf('. '),slice.lastIndexOf('? '),slice.lastIndexOf('! '),slice.lastIndexOf('। '),slice.lastIndexOf('\n'));
  if(cut>=Math.floor(maxLen*0.35))cut+=1;
  else{
   cut=slice.lastIndexOf(' ');
   if(cut<Math.floor(maxLen*0.35))cut=maxLen;
  }
  const part=remaining.slice(0,cut).trim();
  if(part)chunks.push(part);
  remaining=remaining.slice(cut).trim();
 }
 return chunks;
}

export async function chatVoiceRoutes(app:FastifyInstance,options:{db:TransactionalDbClient;speech:ChatSpeech}){
 const conversations=new ConversationRepository(options.db),buckets=new Map<string,{at:number;count:number;active:number}>();
 const failure=(reply:any,status:number,code:string,message:string)=>reply.code(status).send({error:{code,message}});
 app.get('/chat/voice/status',{preHandler:[app.requireAuth]},async()=>({configured:options.speech.configured,mode:'turn_based',languages:['auto','en-IN','kn-IN','hi-IN']}));
 for(const operation of ['transcribe','speak'] as const){
  const schema=operation==='transcribe'?ChatVoiceTranscribeSchema:ChatVoiceSpeakSchema;
  app.post<{Body:Static<typeof ChatVoiceTranscribeSchema>|Static<typeof ChatVoiceSpeakSchema>}>('/chat/voice/'+operation,{
   bodyLimit:1_400_000,logLevel:'silent',preHandler:[app.requireAuth],
   preValidation:async(request,reply)=>{if(!Value.Check(schema,request.body))return failure(reply,400,'VOICE_INPUT_INVALID','Invalid voice request.');},
   schema:{body:schema,response:{200:operation==='transcribe'?ChatVoiceTranscriptSchema:ChatVoiceAudioSchema}},
  },async(request,reply)=>{
   reply.header('Cache-Control','no-store');const scope=request.scope!;
   const body=request.body,conversation=await conversations.findById(scope,body.conversationId);
   if(!conversation||conversation.status!=='active')return failure(reply,404,'VOICE_CONVERSATION_UNAVAILABLE','Conversation unavailable.');
   if(!options.speech.configured)return failure(reply,503,'VOICE_NOT_CONFIGURED','Voice is not configured by the server administrator.');
   const key=scope.workspaceId+':'+scope.userId,now=Date.now();
   for(const[k,b]of buckets)if(b.active===0&&now-b.at>60000)buckets.delete(k);
   let bucket=buckets.get(key);if(!bucket){if(buckets.size>=256)return failure(reply,429,'VOICE_BUSY','Voice is busy. Try again shortly.');bucket={at:now,count:0,active:0};buckets.set(key,bucket);}
   else if(now-bucket.at>60000){bucket.at=now;bucket.count=0;}
   if(bucket.active>=4||bucket.count>=120)return failure(reply,429,'VOICE_RATE_LIMITED','Please wait before another voice request.');
   bucket.active++;bucket.count++;
   const abort=new AbortController(),cancel=()=>{if(!reply.raw.writableEnded)abort.abort();};request.raw.once('aborted',cancel);reply.raw.once('close',cancel);
   try{
    let result;
    if(operation==='transcribe'){
     const input=body as Static<typeof ChatVoiceTranscribeSchema>;
     const audio=decodeVoiceBase64(input.audio);validateVoiceWave(audio);
     if(options.speech.transcribeWithLanguage){
      const rawRes=await options.speech.transcribeWithLanguage(audio,input.mimeType,input.language,abort.signal);
      result=sanitizeChatVoiceTranscript(rawRes.transcript,input.language,rawRes.detectedLanguage);
     }else{
      const transcript=await options.speech.transcribe(audio,input.mimeType,input.language,abort.signal);
      result=sanitizeChatVoiceTranscript(transcript,input.language);
     }
     if(!result.transcript){
      return result;
     }
    }else{
     const input=body as Static<typeof ChatVoiceSpeakSchema>;
     const rows=await options.db.withScopedTransaction(scope,async tx=>(await tx.query<{content:string;prev_user_content?:string|null}>(`SELECT m.content,
      (SELECT u.content FROM public.conversation_messages u
       WHERE u.workspace_id=m.workspace_id AND u.user_id=m.user_id AND u.conversation_id=m.conversation_id
         AND u.sender_type='user' AND u.sequence_number<m.sequence_number
       ORDER BY u.sequence_number DESC LIMIT 1) AS prev_user_content
      FROM public.conversation_messages m
      WHERE m.id=$1 AND m.workspace_id=$2 AND m.user_id=$3 AND m.conversation_id=$4 AND m.sender_type='assistant'
      AND m.created_at>COALESCE((SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id=$2 AND user_id=$3),'-infinity'::timestamptz)`,[input.messageId,scope.workspaceId,scope.userId,input.conversationId])).rows);
     if(rows.length!==1)return failure(reply,404,'VOICE_MESSAGE_UNAVAILABLE','Assistant response unavailable.');
     const rawText=rows[0]!.content,prevUser=rows[0]!.prev_user_content??undefined;
     const shaped=shapeSpokenTextForVoice(rawText,prevUser);
     if(shaped.length>19200)return failure(reply,400,'VOICE_RESPONSE_TOO_LONG','This response is too long for voice. Please read it in Chat.');
     const chunks=prepareSpeechChunks(shaped);
     if(!chunks.length||chunks.length>8)return failure(reply,400,'VOICE_RESPONSE_TOO_LONG','This response is too long for voice. Please read it in Chat.');
     if(input.chunk>=chunks.length)return failure(reply,400,'VOICE_CHUNK_INVALID','Response audio unavailable.');
     result={audio:await options.speech.speak(chunks[input.chunk]!,input.language,abort.signal),mimeType:'audio/wav' as const,chunkCount:chunks.length};
    }
    if(abort.signal.aborted)return;
    await options.db.withScopedTransaction(scope,async tx=>{await new AuditEventRepository(tx).create(scope.workspaceId,'chat.voice.'+operation,'conversation',{language:body.language},scope.userId,body.conversationId);});
    return result;
   }catch{return failure(reply,503,'VOICE_SERVICE_UNAVAILABLE','Speech service unavailable. Please try again.');}
   finally{bucket.active--;request.raw.removeListener('aborted',cancel);reply.raw.removeListener('close',cancel);}
  });
 }
}
