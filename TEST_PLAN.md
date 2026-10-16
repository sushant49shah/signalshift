# SignalShift AI — Test Plan and Acceptance Criteria

Version: 1.0 · Date: 16 October 2026 · Execution status: not run

## 1. Objectives
Verify the real two-person video flow, DetectifAI integration, result-driven review workflow, and truthful handling of uncertainty. Testing must establish observable behavior, not merely mirror implementation. No accuracy benchmark or passing test outcome is claimed by this document.

## 2. Environments and data
Use the deployed HTTPS app and desktop Chrome on two devices, preferably separate networks for one connectivity test. Use headphones, a functioning camera/microphone, valid provider accounts, and sufficient credits. Test local development separately; localhost success does not establish deployment success.

Use only organiser-permitted voice material with explicit authorization. Prefer organiser-provided synthetic/test audio where permitted. Do not use public-figure voices or unconsented recordings. The rulebook also restricts staff/other participant clips; clarify ambiguous team-member use before recording. Label prerecorded inputs and simulated API fixtures clearly. Never represent a hard-coded result as live detection.

## 3. Test layers
- Unit: outcome normalization, partial results, question association, deduplication, review transitions, coverage calculation.
- Integration: WAV validity, server validation, DetectifAI adapter, capability authorization, token issuance.
- End-to-end: room join, consent, enrollment, live remote capture, actual analysis, recheck, summary.
- Manual: media permissions, call quality, accessibility, two-device behavior, judge-facing demo.

Use deterministic fixtures for failure branches and real provider calls for integration evidence. Fixtures validate application logic, not model efficacy.

## 4. Acceptance cases
| ID / Priority | Action | Expected result | Trace |
|---|---|---|---|
| T01 P0 | Open deployed demo without account login | Create/join flow available; privileged endpoints still require session authority | FR-01/02 |
| T02 P0 | Join with interviewer and candidate on two devices | Bidirectional audio/video; correct identities and room | FR-05 |
| T03 P0 | Try expired invite or wrong role | Join/API action denied with recoverable message | FR-02 |
| T04 P0 | Decline consent | No enrollment/analysis upload occurs | FR-03/04 |
| T05 P0 | Deny microphone permission | Explanation shown; session not marked monitoring-ready | FR-05 |
| T06 P0 | Enroll permitted 20–30s reference with real API | Actual success and bound speaker ID; no fabricated readiness | FR-06/07 |
| T07 P0 | Submit short/silent reference | Clear rejection/recapture; monitoring remains blocked | FR-06 |
| T08 P0 | Candidate speaks while interviewer also speaks | Only candidate track is encoded and submitted; inspect track identity | FR-09 |
| T09 P0 | Analyze complete WAV with real combined request | Both response dimensions parsed, timestamps and operation ID retained | FR-10 |
| T10 P0 | Fixture: match + real | Interval passed; no claim about entire candidate/session | FR-11 |
| T11 P0 | Fixture: no_match + real | Original answer marked review_required | FR-12 |
| T12 P0 | Fixture: match + fake | Review_required despite speaker match | FR-12 |
| T13 P0 | Fixture: match + not_sure | Incomplete; request cleaner sample; no accusation | FR-11/13 |
| T14 P0 | Fixture: one successful check, other error | Successful result preserved; missing check visible; concern still takes precedence if present | FR-10/11 |
| T15 P0 | Fixture: unknown enum or malformed response | Incomplete/error; never passed | FR-11 |
| T16 P0 | Start next question before previous response returns | Late result attaches to old question, not current one | FR-08/10 |
| T17 P0 | Duplicate response/retry | One interval record and correct idempotency reuse | FR-10 |
| T18 P0 | Pass recheck after a concerned answer | Earlier concern remains until explicit review disposition | FR-14/15 |
| T19 P0 | Repeat answer or continue unresolved | Explicit linked disposition; original result unchanged | FR-15 |
| T20 P0 | Withdraw consent/end during upload | Stop new capture and queued submissions; late results cannot reopen session | FR-16 |
| T21 P0 | Change submitted speaker/session ID | Server rejects invalid binding | FR-07 |
| T22 P0 | Exhaust credits / invalid key fixture | Pause processing; no infinite retry or passed status | FR-11 |
| T23 P0 | API 429/503 fixture | Respect Retry-After, bounded retries, same idempotency key/bytes | FR-10 |
| T24 P0 | Slow API while windows continue | Queue remains bounded; discarded windows shown as gaps | FR-11 |
| T25 P0 | Disconnect or mute candidate | Capture pauses/gap recorded; stale green status not presented as current | FR-09/16 |
| T26 P1 | Refresh interviewer browser | Metadata may restore; capture does not silently restart | FR-17 |
| T27 P1 | Export summary | Valid JSON; correct question/results/gaps; no secrets, audio, invite URLs | FR-17 |
| T28 P0 | Inspect network/build/logs | Provider keys absent client-side; safe error/log payloads | Security |
| T29 P0 | Oversized/cross-session/unauthorized upload | Server rejects before billable provider request | Security |
| T30 P0 | Enrollment cleanup fails | Failure visible; no false deletion claim | FR-16 |
| T31 P1 | Keyboard-only navigation, narrow viewport | Usable focus order, labels, no hidden core actions | UI spec |

## 5. Real integration demo
1. Start two devices on the deployed app and record actual call status.
2. Enroll permitted speech and log only safe request/operation metadata.
3. Speak an answer and observe real classification, including uncertainty if returned.
4. Process an organiser-permitted contrasting input live. Record actual result without expecting deterministic model behavior.
5. If a concern occurs, show question review and recheck. If it does not, disclose that result; use a separately labeled fixture only to demonstrate the UI branch.
6. End, verify capture cessation, and inspect cleanup outcome/summary.

Do not conflate “application correctly handles a fake verdict” with “model detects this attack.” The first is a deterministic acceptance test; the second is an empirical observation.

## 6. Performance and coverage measurements
Measure at least five real windows if credits/time permit: capture duration, upload-to-response delay, total alert age, retry count, dropped duration, and observed outcomes. No unsupported p95 claim from a tiny sample. Check that capture remains stable, UI responds, and queue never exceeds its configured bound. Report observed median/range with sample count.

Verify coverage uses interval unions and separates unanalyzed time. Do not report “100% monitored” if gaps, failed checks, or paused periods exist. A pending request is not completed coverage.

## 7. Release gates
**Go for live demo:** real enrollment and combined request pass integration; two-person video works; consent and role checks work; no exposed keys; concern/incomplete/recheck branches pass; deployment accessible; no undisclosed mocked results.

**No-go or explicit reduced-scope disclosure:** model integration missing, mixed audio, results hard-coded, remote capture unavailable, withdrawal ignored, credential leak, or unsafe public access. Fix P0 issues before polish. If time prevents a fix, document the limitation and do not claim the affected feature works.

## 8. Evidence record
For each executed case record: test ID, date/time, build/deployment identifier, browser/device, input source authorization, real API versus fixture, expected/actual outcome, pass/fail, and issue reference. Store no raw sensitive data in screenshots/logs. The current status of every case is **not executed**.
