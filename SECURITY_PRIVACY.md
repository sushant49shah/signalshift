# SignalShift AI — Security and Privacy Plan

Version: 1.0 · Date: 16 October 2026 · Scope: consented hackathon prototype

## 1. Purpose and limits
Protect voice data, video-call access, credentials, and the integrity of interview results. This is an engineering plan, not a legal compliance opinion or certification. The prototype must not be used to make automated hiring decisions. Production deployment needs independent legal/privacy review, security testing, retention agreements, and a trusted enrollment process.

## 2. Data inventory and handling
| Data | Location/destination | Proposed handling |
|---|---|---|
| Live audio/video | Participant browsers and LiveKit Cloud media transport | No application recording/egress enabled; verify vendor handling separately |
| Reference voice sample | Browser memory → application server → DetectifAI | Transient upload; no application disk/database persistence |
| Analysis clips | Browser memory → application server → DetectifAI | Release buffers after completion/cancellation; no application archive |
| Vendor speaker representation | DetectifAI | Session-scoped enrollment; attempt deletion at session end |
| Results and question metadata | Interviewer browser sessionStorage | Retained for current tab/session until cleared; JSON export optional |
| Consent receipt | Signed session claims and local metadata | Notice version/time; not a durable production audit record |
| API secrets | Server environment | Never browser, source control, screenshots, exports, or logs |
| Operational logs | Hosting/provider systems | Minimal sanitized diagnostics; retention settings require verification |

Application memory release does not prove deletion from infrastructure or vendors. DetectifAI/LiveKit retention, subprocessors, regions, and deletion guarantees have not been verified. Do not promise zero retention or end-to-end encryption. Voice analysis necessarily requires audio access at the analysis service.

## 3. Consent and notice
Before enrollment, disclose: audio is compared with a voice reference and assessed for synthetic speech; video/audio travel through LiveKit; voice clips are sent through the application to DetectifAI; results can be wrong; an interviewer reviews concerns; no automatic candidate rejection; how to withdraw; what local metadata remains.

Use affirmative unchecked consent. Explain camera/microphone permissions separately. Give a visible “Stop analysis / withdraw consent” action. On withdrawal, stop capture and queued uploads immediately, abort in-flight requests where possible, and disclose that already transmitted audio cannot be recalled. Notify interviewer and close or pause the interview analysis flow. Make an enrollment-cleanup attempt and show its result.

The no-database MVP cannot guarantee immediate revocation against a malicious client holding an unexpired signed token. Short token lifetimes reduce exposure; production requires shared revocation state and server-enforced consent lifecycle.

## 4. Authentication and authorization
Use scoped capabilities instead of account login for judge-accessible demo sessions. Guest access is not unrestricted administration. Generate unpredictable room/session identifiers. Candidate tokens cannot impersonate interviewer identities or create arbitrary enrollment bindings. Issue LiveKit permissions for exactly one room and the necessary publish/subscribe actions.

Avoid long-lived bearer tokens in URLs. Prefer fragment-based invitation exchange and HttpOnly Secure SameSite cookies. Strip invitations from the address after exchange. No third-party analytics on invite pages. Configure a restrictive referrer policy. Expire sessions and capabilities; disclose that a shared invitation grants access to its holder.

## 5. Threat model
| Threat | Control | Residual limitation |
|---|---|---|
| Secret leakage | Server-only environment, redaction, no public-prefixed secret variables | Hosting/account compromise remains possible |
| Uninvited room access | Random IDs, scoped tokens, stable role identities, short expiry | Shared invite is a transferable credential |
| Candidate swaps speaker ID | Server-generated ID and signed session binding | Initial enrollment still needs trusted identity outside MVP |
| Synthetic/replayed speech | Both API checks, fresh sample and human observation | Detection and prompt freshness cannot guarantee liveness |
| Wrong participant analyzed | Identity-bound remote track, fail on track/identity ambiguity | Acoustic echo may contaminate otherwise separate tracks |
| Credit exhaustion/abuse | Upload size/duration checks, bounded queue, server/edge rate controls | Client-only throttling is insufficient; shared enforcement may require service setup |
| Result tampering | Server calls vendor; normalize only returned values | Browser summary is not a tamper-proof audit record |
| Cross-session data access | Verify role, session, consent, speaker binding on every route | Stateless revocation limitations apply |
| XSS via question/title | React escaping, validation, no unsafe HTML rendering | Dependencies and future rich text require review |
| Hidden processing after withdrawal | Stop tracks/queues, short-lived authority, visible state | Previously transmitted data and malicious clients require stronger controls |

## 6. Request hardening
Validate MIME signature/decodability, size, duration, allowed form fields, and capability claims. Do not accept arbitrary fetch URLs for analysis. Reject cross-origin requests as appropriate and use CSRF protection with cookie authentication. Bound response/body sizes, retries, and execution time. Do not return upstream stack traces or full raw error objects to the browser.

Before public deployment, confirm an effective server/edge rate limit and sufficient credit ceiling. A process-local counter on serverless infrastructure is not a reliable global limit. If unavailable, restrict the demo deployment and record the unmet public-abuse requirement rather than claiming protection exists.

## 7. Fairness and consequential decisions
Use “verification needed,” never “cheating confirmed.” No global honesty/risk score or automatic rejection. Low quality, accents, language, noise, disability-related speech differences, and technical failure must not be represented as misconduct. Detection is documented as tuned for English; do not generalize evaluation results to other languages.

A voice match indicates similarity to a reference only. Recheck success applies to that sample only. Keep uncertainty and coverage gaps visible. Interviewers can repeat questions or use an alternative human verification process.

## 8. Retention and deletion lifecycle
- During session: retain audio only for current capture, bounded queue, and active request.
- After result: release application-held buffers when no retry is needed.
- End/withdrawal: cancel unsent work, clear buffers, disconnect capture, attempt speaker deletion, report failure truthfully.
- Summary: allow explicit local clearing; exports remain under the user's control and cannot be remotely recalled.
- Browser crash: automatic vendor cleanup cannot be guaranteed without a backend store/scheduler. Use session-scoped IDs and an authorized manual cleanup procedure after the demo. Track this as a known gap.

## 9. Incident response
On exposed key: stop affected analysis, revoke/rotate through the provider, inspect sanitized usage, and redeploy with the new secret. On unauthorized join: end the room and create a new invitation; investigate expiry/access controls. On accidental logging: stop logging the payload, identify affected systems, and follow provider deletion/escalation procedures. Record facts without redistributing sensitive data.

## 10. Launch checklist
Consent works; keys absent from browser/build/logs; role isolation tested; server upload validation active; analysis stops on withdrawal; cleanup outcome visible; no raw recording persistence; no false retention claims; real API results labeled correctly; no unconsented test voices. For hackathon test audio, follow the organiser's restrictions, including the stated restriction on public figures, staff, and other participants; obtain clarification before using team-member voices if the wording is ambiguous.
