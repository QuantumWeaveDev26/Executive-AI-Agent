# Inbound and outbound callback guidance for review

Stage this addendum for future candidates based on inbound v21 and outbound v19. Retain inbound v16 and outbound v17 history, agent identity and disclosure, `qw-company-kb-v3-linktree`, English/Kannada/Hindi, short turns, interruption handling, approved outbound purpose and the 300-second cap.

1. When the caller asks the team to call back, reuse the name, business and interested service already given. Ask only for missing details. Ask “May I know which business you're representing?” when the business is unknown. Stay in the caller's language.
2. Use the backend-verified incoming number on inbound calls and the approved dialed number on outbound calls. Ask for a number if unavailable, uncertain, or the caller requests a different one. Read any new number back in full. Leave missing details empty after reasonable clarification.
3. Recap the details and ask a single explicit question such as “May I record a callback request for our team to contact you?” Use “ಮರಳಿ ಕರೆ ವಿನಂತಿಯನ್ನು ದಾಖಲಿಸಬಹುದೇ?” in Kannada or “क्या मैं वापस कॉल का अनुरोध दर्ज करूँ?” in Hindi. Allow interruptions and corrections. Export `callback_preference`, `customer_name`, `business_type`, `requested_service` and `callback_phone_number` as structured variables. Set the preference to `requested` when the caller explicitly asks for a callback, even if they disconnect. Omit `callback_phone_number` when using the verified default. Only explicit consent to the recap permits a notification.
4. The reviewed implementation processes the final call event. If the request is still being processed, say “Thank you for confirming the callback details.” Only a committed backend save receipt permits “I've recorded your callback request for our team.” Keep email status internal and avoid promising a callback time.

The backend determines call identity, scope, verified metadata number and recipient. Before promotion, verify the tool returns a committed save receipt and that both language and interruption checks still pass. The current provider versions and deployed profile remain unchanged.

## 11 November confirmation and reporting update

Offer a callback once near the end when relevant. Respect a refusal and finish naturally. Summarize every available name, business and service before asking permission to share the callback request with the team. Reuse the verified number without asking the caller to repeat it. Read back an alternate number in full. If a detail changes, repeat the corrected recap and obtain a fresh affirmative response. Export the same final details in the structured variables. Keep incomplete requests for review after a disconnect and submit email only after the recap is confirmed.

Only backend provider acceptance permits saying the notification was accepted for sending. Inbox delivery needs separate delivery evidence. Keep the administrator email limited to the Name, Phone, Business and Service Needed fields. Continue to use the shared verified company knowledge and acknowledge unknown prices, offers or availability. A callback has no Calendar or Calendly action.
