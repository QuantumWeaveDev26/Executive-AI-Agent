# n8n account rule for Thaara AI V2 (owner decision, 27 Oct 2026)

> **CURRENT OWNER DECISION, 28 Oct 2026, latest continuation:** "use quantumweave26@gmail.com this account" and "dont change anything in the existing just work with the thaara workflows". This explicitly supersedes the earlier team.quantumweaveai requirement below. Use the existing personal project `fn6pQNcDpG7hLM3t` and only Thaara inbound `ezIrlr7y9dEowujw` / outbound `RrqXTplIBXginMSD`. No account migration/reconnection is now required. Preserve unrelated workflows, VPS/services and credentials. Existing dedicated credential references may be assigned within the Thaara workflow; no secret values are read or changed. Real sending/activation and backend changes still need their separate explicit approval. Credential home-project metadata establishes ownership, not necessarily the connector caller's login identity; the latest account choice is directly owner-authorized.

> **LATEST OWNER DECISION, 28 Oct 2026 — supersedes the historical decisions below:** require **team.quantumweaveai@gmail.com before any workflow changes** (owner selected that exact option during the urgent WhatsApp continuation). Current connector metadata still places Thaara WhatsApp Test in personal project `fn6pQNcDpG7hLM3t`, `Quantumweave academy <quantumweave26@gmail.com>`; searching for team.quantumweaveai returns zero projects. Do not change/publish/test a workflow under the old account or create duplicates. The owner must privately establish the correct n8n login, access to the same two workflow IDs and their dedicated credentials, and reconnect the n8n connector. Read-only metadata checks and local development may continue. No account, resource ownership, credential or sharing change was performed by Codex.

> **FINAL OWNER DECISION (supersedes the earlier rule below):** the Thaara n8n workspace is the n8n **Owner user "Quantumweave academy" (quantumweave26@gmail.com)** on `n8n.srv1871828.hstgr.cloud`, personal project `fn6pQNcDpG7hLM3t`. team.quantumweaveai@gmail.com is the owner's main Google/Claude account, not an n8n login. The Claude n8n connector already uses this correct n8n user.

**Permanent rule:** all Thaara AI V2 n8n work (WhatsApp, Gmail/Calendar automations, agents, phone, builders, business and scheduled workflows) uses the n8n login **team.quantumweaveai@gmail.com**. The account quantumweave26@gmail.com is **not** the Thaara workspace, even when a connector can see it. Reuse existing Thaara workflows; never duplicate them; never touch unrelated or legacy workflows or credentials. No passwords or tokens in docs or chat.

| Concept | Value | Verified? |
|---|---|---|
| n8n server address | `https://n8n.srv1871828.hstgr.cloud/` (container `n8n-n8n-1` on VPS 1871828) | Server verified. Whether the Claude n8n connector points at this same server is **not yet independently verified** |
| Correct n8n login | team.quantumweaveai@gmail.com | Owner statement |
| Claude connector's current login | Personal project "Quantumweave academy <quantumweave26@gmail.com>" (`fn6pQNcDpG7hLM3t`); team projects not enabled | Read-only connector check, 27 Oct 2026 |
| Workflow ownership as seen by the connector | `ezIrlr7y9dEowujw` (INBOUND_1082), `RrqXTplIBXginMSD` (OUTGOING_1082), `bXk1oGwEpqig0677` (EMAIL_OFFLINE) are visible with full owner scopes in that personal project | Read-only |
| Credential visibility | Connector sees 24 credentials, all in the quantumweave26 personal project, including "Thaara WhatsApp Trigger" and "Thaara WhatsApp Test". "Thaara Pilot Relay 10812" (created by the owner under team.quantumweaveai) is **not visible** | Read-only |

## Owner screenshot finding (27 Oct 2026)

On `n8n.srv1871828.hstgr.cloud` (n8n 2.32.7), Settings → Personal shows the signed-in **Owner** user as "Quantumweave academy", email **quantumweave26@gmail.com**. This confirms that:

- the Claude connector points at the **VPS n8n server**;
- it uses the **same n8n user** the owner works in;
- this user is the instance Owner, and holds all Thaara workflows (the 1082 pair and the legacy orchestrators).

team.quantumweaveai@gmail.com is therefore a different identity (the approval page showed it, but n8n's own user record says otherwise). The credential "Thaara Pilot Relay 10812" is not in this n8n user's credential list. **The owner must decide** which n8n user is the Thaara workspace; this is pending.

## Discrepancy to resolve (owner)

The existing Thaara workflows and the earlier Thaara credentials appear under quantumweave26 in this connector. Once the connector is reconnected as team.quantumweaveai, check whether these workflows are visible there. If they aren't, the owner shares or moves them to team.quantumweaveai in the n8n UI. **Do not recreate them.**

## Status

- No n8n change has been made under quantumweave26 since this rule was set. All Step 108.12 Part C n8n edits are paused until the connector is verified as team.quantumweaveai.
- The pilot handoff token file stays on the VPS until the relay credential is verified in the correct account.
