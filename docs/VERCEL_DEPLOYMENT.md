# Deploy and test on two laptops

Production site: https://signalshift-eight.vercel.app

## Vercel environment variables

In the Vercel project's **Settings → Environment Variables**, add these to **Production**. None use `NEXT_PUBLIC_`. `.env.local` stays on your laptop and is not uploaded from GitHub.

| Name | Value |
| --- | --- |
| `APP_ORIGIN` | `https://signalshift-eight.vercel.app` (no trailing slash) |
| `DETECTIF_API_KEY` | DetectifAI key with `speakers:enroll`, `speakers:verify`, `speakers:delete`, `deepfake:detect` scopes |
| `LIVEKIT_URL` | Your project's `wss://…livekit.cloud` URL |
| `LIVEKIT_API_KEY` | API key from that same LiveKit project |
| `LIVEKIT_API_SECRET` | Matching LiveKit API secret |
| `TURSO_DATABASE_URL` | URL for your hosted **libSQL** database, normally `libsql://…turso.io` |
| `TURSO_AUTH_TOKEN` | Database auth token with read/write/schema permissions |
| `DEMO_ACCESS_CODE` | A private code of your choice for interview creation and coordinator audio submissions |

Use a Turso libSQL database compatible with `@libsql/client` (this is not the newer Turso-native serverless API). Tables are created automatically on the first request. No SQL setup script is needed. Do not set `DATABASE_PATH` on Vercel; it is only a local-development fallback. The app refuses local storage on Vercel rather than silently losing sessions across instances.

Use Node **22.x**, Next.js framework preset, repository root directory, default installation command, and `npm run build`. The API routes request a 120-second execution budget; ensure the project's function settings support it. App uploads are capped at 3.6 MB including multipart data, below Vercel's documented 4.5 MB request limit. Original Test audio files are decoded/resampled in the browser before upload.

After adding/changing variables, redeploy the latest commit. Environment changes do not update an already-built deployment. For preview deployments, configure the exact preview HTTPS origin separately and use an isolated database; do not reuse the production origin with preview links.

If your friend sees a Vercel login page, the deployment's protection/access settings are preventing access. Grant them deployment access or choose the intended public production configuration yourself. The application does not change Vercel account security settings.

## Call between laptops

1. On your laptop, open **https://signalshift-eight.vercel.app**, enter the demo code, and create a new interview. Do not create this room at `localhost`.
2. Copy the candidate link. Send it privately to your friend. It must begin with `https://signalshift-eight.vercel.app/` and retain the complete `#…` invitation fragment. The friend does not need LiveKit keys or a local server.
3. You select **Join call** as interviewer. Your friend opens the link, explicitly accepts the notice, joins, and grants microphone/camera permissions.
4. Use headphones. Your friend records the 25-second enrollment. Wait for actual DetectifAI acceptance.
5. While your friend speaks, select **Capture & analyze 8 seconds** on your laptop. The app captures only their remote microphone track and sends one complete WAV through the backend.
6. Inspect both real returned dimensions. Uncertain, missing, failed, and pending checks never count as passed. Confirm mute/disconnect cancels capture and end/withdraw stops new processing.
7. End the session and inspect reference cleanup status. Already transmitted audio cannot be recalled.

Never replace `localhost` in an existing invitation by hand: local and deployed databases/cookies are separate. Always create a fresh session on the deployed site. Shared links expire in two hours. Each laptop connects directly to LiveKit for the call; Vercel issues tokens and submits analysis uploads.

## Coordinator Test audio

Open **https://signalshift-eight.vercel.app/test-audio**. The page is public, but submitting a paid check requires the shared demo code and explicit permission/consent for the audio.

Upload a browser-decodable clip longer than 4 seconds and at most 30 seconds (original file under 10 MB), or record 10 seconds. Select **Analyze audio**. The backend calls `/v1/deepfake/detect`; the page displays **Real**, **Fake**, or **Inconclusive**, the actual returned 0–1 model score when present, processing state, operation ID, and measured request duration. This page does not perform speaker comparison because it has no enrolled reference.

No source audio is saved by this application. The backend stores a content digest and normalized result for deduplication; the provider's retention still applies. The public test endpoint permits at most five submissions per minute and thirty per hour globally. Limits are shared in Turso; access codes are never included in invitation URLs.

## Validation status

Local LiveKit room-service authentication and DetectifAI account authentication succeeded on 16 October 2026. These were read-only checks with no audio uploaded. They do not establish enrollment/detection success, model accuracy, browser media compatibility, or deployment correctness.

A real two-laptop call and consented voice enrollment/analysis still require you and your friend. Turso/Vercel configuration must be completed before that live acceptance test. Browser-crash/expired-session reference cleanup and automatic metadata retention purge remain limitations.

Sources: [Turso TypeScript/libSQL reference](https://docs.turso.tech/sdk/ts/reference), [Vercel function limits](https://vercel.com/docs/functions/limitations), [DetectifAI OpenAPI](https://platform.detectif.ai/openapi.json).
