# Thaara V2 source snapshot — 24 November 2026

This repository contains the current canonical Thaara monorepo source, tests, dependency lockfile, documentation and deployment tooling. It starts with a clean history so credentials from historical development commits are not copied.

The isolated WhatsApp formatting/Google Sheets feature is preserved separately in `docs/pending/whatsapp-style-leads.patch`. It is intentionally not merged over newer WhatsApp behavior in the canonical source. Review and reconcile it before applying. This upload is a source backup, not a new release or production deployment.

Credentials, environment files (except the example), customer/runtime records, private backups, caches, installed dependencies and generated deployment payloads are excluded. Install dependencies with the pinned pnpm version and configure server-side secrets separately. No production service was changed by this upload.
