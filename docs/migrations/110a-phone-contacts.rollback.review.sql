-- REVIEW ARTIFACT ONLY. Rollback for 110a-phone-contacts.review.sql. Destroys saved phone contacts and consent records;
-- run only with separate explicit approval after exporting anything the owner wants to keep.
BEGIN;
DO $$ BEGIN
  IF current_setting('thaara.step110a_rollback_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step110a_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Step 110a rollback requires explicit approval and target database';
  END IF;
END $$;
DROP TABLE public.phone_contacts;
DROP FUNCTION public.guard_phone_contact_revision();
COMMIT;
