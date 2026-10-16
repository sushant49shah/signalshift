export type Speaker = "match" | "no_match" | "unavailable";
export type Deepfake = "real" | "fake" | "not_sure" | "unavailable";
export interface AnalysisResult {
  speaker: Speaker;
  deepfake: Deepfake;
  outcome: "passed" | "concern" | "incomplete";
  partialFailure: boolean;
  speakerSimilarity: number | null;
  speakerThreshold: number | null;
  speakerDurationSeconds: number | null;
  deepfakeScore: number | null;
  deepfakeThreshold: number | null;
  deepfakeDurationSeconds: number | null;
  deepfakeDecidedBy?: string;
  deepfakeSegments: Array<{ start: number; end: number; score: number }>;
  speakerErrorCode?: string;
  speakerErrorMessage?: string;
  deepfakeErrorCode?: string;
  deepfakeErrorMessage?: string;
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
function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}
function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 500 ? value : undefined;
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
  const speakerResult = object(result),
    speakerError = object(b.error),
    deepfakeError = object(df.error || (!httpOk ? b.error : undefined));
  const rawSegments = object(df).segments;
  const partialFailure =
    speaker === "unavailable" || deepfake === "unavailable";
  return {
    speaker,
    deepfake,
    partialFailure,
    speakerSimilarity: finite(speakerResult.similarity, -1, 1),
    speakerThreshold: finite(speakerResult.threshold, -1, 1),
    speakerDurationSeconds: finite(speakerResult.duration_seconds, 0, 120),
    deepfakeScore: finite(object(df).score, 0, 1),
    deepfakeThreshold: finite(object(df).threshold, 0, 1),
    deepfakeDurationSeconds: finite(object(df).duration_seconds, 0, 120),
    deepfakeDecidedBy: safeText(object(df).decided_by),
    deepfakeSegments: Array.isArray(rawSegments)
      ? rawSegments.flatMap((value: unknown) => {
          const segment = object(value),
            start = finite(segment.start, 0, 120),
            end = finite(segment.end, 0, 120),
            score = finite(segment.score, 0, 1);
          return start !== null && end !== null && score !== null && end > start
            ? [{ start, end, score }]
            : [];
        })
      : [],
    speakerErrorCode: safeText(speakerError.code),
    speakerErrorMessage: safeText(speakerError.message),
    deepfakeErrorCode: safeText(deepfakeError.code),
    deepfakeErrorMessage: safeText(deepfakeError.message),
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
