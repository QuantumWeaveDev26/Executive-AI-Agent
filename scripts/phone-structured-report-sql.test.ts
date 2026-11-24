import fs from 'node:fs';
import {it,expect} from 'vitest';

// Source regression only. These checks do not parse/execute PLpgSQL or prove runtime admission.
const sql=()=>fs.readFileSync('docs/migrations/114-phone-structured-report.review.sql','utf8');
it('rejects incompatible prior transcript provenance before any lifecycle mutation',()=>{
 const source=sql(),guard=source.indexOf("c.transcript_source IS NOT NULL AND c.transcript_source <> 'provider_english'");
 expect(guard).toBeGreaterThan(0);expect(guard).toBeLessThan(source.indexOf('applied := public.apply_phone_provider_event'));
});
it('retains prior evidence identifiers before constructing the replacement report',()=>{
 const source=sql(),merge=source.indexOf("ids := COALESCE(c.report->'evidenceIds','[]'::jsonb) || ids;");
 expect(merge).toBeGreaterThan(source.lastIndexOf('SELECT * INTO c FROM public.phone_calls'));
 expect(merge).toBeLessThan(source.indexOf('v_report := jsonb_build_object'));
});
it('bounds raw turn length as well as rejecting blank text',()=>{
 expect(sql()).toContain("length(turn->>'text') BETWEEN 1 AND 1000");
 expect(sql()).toContain("length(btrim(turn->>'text'))>0");
});
