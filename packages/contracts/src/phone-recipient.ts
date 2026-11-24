/** Only an explicit single Indian mobile destination; no service, emergency or premium-rate shortcuts. */
export function normalizePhoneRecipient(value:string):string|null {
  const compact=value.trim().replace(/[\s()-]/g,'');
  const match=/^(?:\+91|91|0)?([6-9][0-9]{9})$/.exec(compact);
  return match?`+91${match[1]}`:null;
}
export function isPhoneNumberQuery(value:string){return /[0-9+]/.test(value);}
export function phoneRecipientMatches(contact:{displayName:string;aliases?:string[];phoneE164:string},query:string){
  const phone=normalizePhoneRecipient(query);
  if(isPhoneNumberQuery(query))return phone!==null&&phone===contact.phoneE164;
  const norm=(s:string)=>s.normalize('NFKC').trim().toLocaleLowerCase('en-IN');
  return [contact.displayName,...contact.aliases??[]].some(name=>norm(name)===norm(query));
}
