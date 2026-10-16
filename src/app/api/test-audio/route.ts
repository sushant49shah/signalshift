import "server-only";
import { z } from "zod";
import { checkOrigin, checkAccessCode, readBody } from "@/lib/server/http";
import { db, hash, rateLimit } from "@/lib/server/store";
import { AppError, provider, providerMessage } from "@/lib/server/provider";
import { inspectWav } from "@/lib/wav";
import { normalizeDetection } from "@/lib/results";
export const runtime = "nodejs";
export const maxDuration = 120;
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const bytes = await readBody(request, 3_600_000);
    const form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const allowed = ["file", "consent", "accessCode", "operationId"];
    if (
      [...form.keys()].some((k) => !allowed.includes(k)) ||
      allowed.some((k) => form.getAll(k).length !== 1)
    )
      throw new AppError(400, "Invalid upload fields.");
    checkAccessCode(form.get("accessCode"));
    if (form.get("consent") !== "true")
      throw new AppError(
        403,
        "Explicit consent and permission to process this audio are required.",
      );
    const id = z.uuid().parse(form.get("operationId"));
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "audio/wav")
      throw new AppError(415, "Expected a complete WAV file.");
    const audio = await file.arrayBuffer();
    inspectWav(audio, "test");
    const digest = hash(new Uint8Array(audio));
    const previous = (await db()
      .prepare("SELECT * FROM operations WHERE id=?")
      .get(id)) as
      { kind: string; digest: string; result: string | null } | undefined;
    if (previous) {
      if (previous.kind !== "test-audio" || previous.digest !== digest)
        throw new AppError(409, "Operation ID conflicts with another request.");
      if (previous.result) return reply(JSON.parse(previous.result));
      throw new AppError(
        409,
        "This check is pending or its result is unknown.",
      );
    }
    if (
      !(await rateLimit("public-audio-minute", 5, 60)) ||
      !(await rateLimit("public-audio-hour", 30, 3600))
    )
      throw new AppError(
        429,
        "Test audio limit reached. Please wait before trying again.",
      );
    const reservation = await db()
      .prepare(
        "INSERT OR IGNORE INTO operations (id,session,kind,digest) VALUES (?,?,?,?)",
      )
      .run(id, "public-test", "test-audio", digest);
    if (reservation.changes !== 1)
      throw new AppError(409, "This check is already pending.");
    const payload = new FormData();
    payload.set("file", new Blob([audio], { type: "audio/wav" }), "test.wav");
    const start = Date.now();
    const upstream = await provider("/deepfake/detect", {
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": id },
    });
    const output = {
      ...normalizeDetection(upstream.body, upstream.ok),
      elapsedMs: Date.now() - start,
      error: upstream.ok ? undefined : providerMessage(upstream.status),
    };
    await db()
      .prepare("UPDATE operations SET result=? WHERE id=?")
      .run(JSON.stringify(output), id);
    return reply(output);
  } catch (error) {
    if (error instanceof AppError)
      return reply({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return reply({ error: "Invalid operation ID." }, 400);
    if (
      error instanceof Error &&
      /WAV|Audio is silent|Analysis requires|Upload must|Expected mono/.test(
        error.message,
      )
    )
      return reply({ error: error.message }, 422);
    return reply(
      { error: "Audio test unavailable. No classification has been assumed." },
      500,
    );
  }
}
