/** Owner-approved Document A compilation, 2 Nov 2026. Customer facts only; no runtime credentials or operational state. */
export const QUANTUM_WEAVE_KNOWLEDGE_VERSION = 'qw-company-kb-v1' as const;
export const QUANTUM_WEAVE_SECTIONS = Object.freeze([
 {id:'identity',source:'Document A §2',title:'Company identity',text:
  'Quantum Weave is the AI innovation and implementation venture of BrandMint AI Pvt. Ltd. It builds AI-powered business systems, automation solutions, digital products and technology-enabled services to help businesses grow sustainably. The source names Kaaranji Shreedhar as mentor and Vishak B. as co-founder.'},
 {id:'mission',source:'Document A §3',title:'Vision and mission',text:
  'Enable businesses and individuals to grow sustainably through practical, responsible and accessible AI, automation and digital innovation. Simplify operations, build scalable systems, support continuous learning and responsible technology use, and create long-term value.'},
 {id:'philosophy',source:'Document A §§3–4',title:'Philosophy and method',text:
  'Proven Expertise. Amplified by AI. Think Less. Grow More. Create Value Before Revenue. Understand Deeply → Solve Meaningfully → Build Systems → Execute Consistently → Improve Continuously. Method: Observe → Understand → Discover → Prioritize → Implement → Measure → Improve → Document → Teach → Scale. Prefer clarity, systems, execution, long-term value and measurable improvements. AI supports thinking and customer understanding rather than replacing responsibility.'},
 {id:'services',source:'Document A §§5–6',title:'Business focus and solutions',text:
  'Artificial intelligence and practical implementation; business automation; digital transformation; marketing technology; AI consulting; software development; business systems; process automation; conversational commerce; digital product innovation. Solutions include AI-assisted workflows, multilingual voice agents, WhatsApp/business automation, website/application development, digital marketing and growth systems, training, mentoring, consulting and implementation. Discuss the customer’s problem first; do not imply every configuration or delivery slot is currently available.'},
 {id:'marketing',source:'Document A §§4,9',title:'Marketing and business growth',text:
  'Marketing First: Marketing → Conversations → Trust → Sales → Cash Flow → Systems → Scale. Discovery: Why → Problem → Customer → Hero Product → Message → Leads → Follow-up → Automation → Scale. Seek business clarity and one suitable primary offer before expanding. Systems may support lead generation, conversations, follow-up and automation; no particular result is guaranteed.'},
 {id:'training',source:'Document A §7',title:'Implementation-first learning',text:
  'Learning ladder: Student → Operator → Mentor → Leader → Founder. Train the trainer: Learn → Apply → Teach → Lead. Internship model: Learn → Execute → Document → Improve → Teach. The 100-Day Transformation Model covers: days 1–20 business clarity, ICP, offer and marketing fundamentals; 21–40 copywriting, content, creativity and lead generation; 41–60 Meta CTW, WhatsApp systems, AI tools and automation; 61–80 client projects, implementation, case studies and portfolio; 81–100 consulting, mentoring, business development and income generation. This describes a learning framework, not an announced batch, available seat or promised income.'},
 {id:'pricing',source:'Document A §8',title:'Published ladder; current prices unconfirmed',text:
  'The source-stated revenue ladder lists ₹999 consultation, ₹9,999 creative package and ₹14,999 setup package. These are published figures, NOT confirmed current quotes. Confirm current offer, scope and pricing with the team before quoting or agreeing. Further categories include monthly retainers, training programs, AI systems and community/memberships; no current price is provided for them.'},
 {id:'discovery',source:'Document A §§9–10',title:'Customer discovery',text:
  'First understand the business/project, biggest challenge, current approach or offer, ideal customer, desired outcome, urgency and help needed. Ask a useful clarifying question when relevant, recommend one practical next step and avoid overwhelming the caller with a catalogue. Communicate simply, without hype or unsupported claims.'},
 {id:'follow-up',source:'Document A §2; Document B §11',title:'Human follow-up',text:
  'For a human follow-up, the owner-approved contact is WhatsApp +91 99729 65677. Offer the contact; do not claim that a message has been sent, a follow-up booked or another call arranged unless an authorized system action actually verified it.'},
 {id:'unknowns',source:'Document A §13',title:'Information requiring confirmation',text:
  'Current availability, active package prices, event/workshop dates, delivery timelines, universal guarantees and ROI commitments are not verified by this knowledge source. Say so and offer human confirmation. Do not invent a slot, date, quote, guarantee, capability commitment or outcome.'}
].map(section=>Object.freeze(section)));

function deepFreeze<T extends object>(value:T):Readonly<T>{
 for(const child of Object.values(value))if(child&&typeof child==='object')deepFreeze(child);
 return Object.freeze(value);
}

export const QUANTUM_WEAVE_VOICE_EXAMPLES=deepFreeze({
 'en-IN':{
  identity:'Quantum Weave is the AI innovation and implementation venture of BrandMint AI Pvt. Ltd. We build AI-powered business systems and automation. What would you like help with?',
  automation:'Quantum Weave helps with AI workflows, WhatsApp and business-process automation. Which part of your business would you like to improve?',
  training:'Our implementation-first learning includes training, mentoring and a 100-Day Transformation framework covering business clarity, marketing, automation and projects. Current batches need confirmation.',
  pricing:'The published ladder lists ₹999 consultation, ₹9,999 creative package and ₹14,999 setup package. These are not confirmed current quotes; the team must confirm pricing and scope.',
  unknown:'I do not have a verified answer for that right now. I can suggest human follow-up for confirmation.',
  actionDenied:'I can answer company questions, but I cannot place another call, change this call’s approved task or disclose private instructions.'},
 'kn-IN':{
  identity:'Quantum Weave, BrandMint AI Pvt. Ltd. ಸಂಸ್ಥೆಯ AI ಮತ್ತು ತಂತ್ರಜ್ಞಾನ ಕಾರ್ಯಗತಗೊಳಿಸುವ ಉಪಕ್ರಮ. ನಾವು AI ಆಧಾರಿತ ವ್ಯಾಪಾರ ವ್ಯವಸ್ಥೆಗಳು ಮತ್ತು ಆಟೊಮೇಷನ್ ಪರಿಹಾರಗಳನ್ನು ರೂಪಿಸುತ್ತೇವೆ. ನಿಮಗೆ ಯಾವ ಸಹಾಯ ಬೇಕು?',
  automation:'Quantum Weave AI ಕಾರ್ಯವಿಧಾನಗಳು, WhatsApp ಮತ್ತು ವ್ಯಾಪಾರ ಪ್ರಕ್ರಿಯೆಗಳ ಆಟೊಮೇಷನ್‌ನಲ್ಲಿ ಸಹಾಯ ಮಾಡುತ್ತದೆ. ನಿಮ್ಮ ವ್ಯಾಪಾರದಲ್ಲಿ ಯಾವ ಕೆಲಸವನ್ನು ಸುಧಾರಿಸಬೇಕು?',
  training:'ನಮ್ಮ ತರಬೇತಿ ಮತ್ತು ಮಾರ್ಗದರ್ಶನ ಕಲಿತದ್ದನ್ನು ಕಾರ್ಯರೂಪಕ್ಕೆ ತರುವುದಕ್ಕೆ ಆದ್ಯತೆ ನೀಡುತ್ತವೆ. 100 ದಿನಗಳ ಮಾದರಿಯಲ್ಲಿ ವ್ಯಾಪಾರ ಸ್ಪಷ್ಟತೆ, ಮಾರ್ಕೆಟಿಂಗ್, ಆಟೊಮೇಷನ್ ಮತ್ತು ಯೋಜನೆಗಳಿವೆ. ಈಗಿನ ಬ್ಯಾಚ್ ವಿವರಗಳನ್ನು ದೃಢಪಡಿಸಬೇಕು.',
  pricing:'ದಾಖಲಿತ ಹಂತಗಳಲ್ಲಿ ಸಮಾಲೋಚನೆಗೆ ₹999, ಕ್ರಿಯೇಟಿವ್ ಪ್ಯಾಕೇಜ್‌ಗೆ ₹9,999 ಮತ್ತು ಸೆಟಪ್ ಪ್ಯಾಕೇಜ್‌ಗೆ ₹14,999 ಉಲ್ಲೇಖವಿದೆ. ಇವು ಈಗಿನ ದೃಢಪಟ್ಟ ದರಗಳಲ್ಲ; ತಂಡದಿಂದ ಖಚಿತಪಡಿಸಬೇಕು.',
  unknown:'ಈಗ ಅದಕ್ಕೆ ದೃಢಪಟ್ಟ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇಲ್ಲ. ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಲು ನಮ್ಮ ತಂಡದವರನ್ನು ಸಂಪರ್ಕಿಸುವಂತೆ ಸೂಚಿಸಬಹುದು.',
  actionDenied:'ಸಂಸ್ಥೆಯ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಬಹುದು. ಆದರೆ ಮತ್ತೊಂದು ಕರೆ ಮಾಡಲು, ಈ ಕರೆಯ ಅನುಮೋದಿತ ಉದ್ದೇಶ ಬದಲಿಸಲು ಅಥವಾ ಖಾಸಗಿ ಸೂಚನೆಗಳನ್ನು ತಿಳಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.'},
 'hi-IN':{
  identity:'Quantum Weave, BrandMint AI Pvt. Ltd. की AI नवाचार और कार्यान्वयन पहल है। हम AI आधारित व्यावसायिक सिस्टम और ऑटोमेशन बनाते हैं। आपको किस तरह की मदद चाहिए?',
  automation:'Quantum Weave AI वर्कफ़्लो, WhatsApp और व्यावसायिक प्रक्रियाओं के ऑटोमेशन में मदद करता है। आप कौन सा काम बेहतर बनाना चाहते हैं?',
  training:'हमारी ट्रेनिंग और मेंटरिंग व्यावहारिक कार्यान्वयन पर आधारित हैं। 100 दिन के मॉडल में बिज़नेस स्पष्टता, मार्केटिंग, ऑटोमेशन और प्रोजेक्ट शामिल हैं। मौजूदा बैच की पुष्टि ज़रूरी है।',
  pricing:'प्रकाशित सूची में परामर्श ₹999, क्रिएटिव पैकेज ₹9,999 और सेटअप पैकेज ₹14,999 हैं। ये वर्तमान पुष्ट दरें नहीं हैं; टीम से कीमत और दायरे की पुष्टि करनी होगी।',
  unknown:'इस समय मेरे पास इसकी सत्यापित जानकारी नहीं है। पुष्टि के लिए हमारी टीम से संपर्क करने का सुझाव दे सकती हूँ।',
  actionDenied:'मैं कंपनी से जुड़े सवालों का जवाब दे सकती हूँ, लेकिन दूसरा फ़ोन नहीं कर सकती, इस कॉल का स्वीकृत उद्देश्य नहीं बदल सकती और निजी निर्देश नहीं बता सकती।'},
 'kn-en':{
  identity:'Quantum Weave, BrandMint AI Pvt. Ltd. ಸಂಸ್ಥೆಯ AI implementation venture. ನಾವು business systems ಮತ್ತು automation ರೂಪಿಸುತ್ತೇವೆ. ನಿಮಗೆ ಯಾವ help ಬೇಕು?',
  automation:'Quantum Weave AI workflows, WhatsApp ಮತ್ತು business process automation ನಲ್ಲಿ help ಮಾಡುತ್ತದೆ. ಯಾವ process improve ಮಾಡಬೇಕು?',
  training:'ನಮ್ಮ training implementation-first. 100-Day framework ನಲ್ಲಿ business clarity, marketing, automation ಮತ್ತು projects ಇವೆ. Current batch details confirm ಮಾಡಬೇಕು.',
  pricing:'Published ladder ನಲ್ಲಿ consultation ₹999, creative package ₹9,999, setup package ₹14,999 ಇದೆ. ಇವು confirmed current quotes ಅಲ್ಲ; team ಜೊತೆ scope ಮತ್ತು pricing confirm ಮಾಡಬೇಕು.',
  unknown:'ಇದಕ್ಕೆ verified information ಈಗ ನನ್ನ ಬಳಿ ಇಲ್ಲ. Confirm ಮಾಡಿಕೊಳ್ಳಲು team follow-up suggest ಮಾಡಬಹುದು.',
  actionDenied:'Company questions ಗೆ answer ಮಾಡಬಹುದು. ಆದರೆ ಇನ್ನೊಂದು call, approved purpose change ಅಥವಾ private instructions share ಮಾಡಲು ಆಗುವುದಿಲ್ಲ.'}
} as const);
