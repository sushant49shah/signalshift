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
export type RecommendationTone =
  "positive" | "warning" | "critical" | "neutral";
export interface VerificationRecommendation {
  action:
    | "Continue Interview"
    | "Review Audio"
    | "Request Identity Recheck"
    | "Prioritize Human Review"
    | "Request Cleaner Recording"
    | "Retry Verification";
  explanation: string;
  tone: RecommendationTone;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function recommendVerification(
  value: unknown,
): VerificationRecommendation {
  const result = object(value);
  const speaker = result.speaker;
  const deepfake = result.deepfake;
  const hasValidSpeaker = speaker === "match" || speaker === "no_match";
  const hasValidDeepfake =
    deepfake === "real" || deepfake === "fake" || deepfake === "not_sure";
  const hasProviderFailure =
    !hasValidSpeaker ||
    !hasValidDeepfake ||
    result.partialFailure === true ||
    (typeof result.providerStatus === "number" &&
      (result.providerStatus < 200 || result.providerStatus >= 300)) ||
    typeof result.speakerError === "string" ||
    typeof result.speakerErrorCode === "string" ||
    typeof result.speakerErrorMessage === "string" ||
    typeof result.deepfakeError === "string" ||
    typeof result.deepfakeErrorCode === "string" ||
    typeof result.deepfakeErrorMessage === "string";

  if (hasProviderFailure)
    return {
      action: "Retry Verification",
      explanation:
        "One or both provider checks failed, are missing, or returned an unusable verdict. Retry the verification before drawing a conclusion.",
      tone: "neutral",
    };
  if (deepfake === "not_sure")
    return {
      action: "Request Cleaner Recording",
      explanation:
        "The synthetic-speech check was inconclusive. Ask for a longer, clearer recording in a quiet environment and verify it again.",
      tone: "warning",
    };
  if (speaker === "match" && deepfake === "real")
    return {
      action: "Continue Interview",
      explanation:
        "DetectifAI returned a speaker match and classified this sample as authentic speech. Continue if the reviewer has no other concerns.",
      tone: "positive",
    };
  if (speaker === "match" && deepfake === "fake")
    return {
      action: "Review Audio",
      explanation:
        "The voice matched the enrolled reference, but DetectifAI returned a synthetic-speech signal. Review the recording and provider evidence.",
      tone: "warning",
    };
  if (speaker === "no_match" && deepfake === "real")
    return {
      action: "Request Identity Recheck",
      explanation:
        "The sample was classified as authentic speech, but the speaker did not match the enrolled reference. Confirm identity and capture a fresh sample.",
      tone: "warning",
    };
  return {
    action: "Prioritize Human Review",
    explanation:
      "DetectifAI returned both a speaker mismatch and a synthetic-speech signal. A human reviewer should assess the audio and context before proceeding.",
    tone: "critical",
  };
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
