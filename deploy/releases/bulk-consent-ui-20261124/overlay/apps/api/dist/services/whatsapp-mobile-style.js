/** WhatsApp presentation only. No authorization, knowledge or memory changes. */
export function whatsappFirstGreeting(language = 'en') {
    if (language === 'kn')
        return 'ನಮಸ್ಕಾರ! ನಾನು ಥಾರಾ, Quantum Weave AI ನ AI ಸಹಾಯಕ.\n\nಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?';
    if (language === 'hi')
        return 'नमस्ते! मैं थारा हूँ, Quantum Weave AI से एक AI सहायक।\n\nआज मैं आपकी क्या सहायता कर सकती हूँ?';
    return "Hi! I'm Thaara, Quantum Weave AI's assistant. May I know your name?";
}
export const WHATSAPP_MOBILE_STYLE = `WHATSAPP MOBILE RESPONSE STYLE:
- For simple questions prefer 1–2 short sentences, usually 10–35 words when sufficient.
- Answer the actual question first, including a real question accompanying a greeting. Never force a sales script.
- Warm, natural Indian business communication; avoid sales filler and repeated introductions.
- Ask at most one contextually relevant follow-up question. Never collect fields just to fill a register.
- Put different thoughts in short paragraphs separated by blank lines. Use plain-text Unicode • bullets for lists.
- No Markdown tables, decorative headings, excessive bold or large blocks of text.
- Preserve every necessary detail in technical, urgent or complex answers, even when longer. Never truncate for length.
- Return one message with natural line breaks, not several API messages. Preserve URLs exactly.
- These style rules apply only to customer-facing WhatsApp prose, never tool calls or structured outputs.`;
export function formatWhatsAppMobileReply(text) {
    const value = text.trim();
    if (!value)
        return value;
    // Structured content must retain its original representation.
    if (/^[{[]/.test(value)) {
        try {
            JSON.parse(value);
            return text;
        }
        catch { /* customer prose */ }
    }
    const urls = [];
    const protectedText = value.replace(/https?:\/\/[^\s<>]+/g, url => { const id = urls.push(url) - 1; return `\u0001WAURL${id}\u0002`; });
    return protectedText.replace(/\r\n?/g, '\n')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/^[ \t]*(?:[-*]|\d+[.)])[ \t]+(?=\S)/gm, '• ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\u0001WAURL(\d+)\u0002/g, (_match, index) => urls[Number(index)]);
}
//# sourceMappingURL=whatsapp-mobile-style.js.map