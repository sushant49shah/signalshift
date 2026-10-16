# SignalShift AI — Product Requirements Document

Version: 1.0 · Date: 16 October 2026 · Status: proposed implementation baseline

## 1. Product summary
SignalShift AI is a web application for live video interviews that checks voice continuity and possible synthetic speech during the conversation. It connects suspicious audio intervals to the question being answered, asks for a fresh sample, and helps the interviewer resolve the affected answer. It does not make hiring decisions.

**Product promise:** “Verify who is speaking—not just who joined.” In product copy, clarify that verification means comparison with an enrolled voice, not proof of legal identity.

## 2. Problem and target user
The primary user is a remote interviewer who needs to know whether later answers remain consistent with the speaker enrolled at the start. A one-time voice reference cannot describe subsequent audio. A generic risk score also gives little guidance about which answer to revisit.

The candidate is a secondary user who needs a clear explanation, explicit consent, predictable prompts, and a way to recover from poor audio or an inconclusive result without being accused of misconduct.

This is a product hypothesis, not a claim of validated market demand. No customer interviews, accuracy study, or competitor exclusivity study has been performed. The differentiator is the question-linked review and recovery workflow; uniqueness against the other teams is not established.

## 3. Hackathon alignment
The registered use case includes online interviews, ongoing call monitoring, timestamps, and additional speaker verification. This proposal narrows that use case to remote interviews. It includes video communication but analyzes audio only. Any broader change of original user/problem requires checking with organisers under rule 3.7.

The supplied rubric screenshot allocates the displayed 60 Day 1 marks to DetectifAI (20), problem/user (10), progress (10), Day 2 plan (10), and team/clarity (10). DetectifAI results must therefore change the interview workflow. A clickable mockup without live detection is insufficient.

Submission: accessible prototype link and exactly five slides in order: Problem, Solution, DetectifAI, Impact, Scale. Both days contribute to final ranking; only the top 25% progress. Do not present prerecorded/cached results as live.

## 4. Goals
- Provide an end-to-end, two-person video interview demonstrable on desktop Chrome.
- Enroll a consented voice reference and analyze the candidate audio received by the interviewer.
- Keep speaker matching, synthetic-speech classification, and analysis availability distinct.
- Associate each analyzed interval with its question and recording times.
- Turn a concerning result into an answer review requirement and a recheck action.
- Preserve earlier concerns after a successful recheck until the interviewer explicitly handles them.

## 5. Non-goals
Video deepfake or lip-sync detection; Zoom/Teams integration; legal identity verification; reliable detection of all impersonation; automatic hiring decisions; emotion/personality analysis; transcription; an LLM agent; native mobile apps; production compliance certification; persistent recording archives.

## 6. MVP scope and priorities
| Priority | Requirement | Rationale |
|---|---|---|
| P0 | Consent, enrollment, real API calls | Foundation of the claim |
| P0 | Two-party LiveKit video room | Matches the agreed product experience |
| P0 | Candidate-only audio analysis | Avoids matching the interviewer to the candidate |
| P0 | Both result dimensions and incomplete state | Avoids false assurance |
| P0 | Question timeline and review flag | Core differentiation |
| P0 | Spoken recheck and explicit resolution | Complete recovery story |
| P0 | HTTPS deployment and demo entry without account login | Submission access |
| P1 | Session summary and sanitized JSON export | Judge-visible evidence |
| P1 | Reconnect/refresh warnings and session metadata recovery | Demo resilience |
| P2 | Persistent authenticated history, advanced reporting | Post-MVP |

## 7. Main journey
1. Interviewer creates a room and configures a short question list.
2. Candidate opens a role-scoped invitation, reads the consent notice, and enables media.
3. Candidate provides approximately 20–30 seconds of speech; actual successful enrollment is required.
4. Interviewer starts a question and monitoring.
5. Candidate audio is analyzed in approximately eight-second windows, subject to actual API latency and quota.
6. The interviewer sees passed checks, concerns, or incomplete analysis for each window.
7. A concern marks the answer for review. A fresh spoken prompt collects a recheck sample.
8. Interviewer repeats the affected answer, records a review disposition, or continues with an unresolved flag.
9. Ending the session stops capture and produces a coverage-aware summary.

## 8. Success measures
MVP completion requires all P0 acceptance tests in TEST_PLAN.md, an actual two-browser call, and real enrollment plus combined verification. Measure observed end-to-end analysis delay, analyzed duration versus captured duration, and error/retry counts. Report measured values; no accuracy or latency guarantee is assumed.

A successful demo shows a genuine baseline, an organiser-permitted test input processed live, an actual returned concern if produced, and the recovery path. If no concern is returned, disclose the outcome rather than fabricate one. Scenario fixtures may demonstrate UI behavior only when prominently labeled simulated.

## 9. Constraints and assumptions
Five-hour implementation target; team prefers web development. LiveKit Cloud and Vercel accounts, a working DetectifAI key, sufficient credits, internet, camera/microphone devices, and suitable deployment limits are dependencies. No credentials or authenticated test outcomes are established by this documentation.

Enrollment establishes continuity with the enrolled sample, not legal identity. Detection is tuned for English; call-quality audio may reduce reliability. Results are signals requiring human review. Processing is segmented upload-and-response, not verified continuous streaming.

## 10. Risks and scope decisions
The first 45 minutes validate actual API responses and remote audio extraction. If either fails, investigate immediately and reduce cosmetic scope. An audio-only diagnostic is a fallback for integration work, not an equivalent delivery of the agreed video MVP. Maintain a visible list of unmet requirements.

Credit exhaustion, poor audio, network loss, partial responses, and missing consent must never look like a successful check. Time pressure should remove optional features rather than invent successful results.

## 11. Source baseline
- User-provided UNCLONE PDF and evaluation image, reviewed in this conversation.
- https://platform.detectif.ai/docs/api/
- https://platform.detectif.ai/docs/audio-and-limits/
- https://platform.detectif.ai/docs/api/detect-deepfake/
- https://platform.detectif.ai/docs/api/verify-speaker/
- https://docs.livekit.io/transport/media/subscribe/

Documentation was reviewed during planning on 16 October 2026. This PRD is a design, not evidence that the application has been built or tested.
