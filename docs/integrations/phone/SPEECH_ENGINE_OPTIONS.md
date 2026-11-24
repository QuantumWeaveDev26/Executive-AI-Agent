# Phone voice engines — options for English, Kannada and Kanglish (research, 29 Oct 2026)

Decision support only. No account, purchase, credential or code change was made. Prices change often and several figures
below come from third-party pages: **confirm on the vendor's own pricing page before budgeting.**

## What the call needs

Plivo streams **mu-law 8 kHz** audio both ways (`audio/x-mulaw;rate=8000`, see Plivo audio-streaming guide). Each call is short
(≤ 2–5 min), about 6 Thaara turns, each reply one short sentence. Per-turn budget in `PhoneVoiceSession` is 4 s per engine step.
So we need: **streaming speech-to-text (STT)** with partial + final results, **text-to-speech (TTS)** that can output mu-law 8 kHz
(or we transcode), and a **dialogue model** that returns `{text, endCall}` quickly. Kannada and English must both work;
Kanglish (mixed) is the hard case.

## 1. Speech-to-text

| Option | Kannada | Streaming | Telephony 8 kHz | Price (verify) | Notes |
|---|---|---|---|---|---|
| **Sarvam Saaras v4** | Yes (22 Indian languages) | WebSocket, vendor claims <150 ms first token | Not confirmed on the pages read | Docs: ₹30/hour (₹45 with diarization); one Kannada page shows ₹1.25/min — conflicting | India-focused; built for Indian speech including mixed English |
| **Google Cloud STT (Chirp)** | Yes, `kn-IN` listed for `chirp` | Yes (StreamingRecognize on Chirp 3) | `chirp_telephony` not confirmed for `kn-IN` | Not checked | Region limits (`kn-IN` shown in asia-southeast1) |
| **Azure AI Speech** | Yes (`kn-IN`) | Yes (real-time) | Supported generally; not confirmed for Kannada | Third-party estimate ~$1–2.50/hour (unverified) | Same vendor also has Kannada TTS voices |
| Deepgram | Vendor page claims Kannada real-time | Yes | Yes generally | Not checked | Kannada not in its newest multilingual conversational model; only vendor claims for accuracy |

**No public benchmark was found for Kannada-English code-mixed (Kanglish) speech** on any of these. Accuracy has to be measured
by us (see §5).

## 2. Text-to-speech

| Option | Kannada voices | Streaming | mu-law 8 kHz output | Price (verify) |
|---|---|---|---|---|
| **Sarvam Bulbul v3** | Yes (11 languages) | REST, HTTP streaming, **WebSocket** | **Yes — 8000 Hz and mu-law listed, incl. WebSocket** | ₹30 per 10,000 characters (Sarvam page / AWS Marketplace). Bulbul V4 Flash reported at ₹20/10k (third-party, unconfirmed; format support unconfirmed) |
| **Google Chirp 3: HD** | Yes (`kn-IN`) | Yes (streaming synthesis) | **MULAW listed for streaming** (sample rate not confirmed) | Not checked |
| **Azure Neural TTS** | Yes: `kn-IN-SapnaNeural` (female), `kn-IN-GaganNeural` (male), SSML | Yes | Azure offers telephony formats generally; not confirmed here | Per character; not checked |
| ElevenLabs | **Kannada not confirmed** for its fast models | Yes | — | Not checked |

## 3. Dialogue model (proposes one short sentence; no tools, no authority)

Thaara's existing model gateway is **OpenAI** (`OPENAI_MODEL`, default `gpt-4o-mini`). The phone dialogue engine is an injected
interface, so either provider fits without touching the safety rules (fixed disclosure/identity/closing lines, output gate, budgets).

| Option | Price per million tokens (input / output) | Notes |
|---|---|---|
| OpenAI `gpt-4o-mini` (current gateway) | $0.15 / $0.60 (third-party aggregators, Sept 2026) | Already configured; reuses existing key; no official latency figure found |
| Claude Opus 5.5 `claude-opus-5-5` (Anthropic's default recommendation) | $4 / $20 | Most capable; thinking is always on (lower `effort` to `low` for speed); structured output via `output_config.format` |
| Claude Sonnet 5.5 `claude-sonnet-5-5` | $2 / $10 | Faster/cheaper tier; can turn thinking off with `{type:"between_tools"}` |
| Claude Haiku 5.5 `claude-haiku-5-5` | $0.10 / $0.50 | Smallest tier; thinking can be disabled at effort `high` or below |

Rough model cost per call (6 turns × ~800 input + ~60 output tokens, excluding any thinking tokens): gpt-4o-mini ≈ $0.001,
Haiku 5.5 ≈ $0.0007, Sonnet 5.5 ≈ $0.013, Opus 5.5 ≈ $0.026. Prompt caching will not help much: the per-call prompt is
far below the minimum cacheable size. Which model is fast and natural enough in Kannada must be measured (§5) — choosing a
smaller model to save cost is your decision, not a default.

## 4. Recommendation (to confirm with a small test)

1. **Speech: Sarvam first** (Saaras v4 STT + Bulbul v3 TTS). It is the only option whose own docs confirm the exact telephony
   output format (mu-law 8 kHz over WebSocket), it is India-focused, and its list prices are in rupees and low (about ₹1 STT +
   ₹2 TTS for a typical 2-minute call). **Google Cloud** (Chirp STT + Chirp 3 HD TTS) as the comparison/fallback.
2. **Dialogue:** start with the **already-configured OpenAI gateway** (no new account) and compare one Claude model in the same
   test if you want; pick on measured Kannada quality and reply latency.
3. Do **not** choose on vendor accuracy claims; run §5.

## 5. How we would decide (local, no real calls)

- You record ~20 short consented test phrases (English, Kannada, Kanglish, with phone-like audio) — or we use public
  Kannada samples where licensing allows.
- Thaara runs them through each STT and measures word error rate and time to final text; plays each TTS voice back to you for a
  naturalness rating; times the dialogue model's reply.
- Results go into this document; you choose. Each vendor test needs that vendor's API key (owner setup below), entered by you.

## Test runner (built 29 Oct, not yet run)

`apps/api/test/phone-speech-sarvam.runtime.test.ts` sends each recording through the same phone path as a real call (8 kHz mu-law -> 16 kHz PCM -> Saaras v4), records word/character error rate and time to final text, synthesises the sample lines with Bulbul v3 and saves them as WAV for you to listen to. Example manifest: [speech-test-manifest.example.json](speech-test-manifest.example.json). Recordings: 16-bit PCM WAV, any sample rate, a few seconds each.

## Results

**29 Oct 2026, voice-only run (owner-approved; only the 3 fixed sample lines were sent; no recordings):** Sarvam Bulbul v3, speaker `shubh`, config `speech_sample_rate:'8000'`, `output_audio_codec:'mulaw'`. All three returned content type **`audio/mulaw`**, which resolves the docs conflict: phone-format audio is produced directly.

| Line | Audio length | Time to complete (incl. connection) |
|---|---|---|
| English (en-IN) | 3.44 s | 1,200 ms |
| Kannada (kn-IN) | 3.99 s | 1,012 ms |
| Kanglish (voiced en-IN) | 4.40 s | 1,061 ms |

Samples are in the owner's test folder (`output/tts-0*.wav`).

**Owner feedback (29 Oct):** English a little fast; Kannada okay; Kanglish (romanised text voiced with en-IN) unclear and mispronounced. Sarvam's Bulbul docs say romanised Indic input "significantly reduces output quality" and recommend native script for Indic words.

**Changes made:** female voice per the owner's *Thaara Personality Specification* (default `kavya`; Sarvam does not document speaker genders, so `kavya`/`kavitha`/`roopa` are rendered side by side for the owner to choose; comparison run 29 Oct, owner-approved: all 9 returned `audio/mulaw` in
1.1–1.7 s, audio 4.7–7.0 s, files `output/tts-<voice>-0N-<lang>.wav`; owner choice pending); pace en-IN 0.9, kn-IN 1.0, kn-en 0.95; Kanglish fixed lines rewritten in mixed script (Kannada words in Kannada script, English words in English) and voiced with `kn-IN`; dialogue instructions (`phone-persona.ts`) carry the persona and the mixed-script rule. Speech-to-text accuracy is not measured yet (no recordings).

## USER SETUP REQUIRED (only when you want the test in §5)

1. **Sarvam:** create an account at sarvam.ai yourself, open the API dashboard, create one API key. Do not paste it in chat.
2. *(Optional comparison)* **Google Cloud:** in your Google Cloud project, enable Speech-to-Text and Text-to-Speech and create
   a service account with only those roles. Do not paste keys in chat.
3. Tell Thaara "speech test accounts ready" with only the vendor names. Thaara will then give you the exact local place to store
   the keys yourself (an untracked local env file or secret store), never in chat or in Git.

## Sources

- [Sarvam pricing (docs)](https://docs.sarvam.ai/api/getting-started/pricing), [Sarvam Kannada STT](https://www.sarvam.ai/apis/speech-to-text/kannada), [Saaras V4 release (MarkTechPost)](https://www.marktechpost.com/2026/09/26/sarvam-ai-releases-saaras-v4-a-speech-to-text-model-for-all-22-indian-languages-and-global-english/), [Sarvam STT pricing (Smallest.ai)](https://smallest.ai/blog/sarvam-ai-speech-to-text-pricing)
- [Sarvam Bulbul model docs](https://docs.sarvam.ai/api-reference-docs/getting-started/models/bulbul), [Sarvam TTS overview](https://docs.sarvam.ai/api-reference-docs/text-to-speech/api/overview), [Sarvam TTS page](https://www.sarvam.ai/apis/text-to-speech.md), [AWS Marketplace listing](https://aws.amazon.com/marketplace/pp/prodview-7zok3fqtuzeqg), [Bulbul V4 Flash (Analytics Insight)](https://www.analyticsinsight.net/artificial-intelligence/sarvam-ai-bulbul-v4-flash-real-time-voice-model-for-indian-languages)
- [Google STT supported languages](https://cloud.google.com/speech-to-text/v2/docs/speech-to-text-supported-languages?hl=ja), [Google Chirp 3 STT](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3), [Google Chirp 3: HD voices](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)
- [Azure TTS overview](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech), [kn-IN Sapna voice](https://json2video.com/ai-voices/azure/voices/kn-in-sapnaneural), [kn-IN Gagan voice](https://json2video.com/ai-voices/azure/voices/kn-in-gaganneural/), [Kannada ASR roundup (Gnani, vendor)](https://www.gnani.ai/resources/blogs/best-kannada-asr-tools-for-indian-languages-in-2026)
- [Deepgram Kannada](https://deepgram.com/product/speech-to-text/kannada), [Deepgram Flux multilingual (SiliconANGLE)](https://siliconangle.com/?p=743179), [Nova-3 language expansion](https://techdefused.com/a/511ni4g/deepgram-adds-12-languages-to-nova-3-speech-model-expanding-support-in-europe-an)
- [ElevenLabs TTS docs](https://elevenlabs.io/docs/capabilities/text-to-speech)
- [Code-mixed Indic ASR paper](https://cs.paperswithcode.com/paper/code-switched-and-code-mixed-speech), [CoLI-Kanglish shared task (text only)](https://aclanthology.org/2022.icon-wlli.pdf)
- [gpt-4o-mini pricing (aggregator)](https://anotherwrapper.com/llm-pricing/gpt-4o-mini-2024-07-18); Claude model IDs and prices from Anthropic's current model table (cached 6 Oct 2026)
- [Plivo audio streaming guide](https://www.plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-guide)
