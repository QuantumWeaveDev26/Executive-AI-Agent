# WhatsApp style and lead capture — unmerged development

This patch preserves the isolated WhatsApp development against its reviewed baseline. It is not applied to the main source snapshot: newer canonical WhatsApp conversation changes require reconciliation before integration. It includes the later native PostgreSQL TLS compatibility fix and focused tests.

Historical focused test evidence belongs to the isolated worktree, not a verified merged release. Redis maintenance and restricted preparation were completed separately; final API replacement, standing authorization and worker activation were not executed by this workspace. The repository upload does not deploy or activate anything.

No credentials, customer records, generated runtime payloads or private production backups are included. Configure dependencies using server-side secret references and obtain the remaining production approvals before any activation.
