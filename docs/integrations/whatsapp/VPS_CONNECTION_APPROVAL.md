# THAARA AI V2 — proposed dedicated VPS connection

Approval pending. Owner chose a separate V2 connection because the existing private n8n-vps-key is not available on this computer. No new key generated/enrolled and no remote SSH authentication attempted. No Neon setup is required for the proposed private VPS test pilot.

## Exact next credential/access scope

- Display label THAARA AI V2; only VPS1871828 / srv1871828.hstgr.cloud /76.13.217.50, standard SSH port22 confirmed responding. Use a fresh temporary SSH key, private material protected locally outside the repository. Never print, commit, upload or share the private key; only its public key is sent to Hostinger.
- Hostinger operation vps_ssh-keys_add-virtual-machine accepts the target ID and public keys; documentation explicitly says ROOT. **This grants administrator access to the VPS, not an account restricted by SSH permissions to V2.** Do not describe it as a least-privilege deploy user. Creating a genuinely restricted deploy account instead requires a separate owner-controlled server-admin bootstrap path not currently available through the read-only API.
- After explicit approval, preserve all existing public keys; add only the newly generated key. Use only read-only preflight commands until a separate deployment approval: architecture/version, current containers/ports, network/mount metadata without environment values, new path/volume/project absence and disk/capacity. No private files, legacy data or environment secrets read.
- No new project, directory upload, database/container/volume, credential file on VPS, SQL, image transfer, DNS/firewall/proxy/service change, restart, workflow activation, Meta call or message is covered by access approval. Hostinger's remove-virtual-machine-keys API lacks a key selector; NEVER use it for cleanup because existing keys must survive. Review exact single-key revocation separately through trusted access when the temporary key is no longer needed.
- Do not change Windows SSH service configuration, existing keys or global SSH policy implicitly. Establish protected key handling and a trusted server host-key pin before authenticating. Owner handles any private credential/passphrase input privately; never asks for it in chat.

## Server identity pending trusted verification

Public handshake candidate: ssh-ed25519 SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4. This is an unauthenticated network observation, NOT proof of server identity. Current known_hosts contains no confirmed entry; no trust was added. Compare using the trusted Hostinger browser terminal before accepting a key. Read-only server command, for the owner to run privately there when needed:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Share only its public SHA256 fingerprint, never host private-key files, root password, account secrets or screenshots exposing credentials. Do not ask the owner to troubleshoot Windows tooling: the prior metadata failure was diagnosed as client key-exchange compatibility; strong curve25519-sha256 works and no server downgrade is needed.

This is the project's explicit new-credential/administrator-access authorization boundary. It does not authorize deploying the pilot or waive production managed-service requirements. Continue the same WhatsApp master task after this bounded access approval; no new feature prompt needed.
