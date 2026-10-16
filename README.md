# SignalShift AI — first milestone

Next.js App Router + TypeScript + Tailwind, a two-person LiveKit room, explicit consent, 25-second DetectifAI enrollment, and a manual eight-second check of the candidate's subscribed remote microphone track. This is implemented code, **not yet a verified live-provider demonstration**.

## Deploy to Vercel and use two laptops

Follow [Vercel deployment instructions](docs/VERCEL_DEPLOYMENT.md) for the exact eight environment variables and remote call sequence. Shared Turso/libSQL storage now supports Vercel; local SQLite remains the development fallback. The public `/test-audio` page supports uploads or microphone recording and actual deepfake verdicts/scores. Paid submissions require consent and the demo access code.

## Run locally

Requires Node 22.13+ with `node:sqlite` (tested with Node 22.23.2).

```sh
npm ci
cp .env.example .env.local # only if .env.local does not already exist
# Fill .env.local using your editor; never paste keys into chat or commit them.
npm run dev
```

Open http://localhost:3000. `.env.local` has already been created for this checkout and is ignored by Git. Configure:

- `DETECTIF_API_KEY`: scopes for speaker enrollment, speaker verification, deepfake detection, and speaker deletion (`speakers:enroll`, `speakers:verify`, `deepfake:detect`, `speakers:delete`).
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: one LiveKit project.
- `APP_ORIGIN`: exact browser origin, without a trailing slash. Default `http://localhost:3000`.
- `DEMO_ACCESS_CODE`: required to create sessions on a non-local origin. Share privately with the interviewer.
- `DATABASE_PATH`: persistent SQLite file, default `.data/signalshift.sqlite`.

The npm scripts use Next.js's Webpack option because Turbopack's CSS worker could not bind a local port in this execution environment. No external font or image download is required.

## Exercise the end-to-end flow

1. Create an interview. Copy the private candidate link into a separate browser/device. Invitations expire in two hours. The fragment is exchanged for a role-specific HttpOnly cookie and removed from the address bar.
2. Join as interviewer. The candidate reads the notice and explicitly agrees before joining. Microphone permissions are separate. Camera denial leaves a visible camera-off state.
3. Candidate selects **Record 25-second voice reference** and speaks naturally. Only a validated real enrollment response enables analysis.
4. Interviewer selects **Capture & analyze 8 seconds** while the candidate speaks. The Web Audio source contains only the remote participant with identity `candidate`, source `microphone`. LiveKit handles normal audio playback separately.
5. View both returned dimensions. Pending, uncertainty, partial error, total failure, and cancellation never count as passed. This is sampled, manual analysis; no continuous coverage is claimed.
6. End the session or withdraw consent. The backend revokes processing before contacting providers, closes the room, and attempts reference deletion. Cleanup success is shown only when confirmed. Retry cleanup if needed.

Use headphones and organizer-authorized, consented speech. Two physical devices need an HTTPS origin on the Vercel deployment (or an explicitly configured HTTPS development tunnel); a plain LAN HTTP URL is not sufficient for browser microphone access. Restart the server after changing configuration.

## API contract and implementation

See [API verification notes](docs/API_VERIFICATION.md) and the downloaded [OpenAPI snapshot](docs/detectif-openapi.json). Credentials remain on the server; there is no simulation path in the application.

- `POST /api/sessions`: create room authority; bounded room creation and optional local/required remote access code.
- `POST /api/join`: exchange candidate invitation for a cookie.
- `POST /api/status`: authorized session state.
- `POST /api/consent`: explicit versioned candidate notice acceptance.
- `POST /api/rooms/token`: five-minute LiveKit join tokens; fixed role identities, one room, camera/microphone only, maximum two participants.
- `POST /api/enroll`: candidate-only complete WAV; server-generated speaker ID.
- `POST /api/analyze`: interviewer-only complete WAV; server-bound speaker, combined verification.
- `POST /api/withdraw` / `POST /api/end`: revoke, stop session, attempt room/reference cleanup.

Uploads are bounded to 3.6 MB including multipart overhead and 3.5 MB per WAV. The app accepts its own canonical mono PCM16 WAV format only, validates headers and duration, rejects obvious silence, and leaves speech adequacy to DetectifAI. Audio is never written to the application database or disk. One server operation per session is allowed; no capture queue is implemented for this manual milestone. Explicit transient HTTP failures have at most two retries using identical bytes and idempotency key. Long `Retry-After` values stop automatic retry. Transport timeouts are shown as unknown/unavailable, without automatic recapture or claims about charging.

SQLite stores hashed role capabilities, notice version/time, session/speaker binding, operation digests, and normalized results. No raw provider response or audio is stored. Do not distribute the `.data` directory. Only the server route imports server modules; client build contains no provider-key configuration.

## Validation

```sh
npm test
npm run typecheck
npm run build
# With local server running (creates and revokes one isolated test session):
node tests/http-smoke.mjs
```

See [milestone evidence and blockers](docs/MILESTONE_STATUS.md). Unit tests use explicitly labeled fixtures and mock transport; they establish application behavior, not detector accuracy.

## Current limits

- **Shared storage required on Vercel:** configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Without them, hosted session creation fails explicitly. Local SQLite is supported only outside Vercel. Existing local sessions are not migrated; create fresh sessions on the deployment.
- No automatic cleanup after a browser crash or expired invitation. Use the provider dashboard to remove orphaned `ss-` speaker references. End/withdraw attempts deletion; previously transmitted voice cannot be recalled.
- Server-side revocation is immediate for new work; the other browser notices within the one-second status poll. In-flight provider processing cannot be reliably recalled. LiveKit token revocation behavior depends on deployment; stale tokens expire after five minutes, and cooperative clients disconnect on ended status.
- SQLite metadata has no automatic retention purge yet. Results visible in the UI are held in memory and are not restored on refresh.
- Fixed global and per-session limits are appropriate for a restricted single-host demo, not public production abuse protection. Put the app behind deployment access controls for a public-network test.
- No legal identity or liveness claim. Enrollment continuity and synthetic-speech results are separate signals requiring human review.
- Polished dashboard, continuous windows, question timeline, rechecks, summary/export, are deferred to later milestones. Deployment setup is covered in the Vercel guide.
