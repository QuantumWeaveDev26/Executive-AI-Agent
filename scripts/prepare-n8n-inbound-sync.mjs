import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 1. Read live exported workflow
const liveExportPath = 'C:/Users/Admin/.gemini/antigravity/brain/ddf6e71d-f292-4f0d-a1ff-2a29a7d88a87/.system_generated/tasks/task-19656.log';
const rawLog = fs.readFileSync(liveExportPath, 'utf8').trim();
const liveWf = JSON.parse(rawLog)[0];

// Save clean live backup
const backupDir = 'deploy/n8n/backups';
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync('.agents/worktrees/whatsapp-templates/deploy/n8n/backups', { recursive: true });
const backupFile = path.join(backupDir, 'workflow_ezIrlr7y9dEowujw_live_pre_update.json');
fs.writeFileSync(backupFile, JSON.stringify(liveWf, null, 2), 'utf8');
fs.copyFileSync(backupFile, path.join('.agents/worktrees/whatsapp-templates', backupFile));
console.log('Saved clean live backup to', backupFile);

// 2. Read approved prompt
const prompt10Raw = fs.readFileSync('C:/Users/Admin/.gemini/antigravity/brain/ddf6e71d-f292-4f0d-a1ff-2a29a7d88a87/scratch/approved-prompt-10.md', 'utf8');
const lines = prompt10Raw.split('\n');

// Find start of system prompt: line starting with "You are Thaara, Quantum Weave AI's intelligent business assistant on WhatsApp."
const startIndex = lines.findIndex(l => l.includes("You are Thaara, Quantum Weave AI's intelligent business assistant on WhatsApp."));
// Find end of system prompt: line before "THAARA V2 — WHATSAPP KNOWLEDGE SYNCHRONIZATION"
const endIndex = lines.findIndex(l => l.includes("THAARA V2 — WHATSAPP KNOWLEDGE SYNCHRONIZATION"));

if (startIndex === -1 || endIndex === -1) {
  throw new Error(`Could not delineate prompt: start=${startIndex}, end=${endIndex}`);
}

const systemPromptText = lines.slice(startIndex, endIndex).join('\n').trim();
console.log('Extracted approved system prompt, length:', systemPromptText.length);
console.log('Prompt preview:\n', systemPromptText.slice(0, 200), '\n...\n', systemPromptText.slice(-200));

// 3. Update the node in the workflow clone
const updatedWf = JSON.parse(JSON.stringify(liveWf));
const agentNode = updatedWf.nodes.find(n => n.name === 'Quantum Weave AI Agent' || n.id === '7f91a203-4c18-4b77-8f12-90123e4a1082');
if (!agentNode) throw new Error('Agent node not found');

agentNode.parameters.options.systemMessage = systemPromptText;

// 4. Save updated workflow JSON
const targetFile = 'deploy/n8n/THAARA_V2_DEV_WHATSAPP_INBOUND_1082.ai-memory.json';
const worktreeTarget = '.agents/worktrees/whatsapp-templates/deploy/n8n/THAARA_V2_DEV_WHATSAPP_INBOUND_1082.ai-memory.json';

const serialized = JSON.stringify(updatedWf, null, 2);
fs.writeFileSync(targetFile, serialized, 'utf8');
fs.writeFileSync(worktreeTarget, serialized, 'utf8');

const hash = crypto.createHash('sha256').update(serialized).digest('hex');
console.log('Saved updated workflow to', targetFile);
console.log('Updated workflow SHA256:', hash);
