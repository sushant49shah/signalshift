import { encodeWav } from "./wav";
export async function capture(
  track: MediaStreamTrack,
  seconds: number,
  signal: AbortSignal,
  finishSignal?: AbortSignal,
): Promise<{ file: Blob; start: number; end: number }> {
  if (
    signal.aborted ||
    track.kind !== "audio" ||
    track.readyState !== "live" ||
    !track.enabled ||
    track.muted
  )
    throw new Error("Audio track is unavailable.");
  // Clone only the selected track; never stop the original LiveKit track.
  const clone = track.clone();
  const context = new AudioContext({ sampleRate: 48000 });
  let node: AudioWorkletNode | undefined,
    source: MediaStreamAudioSourceNode | undefined;
  try {
    await context.resume();
    await context.audioWorklet.addModule("/pcm-worklet.js");
    if (signal.aborted) throw new Error("Capture cancelled.");
    source = context.createMediaStreamSource(new MediaStream([clone]));
    node = new AudioWorkletNode(context, "segment-recorder", {
      processorOptions: { frames: Math.round(context.sampleRate * seconds) },
    });
    const mute = context.createGain();
    mute.gain.value = 0;
    const start = Date.now();
    const samples = await new Promise<Float32Array>((resolve, reject) => {
      const fail = () => {
        clean();
        reject(new Error("Capture cancelled or audio interrupted."));
      };
      const finish = () => node!.port.postMessage("stop");
      const timer = setTimeout(
        () => {
          clean();
          reject(
            new Error(
              "Audio capture stalled. Keep this tab active and try again.",
            ),
          );
        },
        (seconds + 8) * 1000,
      );
      const clean = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", fail);
        finishSignal?.removeEventListener("abort", finish);
        track.removeEventListener("ended", fail);
        track.removeEventListener("mute", fail);
      };
      signal.addEventListener("abort", fail, { once: true });
      if (finishSignal?.aborted) finish();
      else finishSignal?.addEventListener("abort", finish, { once: true });
      track.addEventListener("ended", fail, { once: true });
      track.addEventListener("mute", fail, { once: true });
      node!.port.onmessage = (e) => {
        clean();
        resolve(new Float32Array(e.data));
      };
      node!.onprocessorerror = () => {
        clean();
        reject(new Error("Audio capture failed."));
      };
      source!.connect(node!);
      node!.connect(mute);
      mute.connect(context.destination);
    });
    if (signal.aborted) throw new Error("Capture cancelled.");
    return {
      file: new Blob([encodeWav(samples, context.sampleRate)], {
        type: "audio/wav",
      }),
      start,
      end: start + (samples.length / context.sampleRate) * 1000,
    };
  } finally {
    source?.disconnect();
    node?.disconnect();
    clone.stop();
    await context.close();
  }
}
