# SignalShift AI — Technical Design

Version: 1.0 · Date: 16 October 2026 · Status: proposed architecture, not tested implementation

## 1. Stack and responsibilities
| Component | Choice | Responsibility |
|---|---|---|
| Application | Next.js App Router, React, TypeScript | Interview UI and server endpoints |
| Styling | Tailwind CSS, shadcn/ui | Accessible reusable UI components |
| Media transport | LiveKit Cloud, livekit-client, @livekit/components-react | Two-party video/audio room |
| Token issuance | livekit-server-sdk on server | Restricted room tokens |
| Capture | Web Audio API, AudioWorklet, WAV encoder | Candidate-only independent audio windows |
| Analysis | DetectifAI REST API | Enrollment and combined verification |
| Hosting | Vercel, Node.js route runtime | App/server hosting; not media relay |
| State | React and sessionStorage for metadata | Interviewer session and summary |

Pin compatible package versions during implementation. No specific version has been tested. No database, separate Python service, LLM, transcription provider, or recording archive is required for MVP. Browser-only history is a deliberate temporary limitation.

## 2. Architecture and trust boundary
```text
Candidate browser ←─ encrypted media transport ─→ LiveKit Cloud
                                                  ↕
                                         Interviewer browser
                                         candidate remote track
                                                  ↓
                                     PCM capture → WAV window
                                                  ↓ HTTPS
                                      Next.js analysis endpoint
                                                  ↓ bearer-auth upload
                                            DetectifAI
                                                  ↓
                                  Normalized result → question timeline
```

Capture the remote candidate track at the interviewer, so analysis corresponds to audio the interviewer receives. Bind the candidate by server-issued participant identity, not display name. Do not mix room audio. Headphones are recommended for demo clarity because acoustic echo can still contaminate a candidate microphone.

## 3. Proposed application routes
| Route | Method | Purpose |
|---|---|---|
| /api/sessions | POST | Create opaque session and role capabilities |
| /api/rooms/token | POST | Validate capability; issue role/room-scoped LiveKit token |
| /api/consent | POST | Validate candidate capability and affirmative notice acceptance; issue signed consent receipt |
| /api/enroll | POST | Validate consent, enroll sample, return signed speaker/session binding |
| /api/analyze | POST | Validate interviewer authority, consent/binding, and audio; call combined verification |
| /api/session/end | POST | Validate authority; close room and attempt enrollment cleanup |

These are proposed SignalShift endpoints, not DetectifAI endpoints. Validate all fields server-side. Protect same-origin routes with Origin checks and appropriate CSRF controls when cookies are used. Public session creation still needs abuse controls; see SECURITY_PRIVACY.md.

## 4. Session authority without a database
Use high-entropy session IDs and signed, expiring role capabilities. Candidate invitations confer candidate permissions only. Exchange a fragment-based invite for an HttpOnly, Secure, SameSite session cookie where practical; remove the fragment after exchange. Do not place secrets in logs or exports.

Signed claims include sessionId, roomName, participantIdentity, role, expiration, and nonce. A server-signed enrollment binding includes sessionId, candidateIdentity, generated speakerId, and consent receipt reference. Never trust a client-supplied speaker ID alone.

Stateless capabilities cannot provide durable revocation, distributed rate accounting, single-use invite enforcement, or a tamper-resistant audit trail. End-session closes the LiveKit room, stops cooperative clients, and attempts vendor deletion, but an unexpired capability is not cryptographically revoked. Keep capabilities short-lived and document this demo limitation. A shared store is required before production use; add one if robust revocation is required during the hackathon.

## 5. Enrollment
Record 20–30 seconds with explicit consent. The documented range is 15–60 seconds with at least 10 seconds of speech. Create a pseudonymous speaker ID, not a name or email. Use POST /v1/speakers/enroll after validating its exact request schema against current OpenAPI; the full enrollment schema was not inspected during this planning session. Do not invent undocumented fields.

Enrollment success does not attest legal identity or guaranteed genuine speech. Optionally run a separate deepfake check on the reference if time/credits permit, retaining its uncertainty. It must not replace a trusted identity process.

## 6. Audio capture and windowing
Subscribe to the designated candidate audio track. Create a Web Audio source from that track and capture mono PCM in an AudioWorklet with a muted output path to avoid duplicate playback. LiveKit remains responsible for normal audio playback.

Encode each window as a complete 16-bit PCM WAV with correct sample rate, lengths, and headers. Keep the actual AudioContext sample rate unless conversion is explicitly needed; never relabel sample rate without resampling. Do not assume arbitrary MediaRecorder timeslice fragments are independently decodable files.

Initial window: approximately 8 seconds, configurable after measurement. Both checks require more than 4 seconds for the combined flow. Question changes flush capture; short remainders are recorded as unanalyzed gaps. Pauses, track replacement, mute, consent withdrawal, and disconnect close the current window. Detect actual speech adequacy through API response; a local energy threshold can suppress obvious silence but is not proof of speech.

## 7. DetectifAI adapter
Base URL: https://platform.detectif.ai/v1. Server stores DETECTIF_API_KEY and sends Authorization: Bearer. Upload multipart file fields; do not manually set a multipart boundary.

Combined analysis: POST /speakers/verify with file, speaker_id, detect_deepfake=true. Requires appropriate speaker-verification and deepfake scopes. Checks consume credits separately. Speaker result uses decision match/no_match and similarity in [-1,1], not a percentage. Deepfake uses verdict real/fake/not_sure. Follow verdict rather than thresholding the legacy score.

The docs describe partial failures: deepfake.error when speaker verification completes; partial synthetic-speech output when speaker verification fails. Validate the exact nested schema using current OpenAPI and one real response before implementing the normalizer. Preserve successful portions and explicit failure metadata; never assume HTTP 200 means both checks succeeded.

Documented limits: deepfake >4 to 120 seconds; verification 3–60 seconds and ≥2 seconds speech; enrollment 15–60 seconds and ≥10 seconds speech. WAV and WebM are among supported formats. Internal uploads should be much smaller than the provider's 100 MB maximum. Proposed application cap: 10 MB, reduced if the host's actual request-body limit is lower. Check deployment limits before launch.

## 8. Queue, retries, and timing
One analysis request in flight per interview; queue at most two completed windows. When overloaded, discard the oldest unsent window and record its interval as a gap. Never allow an unbounded backlog disguised as live monitoring.

Use a unique idempotency key per logical operation; reuse it only with the same bytes/fields on retry. Proposed maximum: two retries for transient network failures and 429/502/503/504, respecting Retry-After. For HTTP conflict indicating an in-flight request, wait before reusing the same key. Do not retry validation, authentication, or credit errors automatically.

Choose a finite request timeout within the deployed function budget (initial target 30 seconds only if hosting permits). A late retry cannot be labeled a current check. Track captureStart, captureEnd, submittedAt, receivedAt, and monotonic sequence. End-to-end delay is receivedAt minus captureEnd, while the alert also reflects the initial capture window duration. Publish measured values only.

## 9. Domain model
```typescript
type SpeakerDecision = 'match' | 'no_match' | 'unavailable';
type DeepfakeVerdict = 'real' | 'fake' | 'not_sure' | 'unavailable';
type Outcome = 'passed' | 'concern' | 'incomplete';
interface IntervalResult {
  id: string; sessionId: string; questionId: string;
  kind: 'answer' | 'recheck'; rechecksAnswerId?: string;
  sequence: number; captureStartMs: number; captureEndMs: number;
  submittedAt?: string; receivedAt?: string;
  speaker: SpeakerDecision; deepfake: DeepfakeVerdict;
  outcome: Outcome; partialFailure: boolean;
  operationId?: string; safeErrorCode?: string;
}
```

Store question review dispositions separately from immutable interval results. Deduplicate interval IDs, reject inconsistent session bindings, and attach out-of-order responses to the original question. Result normalization is deterministic and unit-tested against FRD precedence rules.

## 10. Persistence, cleanup, and observability
SessionStorage contains sanitized metadata only. Do not persist raw PCM, WAV, keys, invites, or embeddings. After refresh, restore history but require media reconnection; never resume monitoring silently. No server-process Map is a reliable session store on serverless hosting.

Structured logs contain internal request ID, safe status code, duration, and retry count. Redact payloads and secrets. End session stops tracks/worklets, cancels queued uploads, clears audio buffers, disconnects media, and attempts deleting the vendor enrollment using the documented speaker-delete endpoint after its contract is checked. A failed cleanup is surfaced; never claim deletion succeeded without confirmation.

## 11. Integration gates and sources
Before declaring feasibility proven: test two browsers, remote track extraction, complete WAV acceptance, actual enrollment schema, combined partial-result normalization, quota behavior, Vercel upload/duration limits, and LiveKit token permissions.

Sources reviewed: https://platform.detectif.ai/docs/api/ ; https://platform.detectif.ai/docs/audio-and-limits/ ; https://platform.detectif.ai/docs/api/verify-speaker/ ; https://platform.detectif.ai/docs/api/detect-deepfake/ ; https://docs.livekit.io/transport/media/subscribe/ . API latency, model accuracy, account quotas, and vendor retention were not independently measured or verified.
