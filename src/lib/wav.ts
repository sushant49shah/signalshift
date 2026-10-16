// A complete, independently decodable mono PCM16 WAV. Sample rate is never relabeled.
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buffer;
}
export function inspectWav(
  buffer: ArrayBuffer,
  kind: "enroll" | "analyze" | "test",
) {
  const v = new DataView(buffer),
    text = (o: number, n: number) =>
      String.fromCharCode(...new Uint8Array(buffer, o, n));
  if (buffer.byteLength < 44 || buffer.byteLength > 3_500_000)
    throw new Error("Upload must be a complete WAV smaller than 3.5 MB.");
  if (
    text(0, 4) !== "RIFF" ||
    text(8, 4) !== "WAVE" ||
    text(12, 4) !== "fmt " ||
    text(36, 4) !== "data" ||
    v.getUint32(16, true) !== 16 ||
    v.getUint16(20, true) !== 1 ||
    v.getUint16(22, true) !== 1 ||
    v.getUint16(34, true) !== 16
  )
    throw new Error("Expected mono PCM16 WAV.");
  const rate = v.getUint32(24, true),
    bytes = v.getUint32(40, true);
  if (
    rate < 16000 ||
    rate > 48000 ||
    bytes % 2 ||
    bytes + 44 !== buffer.byteLength ||
    v.getUint32(4, true) + 8 !== buffer.byteLength ||
    v.getUint32(28, true) !== rate * 2 ||
    v.getUint16(32, true) !== 2
  )
    throw new Error("Invalid WAV lengths or sample rate.");
  const duration = bytes / 2 / rate;
  if (
    kind === "enroll"
      ? duration < 15 || duration > 30
      : duration <= 4 || duration > 30
  )
    throw new Error(
      kind === "enroll"
        ? "Record 15–30 seconds for enrollment."
        : "Analysis needs more than 4 seconds and no more than 30 seconds of audio.",
    );
  let energy = 0;
  for (let i = 44; i < buffer.byteLength; i += 2)
    energy += (v.getInt16(i, true) / 32768) ** 2;
  if (Math.sqrt(energy / (bytes / 2)) < 0.001)
    throw new Error(
      "Audio is silent or too quiet. Recapture with a working microphone.",
    );
  return { duration, sampleRate: rate }; // Energy is not speech validation; DetectifAI validates speech.
}
