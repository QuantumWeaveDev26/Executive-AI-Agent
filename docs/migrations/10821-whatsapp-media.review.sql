-- REVIEW ONLY. Owner approval and isolated runtime acceptance are mandatory before execution.
-- Additive metadata only: no file bytes, URL fetches, RLS/grant/trigger changes or existing row rewrites.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.whatsapp_n8n_messages ADD COLUMN media_metadata jsonb;
ALTER TABLE public.whatsapp_n8n_messages
  ADD CONSTRAINT whatsapp_n8n_media_metadata_10821_check CHECK (
    media_metadata IS NULL OR COALESCE((
      jsonb_typeof(media_metadata) = 'object'
      AND media_metadata ?& ARRAY['kind','mediaId','mimeType','sha256','downloadStatus']
      AND media_metadata - ARRAY['kind','mediaId','mimeType','sha256','filename','downloadStatus']::text[] = '{}'::jsonb
      AND jsonb_typeof(media_metadata->'kind') = 'string'
      AND media_metadata->>'kind' IN ('image','document','audio')
      AND jsonb_typeof(media_metadata->'mediaId') = 'string'
      AND media_metadata->>'mediaId' ~ '^[0-9]{1,64}$'
      AND jsonb_typeof(media_metadata->'mimeType') = 'string'
      AND length(media_metadata->>'mimeType') BETWEEN 3 AND 192
      AND media_metadata->>'mimeType' ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+(;[ a-zA-Z0-9=.+-]+)?$'
      AND CASE media_metadata->>'kind'
        WHEN 'image' THEN media_metadata->>'mimeType' LIKE 'image/%'
        WHEN 'audio' THEN media_metadata->>'mimeType' LIKE 'audio/%'
        WHEN 'document' THEN media_metadata->>'mimeType' ~ '^(application|text)/'
        ELSE false END
      AND jsonb_typeof(media_metadata->'sha256') = 'string'
      AND (media_metadata->>'sha256' ~ '^[a-fA-F0-9]{64}$' OR media_metadata->>'sha256' ~ '^[A-Za-z0-9+/]{43}=$')
      AND media_metadata->'downloadStatus' = '"not_downloaded"'::jsonb
      AND (NOT (media_metadata ? 'filename') OR (
        media_metadata->>'kind' = 'document'
        AND jsonb_typeof(media_metadata->'filename') = 'string'
        AND length(media_metadata->>'filename') BETWEEN 1 AND 160
        AND media_metadata->>'filename' !~ '[[:cntrl:]]'
        AND position('/' in media_metadata->>'filename') = 0
        AND position(chr(92) in media_metadata->>'filename') = 0
      ))
    ), false)
  );

-- Existing RLS, append-only grants and audit triggers remain attached to the same rows/table.
-- Second application intentionally fails rather than silently accepting schema drift.
COMMIT;
