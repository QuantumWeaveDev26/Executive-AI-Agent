"""Import and activate the two Thaara workflows in n8n with explicit IDs."""
import json
import subprocess
import hmac
import hashlib
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
secret_path = PRIVATE / 'secrets' / 'sarvam_webhook_secret'
raw_secret = secret_path.read_text(encoding='utf-8').strip()

WORKSPACE_ID = '75d2f889-d3eb-4acc-861a-fada4691ecce'
OWNER_USER_ID = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d'
PROJECT_ID = 'fn6pQNcDpG7hLM3t'

msg = f"thaara:phone-n8n-sync:v1:{WORKSPACE_ID}:{OWNER_USER_ID}".encode('utf-8')
derived_token = hmac.new(raw_secret.encode('utf-8'), msg, hashlib.sha256).hexdigest()
print("Derived token prefix:", derived_token[:12])

wf1_raw = r'''{
  "name": "Thaara — Callback Email Notifications",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "minutes",
              "minutesInterval": 2
            }
          ]
        }
      },
      "id": "cb-schedule-trigger-01",
      "name": "Every 2 Minutes",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [
        220,
        240
      ]
    },
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "thaara-callback-notify",
        "authentication": "headerAuth",
        "responseMode": "onReceived",
        "options": {}
      },
      "id": "cb-webhook-trigger-02",
      "name": "Authenticated Callback Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        220,
        440
      ],
      "webhookId": "thaara-callback-notify-v1",
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    },
    {
      "parameters": {
        "method": "GET",
        "url": "http://172.16.1.13:3002/api/v1/connectors/phone/n8n/checkpoint",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {
          "timeout": 10000
        }
      },
      "id": "cb-get-checkpoint-03",
      "name": "Load Callback Cutoff",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        460,
        340
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const nowMs = Date.now();\nconst cutoffIso = $input.first()?.json?.callbackCutoffDatetime || new Date(nowMs - 15 * 60 * 1000).toISOString();\nconst cutoffMs = Date.parse(cutoffIso);\nconst lookbackMs = Math.max(Number.isFinite(cutoffMs) ? cutoffMs - 5 * 60 * 1000 : 0, nowMs - 45 * 60 * 1000);\nreturn [{\n  json: {\n    startDatetime: new Date(lookbackMs).toISOString(),\n    endDatetime: new Date(nowMs + 5 * 60 * 1000).toISOString(),\n    filterConditions: JSON.stringify([\n      { field: 'channel_direction', operator: 'equals', value: 'inbound' }\n    ])\n  }\n}];"
      },
      "id": "cb-build-window-04",
      "name": "Build Inbound Window",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        680,
        340
      ]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "start_datetime",
              "value": "={{ $json.startDatetime }}"
            },
            {
              "name": "end_datetime",
              "value": "={{ $json.endDatetime }}"
            },
            {
              "name": "limit",
              "value": "25"
            },
            {
              "name": "offset",
              "value": "0"
            },
            {
              "name": "filter_conditions",
              "value": "={{ $json.filterConditions }}"
            }
          ]
        },
        "options": {
          "timeout": 12000
        }
      },
      "id": "cb-fetch-attempts-05",
      "name": "Fetch Completed Inbound Calls",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        900,
        340
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraSarvamAnalyticsAuth",
          "name": "Thaara Sarvam Analytics API"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const items = Array.isArray($input.first()?.json?.items) ? $input.first().json.items : [];\nconst eligible = items.filter(a =>\n  a &&\n  a.channel_direction === 'inbound' &&\n  a.connectivity_status === 'connected' &&\n  typeof a.interaction_id === 'string' &&\n  a.interaction_id.length > 0 &&\n  Boolean(a.end_datetime)\n);\nreturn eligible.map(attempt => ({\n  json: {\n    attempt,\n    encodedInteractionId: encodeURIComponent(attempt.interaction_id)\n  }\n}));"
      },
      "id": "cb-filter-connected-06",
      "name": "Select Ended Inbound Interactions",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        1120,
        340
      ]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/transcripts/{{ $json.encodedInteractionId }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {
          "timeout": 12000
        }
      },
      "id": "cb-fetch-transcript-07",
      "name": "Fetch Call Transcript",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        1340,
        340
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 1500,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraSarvamAnalyticsAuth",
          "name": "Thaara Sarvam Analytics API"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const sourceItems = $('Select Ended Inbound Interactions').all();\nconst txItems = $input.all();\nconst out = [];\nfor (let i = 0; i < txItems.length; i++) {\n  const attempt = sourceItems[i]?.json?.attempt;\n  const tx = txItems[i]?.json;\n  if (!attempt || !attempt.attempt_id) continue;\n  const messages = Array.isArray(tx?.messages) ? tx.messages.slice(0, 200).map(m => ({\n    role: String(m.role || 'user'),\n    content: typeof m.content === 'string' ? m.content.slice(0, 4000) : '',\n    ...(typeof m.english_content === 'string' ? { english_content: m.english_content.slice(0, 4000) } : {}),\n    ...(typeof m.language_name === 'string' ? { language_name: m.language_name.slice(0, 64) } : {}),\n    ...(m.turn_id !== undefined ? { turn_id: m.turn_id } : {})\n  })) : [];\n  const av = attempt.agent_variables && typeof attempt.agent_variables === 'object' ? attempt.agent_variables : {};\n  out.push({\n    json: {\n      call: {\n        attemptId: String(attempt.attempt_id),\n        interactionId: attempt.interaction_id || null,\n        direction: 'inbound',\n        connectivityStatus: ['connected', 'no_answer', 'busy', 'failed'].includes(attempt.connectivity_status) ? attempt.connectivity_status : 'unknown',\n        failureReason: attempt.failure_reason || null,\n        endedBy: attempt.ended_by || null,\n        durationSeconds: typeof attempt.duration_in_seconds === 'number' ? attempt.duration_in_seconds : null,\n        startDatetime: attempt.start_datetime || null,\n        endDatetime: attempt.end_datetime || null,\n        attemptedAt: attempt.attempted_at || null,\n        userContact: attempt.user_contact || null,\n        userContactMasked: attempt.user_contact_masked || null,\n        recordingAvailable: Boolean(attempt.audio_url && attempt.interaction_id),\n        appVersion: attempt.app_version ?? null,\n        languageName: attempt.language_name || null,\n        agentVariables: {\n          user_name: av.user_name ?? null,\n          call_purpose: av.call_purpose ?? null,\n          call_summary: av.call_summary ?? null,\n          business_name: av.business_name ?? null,\n          service_needed: av.service_needed ?? null,\n          preferred_callback_time: av.preferred_callback_time ?? null\n        },\n        messages\n      }\n    }\n  });\n}\nreturn out;"
      },
      "id": "cb-normalize-candidate-08",
      "name": "Prepare Verification Payload",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        1560,
        340
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://172.16.1.13:3002/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {
          "timeout": 12000
        }
      },
      "id": "cb-evaluate-claim-09",
      "name": "Verify Consent & Claim Single Delivery",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        1780,
        340
      ],
      "retryOnFail": true,
      "maxTries": 2,
      "waitBetweenTries": 1500,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 2
          },
          "conditions": [
            {
              "id": "cond-send-allowed",
              "leftValue": "={{ $json.sendAllowed }}",
              "rightValue": true,
              "operator": {
                "type": "boolean",
                "operation": "true",
                "singleValue": true
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "cb-if-confirmed-10",
      "name": "Verified & Unsent?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        2000,
        340
      ]
    },
    {
      "parameters": {
        "fromEmail": "={{ $json.email.fromEmail }}",
        "toEmail": "={{ $json.email.toEmail }}",
        "subject": "={{ $json.email.subject }}",
        "emailFormat": "both",
        "text": "={{ $json.email.textBody }}",
        "html": "={{ $json.email.htmlBody }}",
        "options": {}
      },
      "id": "cb-send-email-11",
      "name": "Send Callback Email to Owner",
      "type": "n8n-nodes-base.emailSend",
      "typeVersion": 2.1,
      "position": [
        2240,
        240
      ],
      "onError": "continueErrorOutput",
      "credentials": {
        "smtp": {
          "id": "G1VGVGldX32ch2xV",
          "name": "BrandMint SMTP"
        }
      }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://172.16.1.13:3002/api/v1/connectors/phone/n8n/callbacks/receipt",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ callId: $('Verified & Unsent?').item.json.callId, claimAttemptId: $('Verified & Unsent?').item.json.claimAttemptId, outcome: 'submitted', providerMessageId: String($json.messageId || $json.response || '') }) }}",
        "options": {
          "timeout": 10000
        }
      },
      "id": "cb-record-success-12",
      "name": "Record Delivery Receipt",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        2500,
        160
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://172.16.1.13:3002/api/v1/connectors/phone/n8n/callbacks/receipt",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ callId: $('Verified & Unsent?').item.json.callId, claimAttemptId: $('Verified & Unsent?').item.json.claimAttemptId, outcome: 'pending', errorSummary: 'SMTP send failed; queued for bounded retry' }) }}",
        "options": {
          "timeout": 10000
        }
      },
      "id": "cb-record-retry-13",
      "name": "Release Claim for Retry",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        2500,
        340
      ],
      "retryOnFail": true,
      "maxTries": 2,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    }
  ],
  "connections": {
    "Every 2 Minutes": {
      "main": [
        [
          {
            "node": "Load Callback Cutoff",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Authenticated Callback Webhook": {
      "main": [
        [
          {
            "node": "Load Callback Cutoff",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Load Callback Cutoff": {
      "main": [
        [
          {
            "node": "Build Inbound Window",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Build Inbound Window": {
      "main": [
        [
          {
            "node": "Fetch Completed Inbound Calls",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Fetch Completed Inbound Calls": {
      "main": [
        [
          {
            "node": "Select Ended Inbound Interactions",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Select Ended Inbound Interactions": {
      "main": [
        [
          {
            "node": "Fetch Call Transcript",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Fetch Call Transcript": {
      "main": [
        [
          {
            "node": "Prepare Verification Payload",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Prepare Verification Payload": {
      "main": [
        [
          {
            "node": "Verify Consent & Claim Single Delivery",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Verify Consent & Claim Single Delivery": {
      "main": [
        [
          {
            "node": "Verified & Unsent?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Verified & Unsent?": {
      "main": [
        [
          {
            "node": "Send Callback Email to Owner",
            "type": "main",
            "index": 0
          }
        ],
        []
      ]
    },
    "Send Callback Email to Owner": {
      "main": [
        [
          {
            "node": "Record Delivery Receipt",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Release Claim for Retry",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "settings": {
    "executionOrder": "v1"
  }
}
'''
wf2_raw = r'''{
  "name": "Thaara — Sarvam Call History Sync",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "minutes",
              "minutesInterval": 2
            }
          ]
        }
      },
      "id": "sync-schedule-trigger-01",
      "name": "Every 2 Minutes",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [
        220,
        240
      ]
    },
    {
      "parameters": {},
      "id": "sync-manual-trigger-02",
      "name": "Manual Backfill Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        220,
        440
      ]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "http://172.16.1.13:3002/api/v1/connectors/phone/n8n/checkpoint",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {
          "timeout": 10000
        }
      },
      "id": "sync-get-checkpoint-03",
      "name": "Load Sync Checkpoint",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        460,
        340
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const cp = $input.first()?.json || {};\nconst nowMs = Date.now();\nconst startDatetime = cp.cursorStartDatetime || new Date(nowMs - 30 * 86400 * 1000).toISOString();\nconst endDatetime = new Date(nowMs + 5 * 60 * 1000).toISOString();\nconst advanceCursorTo = new Date(nowMs).toISOString();\nconst pageOffsets = cp.backfillCompleted ? [0, 50] : [0, 50, 100, 150];\nreturn pageOffsets.map(offset => ({\n  json: {\n    startDatetime,\n    endDatetime,\n    advanceCursorTo,\n    limit: 50,\n    offset\n  }\n}));"
      },
      "id": "sync-build-pages-04",
      "name": "Build Paginated Offsets",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        680,
        340
      ]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            {
              "name": "start_datetime",
              "value": "={{ $json.startDatetime }}"
            },
            {
              "name": "end_datetime",
              "value": "={{ $json.endDatetime }}"
            },
            {
              "name": "limit",
              "value": "={{ String($json.limit) }}"
            },
            {
              "name": "offset",
              "value": "={{ String($json.offset) }}"
            }
          ]
        },
        "options": {
          "timeout": 15000
        }
      },
      "id": "sync-fetch-attempts-05",
      "name": "Fetch Inbound & Outbound Attempts",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        920,
        340
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraSarvamAnalyticsAuth",
          "name": "Thaara Sarvam Analytics API"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const pages = $input.all();\nconst seen = new Set();\nconst attempts = [];\nfor (const page of pages) {\n  const list = Array.isArray(page.json?.items) ? page.json.items : [];\n  for (const item of list) {\n    if (!item || !item.attempt_id) continue;\n    if (item.channel_direction !== 'inbound' && item.channel_direction !== 'outbound') continue;\n    const key = `${item.channel_direction}:${item.interaction_id || item.attempt_id}`;\n    if (seen.has(key)) continue;\n    seen.add(key);\n    attempts.push(item);\n  }\n}\nif (attempts.length === 0) {\n  return [{\n    json: {\n      emptyBatch: true,\n      advanceCursorTo: $('Build Paginated Offsets').first().json.advanceCursorTo\n    }\n  }];\n}\nreturn attempts.map(attempt => ({\n  json: {\n    emptyBatch: false,\n    attempt,\n    needsTranscript: Boolean(attempt.connectivity_status === 'connected' && attempt.interaction_id),\n    encodedInteractionId: attempt.interaction_id ? encodeURIComponent(attempt.interaction_id) : ''\n  }\n}));"
      },
      "id": "sync-dedupe-attempts-06",
      "name": "Deduplicate Call Attempts",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        1160,
        340
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 2
          },
          "conditions": [
            {
              "id": "cond-needs-transcript",
              "leftValue": "={{ $json.needsTranscript }}",
              "rightValue": true,
              "operator": {
                "type": "boolean",
                "operation": "true",
                "singleValue": true
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "sync-if-transcript-07",
      "name": "Has Connected Transcript?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        1380,
        340
      ]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/transcripts/{{ $json.encodedInteractionId }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {
          "timeout": 12000
        }
      },
      "id": "sync-fetch-transcript-08",
      "name": "Retrieve Conversation Transcript",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        1620,
        220
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 1000,
      "onError": "continueRegularOutput",
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraSarvamAnalyticsAuth",
          "name": "Thaara Sarvam Analytics API"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const connectedInputs = $('Has Connected Transcript?').all(0);\nconst txOutputs = $input.all();\nconst paired = [];\nfor (let i = 0; i < connectedInputs.length; i++) {\n  const attempt = connectedInputs[i]?.json?.attempt;\n  const tx = txOutputs[i]?.json;\n  if (!attempt) continue;\n  paired.push({\n    json: {\n      attempt,\n      messages: Array.isArray(tx?.messages) ? tx.messages : []\n    }\n  });\n}\nreturn paired;"
      },
      "id": "sync-pair-transcripts-09",
      "name": "Pair Connected Transcripts",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        1840,
        220
      ]
    },
    {
      "parameters": {
        "jsCode": "const nonConnected = $input.all().filter(x => !x.json?.emptyBatch && x.json?.attempt);\nreturn nonConnected.map(x => ({\n  json: {\n    attempt: x.json.attempt,\n    messages: []\n  }\n}));"
      },
      "id": "sync-format-unanswered-10",
      "name": "Pass Unanswered & Failed Attempts",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        1840,
        460
      ]
    },
    {
      "parameters": {
        "mode": "append"
      },
      "id": "sync-merge-branches-11",
      "name": "Merge All Synced Calls",
      "type": "n8n-nodes-base.merge",
      "typeVersion": 3,
      "position": [
        2080,
        340
      ]
    },
    {
      "parameters": {
        "jsCode": "const allItems = $input.all();\nconst advanceCursorTo = $('Build Paginated Offsets').first().json.advanceCursorTo;\nconst calls = [];\nfor (const item of allItems) {\n  const a = item.json?.attempt;\n  if (!a || !a.attempt_id) continue;\n  const av = a.agent_variables && typeof a.agent_variables === 'object' ? a.agent_variables : {};\n  const messages = Array.isArray(item.json?.messages)\n    ? item.json.messages.slice(0, 200).map(m => ({\n        role: String(m.role || 'user'),\n        content: typeof m.content === 'string' ? m.content.slice(0, 4000) : '',\n        ...(typeof m.english_content === 'string' ? { english_content: m.english_content.slice(0, 4000) } : {}),\n        ...(typeof m.language_name === 'string' ? { language_name: m.language_name.slice(0, 64) } : {}),\n        ...(m.turn_id !== undefined ? { turn_id: m.turn_id } : {})\n      }))\n    : [];\n  calls.push({\n    attemptId: String(a.attempt_id),\n    interactionId: a.interaction_id || null,\n    direction: a.channel_direction === 'inbound' ? 'inbound' : 'outbound',\n    connectivityStatus: ['connected', 'no_answer', 'busy', 'failed'].includes(a.connectivity_status) ? a.connectivity_status : 'unknown',\n    failureReason: a.failure_reason || null,\n    endedBy: a.ended_by || null,\n    durationSeconds: typeof a.duration_in_seconds === 'number' ? a.duration_in_seconds : null,\n    startDatetime: a.start_datetime || null,\n    endDatetime: a.end_datetime || null,\n    attemptedAt: a.attempted_at || null,\n    userContact: a.user_contact || null,\n    userContactMasked: a.user_contact_masked || null,\n    recordingAvailable: Boolean(a.audio_url && a.interaction_id),\n    appVersion: a.app_version ?? null,\n    languageName: a.language_name || null,\n    agentVariables: {\n      user_name: av.user_name ?? null,\n      call_purpose: av.call_purpose ?? null,\n      call_summary: av.call_summary ?? null,\n      business_name: av.business_name ?? null,\n      service_needed: av.service_needed ?? null,\n      preferred_callback_time: av.preferred_callback_time ?? null\n    },\n    messages\n  });\n}\nconst batches = [];\nfor (let i = 0; i < Math.max(1, calls.length); i += 50) {\n  const slice = calls.slice(i, i + 50);\n  const isLast = i + 50 >= calls.length;\n  batches.push({\n    json: {\n      calls: slice,\n      advanceCursorTo: isLast ? advanceCursorTo : null,\n      markBackfillCompleted: isLast\n    }\n  });\n}\nreturn batches;"
      },
      "id": "sync-build-batches-12",
      "name": "Assemble Normalized Batches",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        2300,
        340
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://172.16.1.13:3002/api/v1/connectors/phone/n8n/calls/sync",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {
          "timeout": 20000
        }
      },
      "id": "sync-post-thaara-13",
      "name": "Sync Calls to Thaara Backend",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        2540,
        340
      ],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000,
      "credentials": {
        "httpHeaderAuth": {
          "id": "thaaraPhoneBackendSyncAuth",
          "name": "Thaara Phone Backend Sync"
        }
      }
    }
  ],
  "connections": {
    "Every 2 Minutes": {
      "main": [
        [
          {
            "node": "Load Sync Checkpoint",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Manual Backfill Trigger": {
      "main": [
        [
          {
            "node": "Load Sync Checkpoint",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Load Sync Checkpoint": {
      "main": [
        [
          {
            "node": "Build Paginated Offsets",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Build Paginated Offsets": {
      "main": [
        [
          {
            "node": "Fetch Inbound & Outbound Attempts",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Fetch Inbound & Outbound Attempts": {
      "main": [
        [
          {
            "node": "Deduplicate Call Attempts",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Deduplicate Call Attempts": {
      "main": [
        [
          {
            "node": "Has Connected Transcript?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Has Connected Transcript?": {
      "main": [
        [
          {
            "node": "Retrieve Conversation Transcript",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Pass Unanswered & Failed Attempts",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Retrieve Conversation Transcript": {
      "main": [
        [
          {
            "node": "Pair Connected Transcripts",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Pair Connected Transcripts": {
      "main": [
        [
          {
            "node": "Merge All Synced Calls",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Pass Unanswered & Failed Attempts": {
      "main": [
        [
          {
            "node": "Merge All Synced Calls",
            "type": "main",
            "index": 1
          }
        ]
      ]
    },
    "Merge All Synced Calls": {
      "main": [
        [
          {
            "node": "Assemble Normalized Batches",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Assemble Normalized Batches": {
      "main": [
        [
          {
            "node": "Sync Calls to Thaara Backend",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "settings": {
    "executionOrder": "v1"
  }
}
'''

wf1 = json.loads(wf1_raw)
wf2 = json.loads(wf2_raw)

wf1['id'] = 'ThaaraCbNotif001'
wf2['id'] = 'ThaarSarvamSync1'

# Substitute token in HTTP Request headers
for node in wf1.get('nodes', []):
    if node.get('name') in ['Verify Consent & Claim Single Delivery', 'Record Delivery Receipt', 'Release Claim for Retry']:
        params = node.get('parameters', {})
        header_params = params.get('headerParameters', {}).get('parameters', [])
        for hp in header_params:
            if hp.get('name') == 'x-thaara-phone-sync-token':
                hp['value'] = derived_token

for node in wf2.get('nodes', []):
    if node.get('name') in ['Fetch Sync Checkpoint', 'Send Call Batch to Thaara']:
        params = node.get('parameters', {})
        header_params = params.get('headerParameters', {}).get('parameters', [])
        for hp in header_params:
            if hp.get('name') == 'x-thaara-phone-sync-token':
                hp['value'] = derived_token

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
stage.mkdir(parents=True, exist_ok=True)
wf1_path = stage / 'wf1.json'
wf2_path = stage / 'wf2.json'

wf1_path.write_text(json.dumps(wf1, indent=2), encoding='utf-8')
wf2_path.write_text(json.dumps(wf2, indent=2), encoding='utf-8')

# Copy into container
subprocess.run(['docker', 'cp', str(wf1_path), 'n8n-n8n-1:/tmp/wf1.json'], check=True)
subprocess.run(['docker', 'cp', str(wf2_path), 'n8n-n8n-1:/tmp/wf2.json'], check=True)

# Run n8n import:workflow
p1 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf1.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF1:\n", p1.stdout, p1.stderr)

p2 = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf2.json', f'--projectId={PROJECT_ID}'], capture_output=True, text=True)
print("Import WF2:\n", p2.stdout, p2.stderr)

# Activate both workflows in sqlite
act_p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  if (err) { console.error(err); process.exit(1); }
  db.run("UPDATE workflow_entity SET active = 1 WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err2) => {
    if (err2) { console.error(err2); process.exit(1); }
    db.all("SELECT id, name, active FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err3, rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print("Activated rows:\n", act_p.stdout, act_p.stderr)

# Restart n8n container to register active triggers
subprocess.run(['docker', 'restart', 'n8n-n8n-1'], check=True)
print("n8n restarted successfully.")
