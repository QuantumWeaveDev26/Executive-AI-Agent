# Thaara vs WhatsLearn WhatsApp isolation check (27 Oct 2026, read-only)

The owner reports separate Meta apps and numbers for Thaara and WhatsLearn. Both n8n workflows run on the same n8n server (`n8n.srv1871828.hstgr.cloud`).

| Item | Thaara AI V2 | WhatsLearn Mentor (`pktkYZFWUH8gPBVN`) | Isolated? |
|---|---|---|---|
| Meta app | 1691352712358994 (owner) | Separate app (owner); ID not visible to Claude | Owner-confirmed |
| Phone number ID | 276710465536610 | 1476781035513182 (from its "My Settings" node) | **Yes, different** |
| WhatsApp Business Account ID | 356865954168966 (owner-labelled "Messaging account ID") | Not visible to Claude | Unknown (not needed for routing) |
| Callback URL | `…/webhook/d18b6687-…/webhook` (owner read it from app 1691352712358994) | `…/webhook/whatslearn-mentor-chat` (live: wrong-token verify returns 403) | **Different** |
| Signature check | n8n WhatsApp Trigger with credential "Thaara WhatsApp Trigger"; an unsigned forged POST started no execution | Workflow verifies the signature with its own app secret (settings node) | Separate secrets |
| n8n credentials | "Thaara WhatsApp Trigger", "Thaara Pilot Relay 10812" | Own settings node; the connector hides its credential names | Separate workflows |
| Thaara acceptance rule | Only phone 276710465536610, only the owner's phone as sender, text only | n/a | Defence in depth |

**WhatsLearn liveness:** the production verify endpoint is live and correctly refuses a wrong token. WhatsLearn saves no execution data (`none`/`none`), so message flow can't be seen from n8n history. Delivery from Meta can be confirmed by the owner in the WhatsLearn app's WhatsApp → Configuration page (the Callback URL should end in `/webhook/whatslearn-mentor-chat`). No WhatsLearn setting was changed.

**Why Thaara's number shows "WhatsLearn":** the IDs differ, so this is not shared routing. WhatsApp shows the **display name of number 276710465536610** as set in WhatsApp Manager (possibly inherited when the number was registered under a business portfolio or profile named WhatsLearn), **or** a saved contact name on the owner's phone. Fix: in WhatsApp Manager → Phone numbers, select the number with ID 276710465536610 and edit its display name (Meta reviews display-name changes), or rename the phone contact. Neither touches WhatsLearn's number.
