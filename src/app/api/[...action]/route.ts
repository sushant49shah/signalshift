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
  ensureInterviewWorkspace,
  getSession,
  hash,
  interviewQuestions,
  interviewState,
  interviewTimeline,
  publicSession,
  rateLimit,
  reviewHistory,
  verificationHistory,
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
    if (action === "workspace") {
      await ensureInterviewWorkspace(id);
      const [questions, state, timeline, history, reviews] = await Promise.all([
        interviewQuestions(id),
        interviewState(id),
        interviewTimeline(id),
        role === "interviewer" ? verificationHistory(id) : Promise.resolve([]),
        role === "interviewer" ? reviewHistory(id) : Promise.resolve([]),
      ]);
      return response({
        session: {
          ...publicSession(s),
          started: timeline.started,
          endedAt: timeline.ended,
        },
        questions,
        state,
        history,
        reviews,
      });
    }
    if (action === "history") {
      if (role !== "interviewer")
        throw new AppError(
          403,
          "Only the interviewer can view verification history.",
        );
      return response(await verificationHistory(id));
    }
    if (action === "end" || action === "withdraw") {
      if (action === "withdraw" && role !== "candidate")
        throw new AppError(403, "Only the candidate can withdraw consent.");
      // Revoke before awaiting provider calls; no new billable requests can start.
      await db()
        .prepare(
          "UPDATE sessions SET consent=NULL,enrolled=0,ended=1 WHERE id=?",
        )
        .run(id);
      await db()
        .prepare(
          "UPDATE interview_timeline SET ended=COALESCE(ended,?) WHERE session=?",
        )
        .run(Date.now(), id);
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
    if (action === "question/add") {
      if (role !== "interviewer")
        throw new AppError(403, "Only the interviewer can manage questions.");
      const text = z.string().trim().min(1).max(1000).parse(input.text);
      const count = (await db()
        .prepare("SELECT COUNT(*) AS count FROM questions WHERE session=?")
        .get(id)) as { count: number };
      if (count.count >= 25)
        throw new AppError(409, "This interview already has 25 questions.");
      const questionId = randomUUID();
      await db()
        .prepare(
          "INSERT INTO questions (id,session,position,text,created) VALUES (?,?,?,?,?)",
        )
        .run(questionId, id, count.count + 1, text, Date.now());
      return response({ id: questionId, position: count.count + 1, text });
    }
    if (action === "question/edit" || action === "question/select") {
      if (role !== "interviewer")
        throw new AppError(403, "Only the interviewer can manage questions.");
      const questionId = z.uuid().parse(input.questionId);
      const found = await db()
        .prepare("SELECT id FROM questions WHERE id=? AND session=?")
        .get(questionId, id);
      if (!found) throw new AppError(404, "Interview question not found.");
      if (action === "question/edit") {
        const text = z.string().trim().min(1).max(1000).parse(input.text);
        await db()
          .prepare("UPDATE questions SET text=? WHERE id=? AND session=?")
          .run(text, questionId, id);
      } else {
        await db()
          .prepare(
            "UPDATE interview_state SET current_question=? WHERE session=?",
          )
          .run(questionId, id);
      }
      return response({ saved: true });
    }
    if (action === "capture/status") {
      if (role !== "interviewer")
        throw new AppError(
          403,
          "Only the interviewer controls answer capture.",
        );
      const status = z
        .enum(["waiting", "recording", "processing", "completed", "failed"])
        .parse(input.status);
      const questionId = z.uuid().parse(input.questionId);
      const found = await db()
        .prepare("SELECT id FROM questions WHERE id=? AND session=?")
        .get(questionId, id);
      if (!found) throw new AppError(404, "Interview question not found.");
      await db()
        .prepare(
          "UPDATE interview_state SET current_question=?,capture_status=?,capture_started=? WHERE session=?",
        )
        .run(
          questionId,
          status,
          status === "recording" ? Date.now() : null,
          id,
        );
      return response({ saved: true });
    }
    if (action === "recheck") {
      if (role !== "interviewer")
        throw new AppError(403, "Only the interviewer can request a recheck.");
      const operationId = z.uuid().parse(input.operationId);
      const row = (await db()
        .prepare(
          "SELECT result FROM operations WHERE id=? AND session=? AND kind='analyze'",
        )
        .get(operationId, id)) as { result?: string } | undefined;
      if (!row?.result)
        throw new AppError(404, "Verification result not found.");
      const result = JSON.parse(row.result) as Record<string, unknown>;
      if (result.outcome === "passed")
        throw new AppError(409, "A passed result does not require a recheck.");
      const questionId = z.uuid().parse(result.questionId);
      const state = await interviewState(id);
      if (state.recheck_operation)
        throw new AppError(409, "A recheck request is already active.");
      await db()
        .prepare(
          "UPDATE interview_state SET current_question=?,capture_status='waiting',capture_started=NULL,recheck_question=?,recheck_operation=?,recheck_requested=? WHERE session=?",
        )
        .run(questionId, questionId, operationId, Date.now(), id);
      return response({ requested: true });
    }
    if (action === "review") {
      if (role !== "interviewer")
        throw new AppError(
          403,
          "Only the interviewer can record a review decision.",
        );
      const operationId = z.uuid().parse(input.operationId);
      const questionId = z.uuid().parse(input.questionId);
      const decision = z
        .enum([
          "pending_review",
          "concern_resolved",
          "further_verification_required",
          "escalated_manual_review",
        ])
        .parse(input.decision);
      const notes = z
        .string()
        .trim()
        .max(1000)
        .parse(input.notes ?? "");
      const row = await db()
        .prepare(
          "SELECT id FROM operations WHERE id=? AND session=? AND kind='analyze'",
        )
        .get(operationId, id);
      const question = await db()
        .prepare("SELECT id FROM questions WHERE id=? AND session=?")
        .get(questionId, id);
      if (!row || !question)
        throw new AppError(404, "Verification result or question not found.");
      const review = {
        id: randomUUID(),
        question: questionId,
        operation: operationId,
        decision,
        notes,
        created: Date.now(),
      };
      await db()
        .prepare(
          "INSERT INTO reviews (id,session,question,operation,decision,notes,created) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          review.id,
          id,
          questionId,
          operationId,
          decision,
          notes,
          review.created,
        );
      return response(review);
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
    if (action === "incomplete") {
      if (role !== "interviewer")
        throw new AppError(
          403,
          "Only the interviewer can record verification history.",
        );
      if (!s.consent || s.ended)
        throw new AppError(403, "Active candidate consent is required.");
      const operationId = z.uuid().parse(input.operationId);
      const questionId = z.uuid().parse(input.questionId);
      const questionRow = (await db()
        .prepare("SELECT text FROM questions WHERE id=? AND session=?")
        .get(questionId, id)) as { text: string } | undefined;
      if (!questionRow)
        throw new AppError(404, "Interview question not found.");
      const question = questionRow.text;
      const captureStart = z.number().finite().parse(input.captureStart);
      const captureEnd = z.number().finite().parse(input.captureEnd);
      const reason = z.string().trim().min(1).max(500).parse(input.reason);
      if (
        captureStart < s.consent ||
        captureEnd <= captureStart ||
        captureEnd - captureStart > 30_000 ||
        captureEnd > Date.now() + 2000 ||
        Date.now() - captureEnd > 120_000
      )
        throw new AppError(400, "Invalid incomplete capture interval.");
      const result = {
        id: operationId,
        questionId,
        attemptNumber:
          (await verificationHistory(id)).filter(
            (item: { questionId?: string }) => item.questionId === questionId,
          ).length + 1,
        recheckOf: typeof input.recheckOf === "string" ? input.recheckOf : null,
        question,
        captureStart,
        captureEnd,
        receivedAt: Date.now(),
        providerStatus: null,
        speaker: "unavailable",
        deepfake: "unavailable",
        outcome: "incomplete",
        partialFailure: true,
        speakerSimilarity: null,
        speakerThreshold: null,
        speakerDurationSeconds: null,
        deepfakeScore: null,
        deepfakeThreshold: null,
        deepfakeDurationSeconds: null,
        deepfakeSegments: [],
        speakerErrorCode: "not_submitted",
        speakerErrorMessage: reason,
        deepfakeErrorCode: "not_submitted",
        deepfakeErrorMessage: reason,
        speakerError: "not_submitted",
        deepfakeError: "not_submitted",
      };
      await db()
        .prepare(
          "INSERT INTO operations (id,session,kind,digest,result) VALUES (?,?,?,?,?)",
        )
        .run(operationId, id, "analyze", "preflight", JSON.stringify(result));
      await db()
        .prepare(
          "UPDATE interview_state SET capture_status='failed',capture_started=NULL WHERE session=?",
        )
        .run(id);
      return response(result);
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
      "question",
      "questionId",
      "recheckOf",
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
    let question: string | undefined;
    let questionId: string | undefined;
    let recheckOf: string | null = null;
    let attemptNumber: number | undefined;
    if (action === "analyze") {
      questionId = z.uuid().parse(input.questionId);
      const questionRow = (await db()
        .prepare("SELECT text FROM questions WHERE id=? AND session=?")
        .get(questionId, id)) as { text: string } | undefined;
      if (!questionRow)
        throw new AppError(404, "Interview question not found.");
      question = questionRow.text;
      const history = await verificationHistory(id);
      attemptNumber =
        history.filter(
          (item: { questionId?: string }) => item.questionId === questionId,
        ).length + 1;
      const state = await interviewState(id);
      recheckOf =
        state.recheck_question === questionId ? state.recheck_operation : null;
    }
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
          question,
          questionId,
          attemptNumber,
          recheckOf,
          receivedAt: Date.now(),
          providerStatus: upstream.status,
        };
      }
      await db()
        .prepare("UPDATE operations SET result=? WHERE id=?")
        .run(JSON.stringify(output), operationId);
      if (action === "analyze")
        await db()
          .prepare(
            "UPDATE interview_state SET capture_status='completed',capture_started=NULL,recheck_question=NULL,recheck_operation=NULL,recheck_requested=NULL WHERE session=?",
          )
          .run(id);
      return response(output);
    } catch (error) {
      if (action === "analyze") {
        const status = error instanceof AppError ? error.status : 500;
        const message =
          error instanceof AppError
            ? error.message
            : "The verification request could not be completed.";
        const failed = {
          speaker: "unavailable",
          deepfake: "unavailable",
          outcome: "incomplete",
          partialFailure: true,
          speakerSimilarity: null,
          speakerThreshold: null,
          speakerDurationSeconds: null,
          deepfakeScore: null,
          deepfakeThreshold: null,
          deepfakeDurationSeconds: null,
          deepfakeSegments: [],
          speakerErrorCode: "request_failed",
          speakerErrorMessage: message,
          deepfakeErrorCode: "request_failed",
          deepfakeErrorMessage: message,
          speakerError: "request_failed",
          deepfakeError: "request_failed",
          id: operationId,
          captureStart,
          captureEnd,
          question,
          questionId,
          attemptNumber,
          recheckOf,
          receivedAt: Date.now(),
          providerStatus: status,
        };
        await db()
          .prepare("UPDATE operations SET result=? WHERE id=?")
          .run(JSON.stringify(failed), operationId);
        await db()
          .prepare(
            "UPDATE interview_state SET capture_status='failed',capture_started=NULL WHERE session=?",
          )
          .run(id);
      }
      throw error;
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
