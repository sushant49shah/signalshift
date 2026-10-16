import {
  appOrigin,
  checkOrigin,
  checkAccessCode,
  readBody,
} from "@/lib/server/http";
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  active,
  authenticate,
  claim,
  createSession,
  db,
  getSession,
  hash,
  publicSession,
  rateLimit,
  type Role,
} from "@/lib/server/store";
import {
  AppError,
  deleteSpeaker,
  provider,
  providerMessage,
  required,
} from "@/lib/server/provider";
import { normalizeAnalysis, object } from "@/lib/results";
import { inspectWav } from "@/lib/wav";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const authSchema = z.object({
  id: z.uuid(),
  role: z.enum(["interviewer", "candidate"]),
});
const cookieName = (id: string, role: Role) => `ss_${role}_${id}`;
function response(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function setCookie(res: NextResponse, id: string, role: Role, token: string) {
  res.cookies.set(cookieName(id, role), token, {
    httpOnly: true,
    secure: appOrigin().startsWith("https:"),
    sameSite: "strict",
    path: "/api",
    maxAge: 7200,
  });
}
function mediaService() {
  return new RoomServiceClient(
    required("LIVEKIT_URL").replace(/^ws/, "http"),
    required("LIVEKIT_API_KEY"),
    required("LIVEKIT_API_SECRET"),
  );
}
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ action: string[] }> },
) {
  try {
    checkOrigin(req);
    const action = (await context.params).action.join("/");
    const upload = action === "enroll" || action === "analyze";
    const bytes = await readBody(req, upload ? 3_600_000 : 4096);
    const form = upload
      ? await new Response(bytes, {
          headers: { "Content-Type": req.headers.get("content-type") || "" },
        }).formData()
      : undefined;
    const input = upload
      ? Object.fromEntries(form!.entries())
      : JSON.parse(bytes.toString());
    if (action === "sessions") {
      checkAccessCode(input.accessCode);
      if (!(await rateLimit("create-global", 10, 3600)))
        throw new AppError(
          429,
          "Room creation limit reached. Try again later.",
        );
      const created = await createSession();
      const res = response({
        id: created.id,
        invitation: created.candidate,
        origin: appOrigin(),
      });
      setCookie(res, created.id, "interviewer", created.interviewer);
      return res;
    }
    const { id, role } = authSchema.parse(input);
    if (action === "join") {
      const token = z.string().min(40).max(100).parse(input.invitation);
      const s = await authenticate(id, token, "candidate");
      if (role !== "candidate" || !s || s.ended)
        throw new AppError(403, "Invitation is invalid, expired, or ended.");
      const res = response(publicSession(s));
      setCookie(res, id, role, token);
      return res;
    }
    const token = req.cookies.get(cookieName(id, role))?.value || "";
    const s = await authenticate(id, token, role);
    if (!s)
      throw new AppError(
        403,
        "Session access is invalid or expired. Create a new room.",
      );
    if (action === "status") return response(publicSession(s));
    if (action === "end" || action === "withdraw") {
      if (action === "withdraw" && role !== "candidate")
        throw new AppError(403, "Only the candidate can withdraw consent.");
      // Revoke before awaiting provider calls; no new billable requests can start.
      await db()
        .prepare(
          "UPDATE sessions SET consent=NULL,enrolled=0,ended=1 WHERE id=?",
        )
        .run(id);
      let roomCleanup = "Call room closure not confirmed.";
      try {
        await mediaService().deleteRoom("ss-" + id);
        roomCleanup = "Call room closed.";
      } catch {
        /* no upstream secrets in errors */
      }
      const cleanup = s.speaker
        ? await deleteSpeaker(s.speaker)
        : "No speaker reference was created.";
      await db()
        .prepare("UPDATE sessions SET cleanup=? WHERE id=?")
        .run(cleanup, id);
      return response({ ended: true, cleanup, roomCleanup });
    }
    if (s.ended) throw new AppError(409, "This session has ended.");
    if (action === "consent") {
      if (
        role !== "candidate" ||
        input.accepted !== true ||
        input.notice !== "2026-10-16-v1"
      )
        throw new AppError(403, "Explicit candidate consent is required.");
      await db()
        .prepare(
          "UPDATE sessions SET consent=COALESCE(consent,?),notice=? WHERE id=? AND ended=0",
        )
        .run(Date.now(), input.notice, id);
      return response(publicSession((await getSession(id))!));
    }
    if (action === "rooms/token") {
      if (role === "candidate" && !s.consent)
        throw new AppError(
          403,
          "Consent is required before joining this analysis room.",
        );
      const url = required("LIVEKIT_URL");
      const key = required("LIVEKIT_API_KEY"),
        secret = required("LIVEKIT_API_SECRET");
      if (!(await rateLimit("token-" + id, 20, 60)))
        throw new AppError(429, "Too many room token requests.");
      await mediaService().createRoom({
        name: "ss-" + id,
        maxParticipants: 2,
        emptyTimeout: 300,
      });
      const access = new AccessToken(key, secret, {
        identity: role,
        name: role,
        ttl: "5m",
      });
      access.addGrant({
        roomJoin: true,
        room: "ss-" + id,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
        canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
      });
      return response({ token: await access.toJwt(), url });
    }
    if (!upload) throw new AppError(404, "Unknown endpoint.");
    if (
      (action === "enroll" && role !== "candidate") ||
      (action === "analyze" && role !== "interviewer")
    )
      throw new AppError(403, "This role cannot perform that action.");
    if (!s.consent) throw new AppError(403, "Candidate consent is required.");
    const allowed = new Set([
      "id",
      "role",
      "file",
      "operationId",
      "captureStart",
      "captureEnd",
    ]);
    if (
      [...form!.keys()].some((k) => !allowed.has(k)) ||
      [...allowed].some((k) => form!.getAll(k).length > 1)
    )
      throw new AppError(400, "Unexpected or duplicate upload fields.");
    const operationId = z.uuid().parse(input.operationId);
    const file = form!.get("file");
    if (!(file instanceof File) || file.type !== "audio/wav")
      throw new AppError(415, "A WAV audio file is required.");
    const audio = await file.arrayBuffer();
    const audioInfo = inspectWav(audio, action);
    const captureStart = z.coerce.number().finite().parse(input.captureStart),
      captureEnd = z.coerce.number().finite().parse(input.captureEnd);
    if (
      captureStart < s.consent ||
      captureEnd > Date.now() + 2000 ||
      Date.now() - captureEnd > 120_000 ||
      Math.abs(captureEnd - captureStart - audioInfo.duration * 1000) > 500
    )
      throw new AppError(400, "Invalid capture interval.");
    const digest = hash(new Uint8Array(audio));
    const previous = (await db()
      .prepare("SELECT * FROM operations WHERE id=?")
      .get(operationId)) as
      | { session: string; kind: string; digest: string; result: string | null }
      | undefined;
    if (previous) {
      if (
        previous.session !== id ||
        previous.kind !== action ||
        previous.digest !== digest
      )
        throw new AppError(
          409,
          "Operation ID was already used for different audio.",
        );
      if (previous.result) return response(JSON.parse(previous.result));
      throw new AppError(
        409,
        "This operation is pending or its result is unknown. No check is assumed passed.",
      );
    }
    if (action === "enroll" && s.enrolled)
      throw new AppError(409, "A voice reference is already enrolled.");
    if (action === "analyze" && (!s.enrolled || !s.speaker))
      throw new AppError(409, "A successful voice enrollment is required.");
    required("DETECTIF_API_KEY");
    if (
      !(await rateLimit("upload-" + id, 15, 60)) ||
      !(await rateLimit("upload-global", 100, 3600))
    )
      throw new AppError(
        429,
        "Analysis limit reached. Wait before trying again.",
      );
    if (!(await claim(s)))
      throw new AppError(
        409,
        "Another operation is pending, or consent has changed.",
      );
    const speaker = s.speaker || "ss-" + randomUUID();
    await db()
      .prepare("UPDATE sessions SET speaker=? WHERE id=?")
      .run(speaker, id);
    await db()
      .prepare(
        "INSERT INTO operations (id,session,kind,digest) VALUES (?,?,?,?)",
      )
      .run(operationId, id, action, digest);
    try {
      const payload = new FormData();
      payload.set(
        "file",
        new Blob([audio], { type: "audio/wav" }),
        "sample.wav",
      );
      payload.set("speaker_id", speaker);
      if (action === "analyze") payload.set("detect_deepfake", "true");
      const upstream = await provider(
        "/speakers/" + (action === "enroll" ? "enroll" : "verify"),
        {
          method: "POST",
          body: payload,
          headers: { "Idempotency-Key": operationId },
        },
        () => active(s),
      );
      if (!(await active(s))) {
        if (action === "enroll") {
          const cleanup = await deleteSpeaker(speaker);
          await db()
            .prepare("UPDATE sessions SET cleanup=? WHERE id=?")
            .run(cleanup, id);
        }
        throw new AppError(
          409,
          "Session ended or consent withdrawn; late results were discarded.",
        );
      }
      let output: unknown;
      if (action === "enroll") {
        const b = object(upstream.body),
          sp = object(b.speaker),
          q = object(b.quality);
        if (!upstream.ok)
          throw new AppError(502, providerMessage(upstream.status));
        if (
          b.object !== "speaker.enrollment" ||
          sp.speaker_id !== speaker ||
          typeof sp.samples !== "number" ||
          sp.samples < 1 ||
          typeof q.speech_seconds !== "number" ||
          q.speech_seconds < 10 ||
          typeof q.duration_seconds !== "number" ||
          q.duration_seconds < 15 ||
          q.duration_seconds > 60
        )
          throw new AppError(
            502,
            "Enrollment response could not be validated. Reference is not ready.",
          );
        const enrolled = await db()
          .prepare(
            "UPDATE sessions SET enrolled=1 WHERE id=? AND ended=0 AND consent=?",
          )
          .run(id, s.consent);
        if (enrolled.changes !== 1)
          throw new AppError(
            409,
            "Session ended before enrollment could be saved.",
          );
        output = { enrolled: true };
      } else {
        const body = object(upstream.body);
        if (upstream.ok && body.speaker_id !== speaker)
          throw new AppError(
            502,
            "Provider returned an unexpected speaker binding.",
          );
        output = {
          ...normalizeAnalysis(upstream.body, upstream.ok),
          id: operationId,
          captureStart,
          captureEnd,
          receivedAt: Date.now(),
          providerStatus: upstream.status,
        };
      }
      await db()
        .prepare("UPDATE operations SET result=? WHERE id=?")
        .run(JSON.stringify(output), operationId);
      return response(output);
    } finally {
      await db()
        .prepare("UPDATE sessions SET busy=0 WHERE id=? AND busy=?")
        .run(id, s.busy);
    }
  } catch (error) {
    if (error instanceof AppError)
      return response({ error: error.message }, error.status);
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    )
      return response(
        {
          error:
            "Invalid request or unavailable service. Check your inputs and server configuration.",
        },
        400,
      );
    // Do not serialize arbitrary exceptions (SDK errors can contain request details).
    if (
      error instanceof Error &&
      /WAV|Audio is silent|Record 20|Analysis requires|Upload must|Expected mono/.test(
        error.message,
      )
    )
      return response({ error: error.message }, 422);
    return response(
      { error: "The operation failed. No check is assumed passed." },
      500,
    );
  }
}
