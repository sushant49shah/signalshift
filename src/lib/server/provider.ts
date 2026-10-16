import { object } from "../results";
const BASE = "https://platform.detectif.ai/v1";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function required(name: string) {
  const value = process.env[name];
  if (!value || value.includes("your-project"))
    throw new AppError(503, `Server configuration missing: ${name}.`);
  return value;
}
export function providerMessage(status: number) {
  return (
    (
      {
        401: "DetectifAI credentials are invalid.",
        403: "DetectifAI permission or scope is missing.",
        402: "DetectifAI credits are exhausted.",
        422: "DetectifAI could not use this audio. Record clear speech and try again.",
        429: "DetectifAI is rate limited. Wait before trying again.",
        409: "DetectifAI operation is still in progress or conflicts with a previous request.",
      } as Record<number, string>
    )[status] || "DetectifAI is unavailable. No successful check is assumed."
  );
}
export async function provider(
  path: string,
  init: RequestInit,
  canContinue: () => boolean = () => true,
) {
  const key = required("DETECTIF_API_KEY");
  let last: { ok: boolean; status: number; body: unknown } | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!canContinue())
      throw new AppError(409, "Consent was withdrawn or the session ended.");
    try {
      const response = await fetch(BASE + path, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
        redirect: "error",
      });
      const text = await response.text();
      if (text.length > 1_000_000)
        throw new AppError(502, "DetectifAI returned an oversized response.");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError(502, "DetectifAI returned an invalid response.");
      }
      last = { ok: response.ok, status: response.status, body };
      // Preserve charged partial outcomes. Never re-run a partial check automatically.
      if (
        object(body).partial ||
        ![429, 502, 503, 504].includes(response.status) ||
        attempt === 2
      )
        return last;
      const retry = response.headers.get("retry-after");
      const delay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : 1000 * (attempt + 1);
      if (!Number.isFinite(delay) || delay > 5000) return last; // no early retry if provider asks for a longer wait
      await new Promise((r) => setTimeout(r, delay));
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Ambiguous transport failures are surfaced, not automatically recaptured or rebilled.
      throw new AppError(
        504,
        "DetectifAI timed out or could not be reached. The result is unavailable; the request may have reached the provider.",
      );
    }
  }
  return last!;
}
export async function deleteSpeaker(speaker: string) {
  try {
    const r = await provider("/speakers/" + encodeURIComponent(speaker), {
      method: "DELETE",
    });
    const b = object(r.body);
    return r.ok && b.deleted === true && b.speaker_id === speaker
      ? "Speaker reference deletion confirmed."
      : "Speaker reference deletion not confirmed; manual provider cleanup may be needed.";
  } catch {
    return "Speaker reference deletion not confirmed; manual provider cleanup may be needed.";
  }
}
