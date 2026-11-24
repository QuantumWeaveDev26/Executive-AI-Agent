const TEXT = 'server.event.transcription';
const INTERRUPT = 'server.event.user_interrupt';
const AUDIO = 'server.media.audio_chunk';

// Measure only the test conversation. The caller keeps no raw audio or text.
export function createVoiceObservation(version) {
  if (version !== 19 && version !== 21) throw new Error('unreviewed_voice_version');
  let introRecognized = false;
  let speechAfterIntro = false;
  let interruptionStarted = false;
  let interruptSignalObserved = false;
  let questionMatched = false;
  let answerMatched = false;
  let aiDisclosureTranscript = false;

  return {
    observe(message) {
      const text = typeof message.content === 'string' ? message.content.toLowerCase() : '';
      if (message.type === TEXT && message.role === 'bot' && !introRecognized) {
        aiDisclosureTranscript ||= /\b(ai|artificial intelligence)\b/.test(text);
      }
      if (message.type === TEXT && message.role === 'user' && !interruptionStarted) {
        introRecognized ||= /services/.test(text) && /quantum\s*weave/.test(text);
      }
      if (message.type === AUDIO && introRecognized && !interruptionStarted && message.audio_base64) {
        speechAfterIntro = true;
      }
      if (message.type === INTERRUPT && interruptionStarted) interruptSignalObserved = true;
      if (message.type === TEXT && message.role === 'user' && interruptionStarted) {
        questionMatched ||= /mobile\s+apps?/.test(text) && /business/.test(text);
      }
      if (message.type === TEXT && message.role === 'bot' && interruptSignalObserved && questionMatched) {
        answerMatched ||= /\b(apps?|applications?)\b/.test(text) && /\b(build|develop|create|design|offer)\w*\b/.test(text);
      }
    },
    readyToInterrupt: () => speechAfterIntro && !interruptionStarted,
    startInterruption() {
      if (!speechAfterIntro || interruptionStarted) throw new Error('interruption_not_during_agent_audio');
      interruptionStarted = true;
    },
    result() {
      return { version, interruptSignalObserved, questionMatched, answerMatched, aiDisclosureTranscript };
    },
  };
}
