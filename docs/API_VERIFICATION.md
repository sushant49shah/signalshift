# API verification — 16 October 2026

All seven original project documents were read before implementation. This milestone narrows the roadmap to a manually triggered end-to-end sample, as requested. No real authenticated DetectifAI response or live LiveKit call has been obtained yet.

## DetectifAI

Fetched directly from the official HTTPS host:

- https://platform.detectif.ai/docs/api/
- https://platform.detectif.ai/openapi.json — snapshot saved as `docs/detectif-openapi.json`, API version 1.0.0.

The web-search reader could not access this host; the schema was successfully retrieved with curl. Implementation uses this downloaded schema rather than guessed enrollment fields.

Verified request contracts:

| Operation | Request | Successful response used |
| --- | --- | --- |
| `POST /v1/speakers/enroll` | Bearer authentication; multipart `file`, `speaker_id`; optional `display_name` omitted | `object: speaker.enrollment`, `speaker.speaker_id`, `speaker.samples`, `quality.speech_seconds`, `quality.duration_seconds` |
| `POST /v1/speakers/verify` | Bearer authentication; multipart `file`, `speaker_id`, `detect_deepfake=true` | `result.decision`; `deepfake.verdict`; both operation IDs |
| `DELETE /v1/speakers/{speaker_id}` | Bearer authentication; scope `speakers:delete` | `deleted: true` and matching `speaker_id` |

Uploads send `Idempotency-Key`. The browser cannot supply a speaker ID. The adapter uses a fixed provider origin and refuses redirects; arbitrary provider URLs are not accepted.

Combined partial-result locations:

- Successful verification with failed deepfake check: `result.decision` plus `deepfake.error`.
- Failed verification with completed deepfake check: non-2xx `error` plus `partial.deepfake.verdict`.
- Unknown/missing enums remain unavailable. `not_sure` remains uncertain. Only `match` + `real` passes; `no_match` or `fake` remains a concern even if the other dimension fails.

The schema has inconsistent generic examples: the enrollment schema example contains a 9.2-second duration, while the endpoint contract requires 15–60 seconds with at least 10 seconds of speech. The application records 25 seconds and validates the endpoint requirements rather than copying that example. The top-level description lists a 0.5-second deepfake minimum, while combined verification still explicitly calls for more than four seconds. The application uses eight-second combined samples, satisfying the stricter contract. The earlier planning documents' language-specific assumptions are not used to determine verdicts.

## LiveKit

Reviewed current official documentation:

- https://docs.livekit.io/transport/media/subscribe/
- https://docs.livekit.io/frontends/reference/tokens-grants/

Track subscription exposes the participant identity, publication source, and raw media track. The client chooses only the remote `candidate` participant's microphone track, then builds a one-track `MediaStream`. The installed SDK types validate room grants, camera/microphone publish sources, five-minute token TTL, and two-participant room configuration.

Token expiry applies to joining, not automatic termination of existing calls. End/withdraw attempts room deletion and the browser disconnects on ended session status. The backend denies new processing after revocation.

## Framework

Pinned package versions are in `package.json` and `package-lock.json`. Tailwind's current Next.js integration uses `@tailwindcss/postcss` and `@import "tailwindcss"`: https://tailwindcss.com/docs/installation/framework-guides/nextjs . Next.js production build and TypeScript checks are the local integration evidence. No hosted deployment is claimed.
