# Foundation milestone evidence — 16 October 2026

## Implemented

- Next.js App Router, TypeScript, Tailwind CSS, pinned dependencies, Node server routes.
- `.env.example`; ignored `.env.local`, build output, SQLite state, dependencies, logs.
- Two fixed LiveKit role identities, room-scoped short-lived tokens, camera/microphone publishing, two-participant limit, local/remote video, remote audio playback, media controls.
- Versioned explicit candidate consent and 25-second reference capture; server-generated speaker binding and real DetectifAI enrollment adapter.
- Manual eight-second capture of the candidate's remote microphone at the interviewer, independent mono PCM16 WAV encoding, bounded server upload validation, real combined verification adapter.
- Separate speaker/deepfake dimensions, pending states, uncertainty, partial failures, request errors, and preserved previous results. No simulated production responses.
- HttpOnly role cookies, same-origin checks, persistent rate limits, operation deduplication, one in-flight server operation, server-enforced consent revocation, cleanup reporting.

## Executed checks

Environment: local macOS, Node 22.23.2. No browser/device or deployment validation is implied by terminal tests.

| Check | Result | Evidence / limits |
| --- | --- | --- |
| All seven baseline documents read | Complete | PRD, FRD, technical design, security/privacy, roadmap, test plan, UI/UX |
| Current DetectifAI schema | Verified from official OpenAPI | Snapshot and contract notes in `docs/`; no authenticated live response yet |
| LiveKit track/token contracts | Verified against official docs and installed SDK types | No connected room yet |
| `npm run typecheck` | Passed | Strict TypeScript |
| `npm test` | 17 passed, 0 failed | Deterministic result fixtures, WAV validity/rejection, role/cross-session isolation, expiration, revocation/in-flight lock, rate limit, mocked HTTP retries/partials, simulated PCM worklet assembly |
| `npm run build` | Passed with Webpack | Static page and dynamic API route generated; default scripts now use Webpack |
| `node tests/http-smoke.mjs` | Passed | Actual local HTTP server: root page, origin rejection, cookie session creation, role restrictions, invite exchange, declined/affirmative fixture consent, revoked session, forbidden speaker substitution, malformed WAV rejection |
| Client bundle scan | Passed | No `DETECTIF_API_KEY` or `LIVEKIT_API_SECRET` identifiers in `.next/static`; credentials were not configured, so no live-key canary test |
| Browser UI inspection | Blocked | No browser automation surface; fallback native Chrome attachment timed out |
| Live enrollment + combined check | Not executed | Provider credentials empty at last check; no authorized spoken reference captured |
| Two-device video / remote-audio isolation | Not executed | Requires configured LiveKit and two browser/device participants |
| Real cleanup / quotas / latency | Not executed | Requires authenticated provider calls |

The HTTP consent test creates an isolated test session only. It sends no human voice and calls neither LiveKit nor DetectifAI, then directly revokes its own fixture session in the local database. Test results are not detector accuracy evidence. All unlisted full-MVP acceptance cases remain not executed or deferred, not passed.

## Remaining blockers for milestone acceptance

1. Fill DetectifAI and LiveKit settings in `.env.local`. Never share credentials in chat. Ensure all required scopes and credits are available.
2. Run the README's two-browser/device sequence with authorized, consented speech. Confirm actual enrollment, remote-only audio, both actual result dimensions, cancellation, mute/disconnect handling, and provider cleanup. Pending/uncertain/error branches have deterministic tests but still need visual confirmation.
3. Use HTTPS for separate-device microphone access. No deployment has been made. This SQLite-backed version needs a persistent Node host/volume; it is not safe to deploy unchanged to ephemeral serverless hosting.

## Scope intentionally deferred

Polished dashboard, question-linked timeline, automatic continuous capture/queueing, recheck/disposition workflow, refresh recovery of result history, summary/export, and public deployment. Audio checks are manual samples with visible gaps between them.

## Material limitations

- A browser crash or expired session does not automatically delete an enrolled vendor reference. End/withdraw attempts cleanup and reports uncertainty; manual provider cleanup may be necessary.
- Already transmitted audio cannot be recalled. Remote UI cancellation follows a one-second session poll; the backend blocks new submissions immediately after withdrawal.
- Metadata retention purge and production authentication/abuse protection are not implemented. Access-code protection and single-host SQLite limits are demo controls.
- Node's built-in SQLite still emits an experimental warning under the tested Node version.
- The initial Turbopack build failed due to sandbox local-port restrictions even after escalation; the standard Webpack build passed. This does not affect the provider contract, but explains the chosen build scripts.
