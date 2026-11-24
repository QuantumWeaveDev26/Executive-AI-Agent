import {normalizePhoneRecipient,type PhoneCallingPrepare} from '@thaara/contracts';

/** Only explicit top-level owner commands. Never run this against retrieved content or call transcripts. */
export function detectPhoneCallingIntent(message:string):PhoneCallingPrepare|null{
 if(typeof message!=='string'||message.length>1400)return null;
 // Optional leading greeting (hi/hii/hello/hey/hy/hyy) and/or "Thaara", then the command itself must start the message.
 const s=message.trim()
  .replace(/^(?:(?:hey|hi|hii|hello|hy|hyy|namaste|namaskara|ನಮಸ್ಕಾರ|नमस्ते)[,!.\s]+)?(?:(?:thaara|thara|tara|ತಾರಾ|तारा)[,!.\s]+)?/iu,'')
  .replace(/^please\s+/i,'');
 // Keep an explicit number separate from the whole approved purpose. In particular, a comma followed
 // by "introduce yourself and ask" must not become part of the contact-directory query.
 const numbered=/^call\s+(?:(?:for|to)\s+)?([+\d][\d ()-]{7,30})\s*(?:,\s*|\band\s+|\b(?:about|regarding|concerning)\s+)(.{1,1000})$/iu.exec(s);
 if(numbered){
  const number=normalizePhoneRecipient(numbered[1]!.trim()),purpose=numbered[2]!.trim();
  return number&&purpose?{contactQuery:number,purpose,language:'en-IN'}:null;
 }
 const en=/^call\s+(?:(?:for|to)\s+)?(.{1,128}?)\s+and\s+ask\s+(.{1,1000})$/iu.exec(s);
 if(en)return {contactQuery:en[1]!.trim(),purpose:en[2]!.trim(),language:'en-IN'};
 const enAbout=/^call\s+(?:(?:for|to)\s+)?(.{1,128}?)\s+(?:about|regarding|concerning|to\s+discuss|to\s+follow\s+up\s+on)\s+(.{1,1000})$/iu.exec(s);
 if(enAbout)return {contactQuery:enAbout[1]!.trim(),purpose:enAbout[2]!.trim(),language:'en-IN'};
 const mixed=/^(.{1,128}?)\s+ge\s+call\s+(?:maadu|madu)\s*:\s*(.{1,1000})$/iu.exec(s);
 if(mixed)return {contactQuery:mixed[1]!.trim(),purpose:mixed[2]!.trim(),language:'kn-en'};
 const kn=/^(.{1,128}?)\s+ಗೆ\s+ಕರೆ\s+ಮಾಡು\s*:\s*(.{1,1000})$/u.exec(s);
 return kn?{contactQuery:kn[1]!.trim(),purpose:kn[2]!.trim(),language:'kn-IN'}:null;
}
