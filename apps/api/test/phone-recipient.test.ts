import {describe,it,expect} from 'vitest';
import {normalizePhoneRecipient,phoneRecipientMatches} from '../../../packages/contracts/src/phone-recipient.js';
describe('explicit phone recipient resolution',()=>{
 it.each(['8073486718','+918073486718','+91 80734-86718','08073486718'])('normalizes one Indian mobile %s',value=>expect(normalizePhoneRecipient(value)).toBe('+918073486718'));
 it.each(['112','100','1900123456','+18073486718','8073486718 or 9876543210','807348671','807348671800','Ram 8073486718'])('rejects unsafe or ambiguous %s',value=>expect(normalizePhoneRecipient(value)).toBeNull());
 it('matches exact numbers and names but never suffixes or another record alias containing digits',()=>{
  const c={displayName:'Ram',aliases:['customer 8073486718'],phoneE164:'+918073486718'};
  expect(phoneRecipientMatches(c,'+91 8073486718')).toBe(true);expect(phoneRecipientMatches(c,'ram')).toBe(true);
  expect(phoneRecipientMatches(c,'86718')).toBe(false);expect(phoneRecipientMatches(c,'customer 8073486718')).toBe(false);
 });
});
