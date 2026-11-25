import type {PhoneCallingLanguage,PhoneCallingReport,PhoneCallingState} from '@thaara/contracts';

export const AI_DISCLOSURES:Record<PhoneCallingLanguage,string>={
 'en-IN':"Hello, I am Thaara, an AI assistant. Is now a good time to talk?",
 'kn-IN':'ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ, AI ಸಹಾಯಕಿ. ಈಗ ಮಾತನಾಡಲು ಅನುಕೂಲವೇ?',
 // Kanglish is written Bengaluru-style: Kannada words in Kannada script, English words in English. Romanised Kannada
 // reads back badly through Indian TTS models, and mixed script is how the Thaara persona spec writes Kanglish.
 'kn-en':'ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ, AI assistant. ಈಗ ಮಾತಾಡೋಕೆ convenient ಆಗುತ್ತಾ?'
};
/** The owner's display name as it may be spoken: letters (any script), spaces, dot, apostrophe, hyphen; max 40. */
export const ON_BEHALF_OF_PATTERN=/^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,39}$/u;
export function safeOnBehalfOf(name:unknown):string|undefined{
 if(typeof name!=='string')return undefined;
 const n=name.normalize('NFC').replace(/\s+/g,' ').trim();
 return ON_BEHALF_OF_PATTERN.test(n)?n:undefined;
}
/**
 * The fixed AI introduction. With an owner name it says who Thaara is calling for — truthfully, as an AI assistant acting for
 * that person, never as that person.
 */
export function buildAiDisclosure(language:PhoneCallingLanguage,onBehalfOf?:string):string{
 const name=safeOnBehalfOf(onBehalfOf);
 if(!name)return AI_DISCLOSURES[language];
 if(language==='en-IN')return `Hello, I am Thaara, an AI assistant calling on behalf of ${name}. Is now a good time to talk?`;
 if(language==='kn-IN')return `ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ, ${name} ಅವರ ಪರವಾಗಿ ಕರೆ ಮಾಡುತ್ತಿರುವ AI ಸಹಾಯಕಿ. ಈಗ ಮಾತನಾಡಲು ಅನುಕೂಲವೇ?`;
 return `ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ, ${name} ಅವರ ಪರವಾಗಿ call ಮಾಡ್ತಿರೋ AI assistant. ಈಗ ಮಾತಾಡೋಕೆ convenient ಆಗುತ್ತಾ?`;
}
/** Bounded offline conversation controller. Speech/LLM engines may propose text but cannot authorize tools. */
export class PhoneConversation{
 private turns=new Map<string,string>();
 outputGeneration=0;
 constructor(readonly language:PhoneCallingLanguage,readonly purpose:string,readonly maxDurationSeconds:number,readonly onBehalfOf?:string){
  if(!Object.hasOwn(AI_DISCLOSURES,language)||!purpose.trim()||purpose.length>10000||!Number.isSafeInteger(maxDurationSeconds)||maxDurationSeconds<30||maxDurationSeconds>300
   ||(onBehalfOf!==undefined&&safeOnBehalfOf(onBehalfOf)!==onBehalfOf))throw Error('Invalid conversation');
 }
 opening(){return buildAiDisclosure(this.language,this.onBehalfOf);}
 approvedQuestion(){return this.purpose;}
 interrupt(){this.outputGeneration++;}
 acceptOutput(generation:number,text:string){return generation===this.outputGeneration&&typeof text==='string'&&text.length>0&&text.length<=2000;}
 receive(input:{id:string;text:string;final:boolean}){
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(input.id)||typeof input.text!=='string'||input.text.length>1000||!input.text.trim())throw Error('Invalid recipient evidence');
  if(!input.final)return;
  const old=this.turns.get(input.id);
  if(old!==undefined){if(old!==input.text)throw Error('Conflicting evidence');return;}
  if(this.turns.size>=12)throw Error('Conversation evidence limit');
  this.turns.set(input.id,input.text);
 }
 report(state:PhoneCallingState):PhoneCallingReport{
  const quotedResponses=[...this.turns.values()],evidenceIds=[...this.turns.keys()];
  const text=`Simulation only; no real call was made. Call state: ${state}. `+(quotedResponses.length?`Recipient's final words (untrusted quotes): ${quotedResponses.map(t=>JSON.stringify(t)).join('; ')}. No agreement or attendance is inferred.`:'No final recipient response is available; no conversation outcome can be confirmed.');
  return {text,spokenText:text,quotedResponses,evidenceIds,verified:false,simulated:true};
 }
}
