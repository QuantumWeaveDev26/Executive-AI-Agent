# Restore an authorized existing Thaara database on another computer

For a NEW isolated local recovery target only. The application source and schema are public; existing customer records and credentials require separate owner authorization. No database backup, unlock key or production credential is distributed through Git.

## Materials provided privately by the owner

- The encrypted PostgreSQL archive `thaara-full-database-20261124.tar.p7m` and its expected SHA-256 from the private restore receipt.
- Its public recipient certificate. The private unlock key must arrive separately through the approved secure channel; never put it in this checkout, Git, chat or the same shared backup folder.
- The archive's private restore guide/manifest and permission to use its real customer records on the destination computer.

The verified 24 November archive SHA-256 is `6397e1cbfb93c292b692c40c127a18c1c79e3102e174fc900434e1eb87849728`. It predates later releases; do not treat it as a current whole-system snapshot. A prior isolated restore confirmed all 49 public tables, ownership/grants and 14 role definitions without login passwords. These results are historical evidence, not a claim that your destination has already been restored.

## 1. Prepare a private working folder outside the repository

Install Docker and OpenSSL 3.x. Use a fresh empty private folder, separate from your checkout, and download the authorized encrypted archive there. Keep the unlock key protected and separate from shared storage. Verify the archive SHA-256 against the private receipt before decryption. On PowerShell use `Get-FileHash -Algorithm SHA256`; on other systems use their SHA-256 utility.

## 2. Decrypt locally without displaying the key

From that protected working folder, with the separately supplied public certificate and unlock key available only to the restore operator:

```sh
openssl cms -decrypt -binary -inform DER -in thaara-full-database-20261124.tar.p7m -recip thaara-backup-public-cert.pem -inkey thaara-backup-private-key.pem -out thaara-restore.tar
tar -tf thaara-restore.tar
```

Expected members are exactly `thaara-full.dump`, `roles-no-passwords.sql`, `manifest.json` and `README.txt`. Inspect the member list before extraction; reject absolute paths, unexpected files, links or parent-directory traversal. Extract only into a fresh empty private folder. Verify the dump SHA-256 against `manifest.json`. Do not print or upload dump contents.

## 3. Restore into a new isolated PostgreSQL 16 target

The following is a local recovery procedure based on the verified isolated restore. It does not configure the application or connect to production. Confirm the container/volume names below are unused; if either exists, stop and choose a new target rather than replacing data. Pulling PostgreSQL is a local prerequisite. No host ports are published and network access is disabled.

```sh
docker pull postgres:16-alpine
docker run -d --name thaara-restored-db --network none --mount type=volume,source=thaara-restored-db-data,target=/var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine
docker exec thaara-restored-db pg_isready -U postgres
```

Continue only once PostgreSQL reports ready. The trust setting is limited to this new network-isolated container; do not publish ports, attach it to an application network or use this setting on an existing server. The persistent-volume variant above requires destination validation; it was not executed as part of the documentation update.

From the folder holding the four extracted files:

```sh
docker cp roles-no-passwords.sql thaara-restored-db:/tmp/roles-no-passwords.sql
docker cp thaara-full.dump thaara-restored-db:/tmp/thaara-full.dump
docker exec thaara-restored-db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/roles-no-passwords.sql
docker exec thaara-restored-db createdb -U postgres thaara_vps_pilot
docker exec thaara-restored-db pg_restore --single-transaction --exit-on-error -U postgres -d thaara_vps_pilot /tmp/thaara-full.dump
```

The role definitions intentionally contain no passwords. The restore retains object ownership, grants and row-level security. Do not add `--no-owner`, switch the application to a superuser, run fresh core bootstrap over this database, or replay every feature-review SQL file. On failure retain only private diagnostic metadata and resolve the exact error; do not continue from an uncertain partial restore.

## 4. Verify metadata, then configure local application access separately

```sh
docker exec thaara-restored-db psql -X -U postgres -d thaara_vps_pilot -c "SELECT count(*) AS public_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';"
docker exec thaara-restored-db psql -X -U postgres -d thaara_vps_pilot -c "SELECT version,name,checksum,applied_at FROM public.schema_migrations ORDER BY version;"
```

For the dated archive, the expected table count is 49 and its core ledger contains 0001–0012. Verify ownership/grants and tenant boundaries before granting anyone data access. A successful restore does not grant a new developer access to the existing owner's application account.

The application must use a fresh local password for the existing restricted runtime role and an explicitly local connection configuration; old production passwords are not included. Keep the restored database isolated until authentication/network settings and data access are reviewed. Existing encrypted connector records may need separately authorized key configuration. Do not start workers, enable outbound integrations or register production webhooks during recovery.

Keep private plaintext working files protected; remove unneeded plaintext archives/dump copies after validation using your approved secure-file handling process. Do not delete the database volume as routine cleanup. Use `docker stop thaara-restored-db` to stop without discarding its data.

## Scope limits

This is the application PostgreSQL database, not a VPS image. It excludes production login passwords, SSH keys, provider permissions, n8n's separate database/encryption key, Redis queue state, and files stored outside PostgreSQL. Their recovery and company access remain separate. For development without existing records, skip this guide and follow `DEVELOPER.md` with a fresh local database.
