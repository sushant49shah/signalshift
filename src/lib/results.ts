export type Speaker = "match" | "no_match" | "unavailable";
export type Deepfake = "real" | "fake" | "not_sure" | "unavailable";
export interface AnalysisResult {
  speaker: Speaker;
  deepfake: Deepfake;
  outcome: "passed" | "concern" | "incomplete";
  partialFailure: boolean;
  speakerError?: string;
  deepfakeError?: string;
  operationId?: string;
  deepfakeOperationId?: string;
  requestId?: string;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function identifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : undefined;
}
export function normalizeAnalysis(
  body: unknown,
  httpOk: boolean,
): AnalysisResult {
  const b = object(body),
    result = object(b.result);
  const df = object(httpOk ? b.deepfake : object(b.partial).deepfake);
  const speaker: Speaker =
    httpOk &&
    !b.error &&
    b.object === "speaker.verification" &&
    (result.decision === "match" || result.decision === "no_match")
      ? result.decision
      : "unavailable";
  const deepfake: Deepfake =
    !df.error &&
    (df.verdict === "real" ||
      df.verdict === "fake" ||
      df.verdict === "not_sure")
      ? df.verdict
      : "unavailable";
  const partialFailure =
    speaker === "unavailable" || deepfake === "unavailable";
  return {
    speaker,
    deepfake,
    partialFailure,
    outcome:
      speaker === "no_match" || deepfake === "fake"
        ? "concern"
        : speaker === "match" && deepfake === "real"
          ? "passed"
          : "incomplete",
    speakerError:
      speaker === "unavailable"
        ? (identifier(object(b.error).code) ??
          "unavailable_or_invalid_response")
        : undefined,
    deepfakeError:
      deepfake === "unavailable"
        ? (identifier(object(df.error).code) ??
          "unavailable_or_invalid_response")
        : undefined,
    operationId: identifier(b.operation_id),
    deepfakeOperationId: identifier(df.operation_id),
    requestId: identifier(b.request_id),
  };
}

export function normalizeDetection(body: unknown, httpOk: boolean) {
  const b = object(body),
    r = object(b.result);
  const valid = httpOk && b.object === "deepfake.detection" && !b.error;
  const verdict =
    valid && ["real", "fake", "not_sure"].includes(String(r.verdict))
      ? (r.verdict as "real" | "fake" | "not_sure")
      : "unavailable";
  return {
    verdict,
    label:
      verdict === "real"
        ? "Real"
        : verdict === "fake"
          ? "Fake"
          : "Inconclusive",
    score:
      valid &&
      typeof r.score === "number" &&
      Number.isFinite(r.score) &&
      r.score >= 0 &&
      r.score <= 1
        ? r.score
        : null,
    status: verdict === "unavailable" ? "error" : "complete",
    operationId: identifier(b.operation_id),
  };
}
