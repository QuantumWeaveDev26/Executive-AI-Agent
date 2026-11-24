-- REVIEW ARTIFACT ONLY. Rollback for 110b-phone-calls.review.sql. Destroys call history and event evidence;
-- run only with separate explicit approval after exporting anything the owner wants to keep.
BEGIN;
DO $$ BEGIN
  IF current_setting('thaara.step110b_rollback_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step110b_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Step 110b rollback requires explicit approval and target database';
  END IF;
END $$;
DROP TABLE public.phone_call_events;
DROP TABLE public.phone_calls;
DROP FUNCTION public.guard_phone_call_state();
DROP FUNCTION public.guard_phone_call_claim();
COMMIT;
