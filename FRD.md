# SignalShift AI — Functional Requirements Document

Version: 1.0 · Date: 16 October 2026 · Status: proposed requirements

## 1. Actors and permissions
**Interviewer:** creates a session, invites a candidate, manages questions, sees detailed results, requests a recheck, records dispositions, ends the session, exports the summary.

**Candidate:** joins their invited room, provides/withdraws consent, controls camera and microphone, provides reference/recheck speech, and sees understandable session prompts. Cannot change enrollment binding, analysis results, or interviewer dispositions.

**Server:** validates session authority, creates room-scoped LiveKit tokens, binds speaker references, calls DetectifAI, and returns normalized results. API credentials are never provided to either browser.

## 2. Functional requirements
| ID | Requirement and observable result |
|---|---|
| FR-01 | Create a session with an opaque ID, interviewer capability, candidate invitation, and editable question list. No account login required for the hackathon demo. |
| FR-02 | Issue short-lived, room- and role-scoped media tokens. Reject an expired invitation, invalid capability, or third participant identity. |
| FR-03 | Show the voice-processing notice before enrollment or monitoring. Store notice version, affirmative consent timestamp, and session reference. |
| FR-04 | Separate consent from browser permissions. A microphone permission grant alone is not consent to vendor processing. |
| FR-05 | Establish a two-party video call. Camera disabled is visibly distinct from call failure. Microphone muted means no analyzable speech. |
| FR-06 | Capture a 20–30-second reference, meeting the documented 15–60-second range and speech requirement. Enrollment failure prevents monitoring from appearing ready. |
| FR-07 | Bind the generated speaker ID to the current session on the server. A client cannot substitute an arbitrary enrolled speaker. |
| FR-08 | Allow interviewer to start/advance questions and pause monitoring. Every capture window retains the question ID active when capture began. |
| FR-09 | Analyze only the candidate's subscribed audio track, using complete independently decodable files. No mixed room audio or camera images are sent to DetectifAI. |
| FR-10 | Submit combined speaker/deepfake checks and preserve both outcomes, errors, vendor operation ID, capture interval, and receive time. |
| FR-11 | Show pending/incomplete states while a response is missing. Only match plus real with both checks successful counts as a passed interval. |
| FR-12 | A no_match or fake result marks the associated answer review_required. An uncertain/missing/error result marks coverage incomplete. |
| FR-13 | Display the actual basis: speaker mismatch, possible synthetic speech, uncertain analysis, or technical failure. Do not invent acoustic explanations. |
| FR-14 | Recheck uses a fresh prompt and fresh audio. Recheck success never deletes earlier events or marks earlier audio as passed. |
| FR-15 | Resolve an answer by linking a repeat answer or recording an interviewer disposition. Keep the original concern and disposition visible. |
| FR-16 | End/withdrawal/disconnect handling stops relevant capture, cancels unsent work, and excludes late results from reopening the session. |
| FR-17 | Summary/export includes analyzed intervals, gaps, question links, review history, and unresolved states. Exclude secrets, audio, invite URLs, and voice embeddings. |

## 3. State model
### Session
`created → awaiting_consent → enrolling → ready → interviewing ↔ paused → ended`

Enrollment failures stay in enrolling with a recoverable error. Candidate disconnect pauses capture. Reconnection requires the same bound identity and an explicit visible resumption; a changed identity requires a new authorized flow. Consent withdrawal leads to paused/consent_withdrawn and no further voice processing. An ended session cannot accept new analysis.

### Audio interval
`capturing → queued → analyzing → complete | incomplete | cancelled`

A complete response is not necessarily a passed check. Store dimensions separately:
- Speaker: `match | no_match | unavailable`.
- Deepfake: `real | fake | not_sure | unavailable`.
- Derived outcome: `passed | concern | incomplete`.

Precedence: any available no_match/fake creates concern, even if the other check fails; also retain the partial-failure indicator. Otherwise, missing checks/not_sure/errors produce incomplete. Only match+real produces passed. Unknown enum values fail to incomplete.

### Answer
`not_started → active → recorded`

Review is a separate field: `none | incomplete | review_required | reviewed_repeat | reviewed_continue_unresolved`. Concern takes precedence over incomplete. A later passing interval cannot clear an earlier concern. “Reviewed” is a human workflow disposition, not a rewritten detector verdict.

## 4. Question boundaries and rechecks
Question changes close the active window. If that remainder cannot meet both APIs' minimum duration, record a gap rather than send it as a valid combined sample. The next question starts a new window. Rechecks have their own ID and reference the concerned answer. No automatic speech recognition or phrase-content validation is in MVP scope; the interviewer observes whether the prompt was spoken.

## 5. Errors and retries
| Condition | Required behavior |
|---|---|
| Permission denied | Explain browser permission recovery; no fake ready state |
| Enrollment rejected | Display safe vendor reason and allow recapture |
| Insufficient speech | Ask for a longer/clearer sample; retain incomplete interval |
| 401/403 | Stop automatic retries; show service configuration problem |
| 402 | Pause analysis; show credit exhaustion without blaming candidate |
| 429/503 | Respect Retry-After and apply bounded retry/backpressure |
| Timeout/connection loss | Mark delayed/incomplete; retry same bytes with same idempotency key |
| Partial combined result | Preserve successful dimension and mark other unavailable |
| Duplicate/late response | Deduplicate by interval ID; attach to original question only |

Retry policy and bounds are implementation defaults in TECHNICAL_DESIGN.md. The UI must show gaps produced by queue limits or muted audio.

## 6. Session summary
Required fields: pseudonymous session ID, start/end time, question text and IDs, interval boundaries, both result dimensions, outcome, review actions, coverage gaps, and unresolved concerns. Duration coverage must use the union of analyzed intervals, not summation if overlaps are later introduced. No global candidate trust score.

## 7. Functional exit gate
FR-01 through FR-16 require end-to-end acceptance; FR-17 requires a working summary and, if export is shipped, correct export content. No feature described here is presumed implemented. See TEST_PLAN.md for verification cases and evidence requirements.
