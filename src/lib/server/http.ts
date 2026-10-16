import { timingSafeEqual } from "node:crypto";
import { AppError, required } from "./provider";
import { hash } from "./store";
export function appOrigin() {
  const value = required("APP_ORIGIN").replace(/\/$/, "");
  const url = new URL(value);
  if (process.env.VERCEL && url.protocol !== "https:")
    throw new AppError(
      503,
      "APP_ORIGIN must be the HTTPS deployment URL on Vercel.",
    );
  return url.origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin())
    throw new AppError(403, "Request origin is not allowed.");
}
export function checkAccessCode(value: unknown) {
  const code = process.env.DEMO_ACCESS_CODE;
  if (!code && new URL(appOrigin()).hostname !== "localhost")
    throw new AppError(503, "Set DEMO_ACCESS_CODE before exposing the demo.");
  if (
    code &&
    !timingSafeEqual(
      Buffer.from(hash(String(value || ""))),
      Buffer.from(hash(code)),
    )
  )
    throw new AppError(403, "Invalid demo access code.");
}
export async function readBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new AppError(413, "Upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "Upload is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
