"use client";
import { useEffect, useRef, useState } from "react";
import { capture } from "@/lib/capture";
import { encodeWav } from "@/lib/wav";
import type { normalizeDetection } from "@/lib/results";
type Result = ReturnType<typeof normalizeDetection> & {
  elapsedMs: number;
  error?: string;
};
export default function TestAudio() {
  const [consent, setConsent] = useState(false),
    [code, setCode] = useState(""),
    [clip, setClip] = useState<Blob | null>(null);
  const [name, setName] = useState(""),
    [status, setStatus] = useState("idle"),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  const controller = useRef<AbortController | null>(null),
    stream = useRef<MediaStream | null>(null),
    locked = useRef(false);
  useEffect(
    () => () => {
      controller.current?.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  function cancel() {
    controller.current?.abort();
    stream.current?.getTracks().forEach((t) => t.stop());
    setStatus("cancelled");
  }
  async function prepare(file: File) {
    if (locked.current) return;
    locked.current = true;
    setClip(null);
    setResult(null);
    setError("");
    setStatus("Preparing audio…");
    const abort = new AbortController();
    controller.current = abort;
    let context: AudioContext | undefined;
    try {
      if (file.size > 10_000_000)
        throw new Error("Choose a file smaller than 10 MB.");
      context = new AudioContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration <= 4 || decoded.duration > 30)
        throw new Error(
          "Choose audio longer than 4 seconds and no longer than 30 seconds.",
        );
      const offline = new OfflineAudioContext(
        1,
        Math.ceil(decoded.duration * 16000),
        16000,
      );
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const normalized = await offline.startRendering();
      if (abort.signal.aborted) return;
      setClip(
        new Blob([encodeWav(normalized.getChannelData(0), 16000)], {
          type: "audio/wav",
        }),
      );
      setName(file.name);
      setStatus("Ready to submit");
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not decode this audio format.",
        );
        setStatus("error");
      }
    } finally {
      await context?.close();
      locked.current = false;
    }
  }
  async function record() {
    if (locked.current || !consent) return;
    locked.current = true;
    setClip(null);
    setResult(null);
    setError("");
    setStatus("Allow microphone access…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (abort.signal.aborted) return;
      setStatus("Recording 10 seconds — speak naturally…");
      const captured = await capture(
        stream.current.getAudioTracks()[0],
        10,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setClip(captured.file);
      setName("10-second microphone recording");
      setStatus("Ready to submit");
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : "Microphone unavailable.");
        setStatus("error");
      }
    } finally {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      locked.current = false;
    }
  }
  async function analyze() {
    if (locked.current || !clip || !consent) return;
    locked.current = true;
    setResult(null);
    setError("");
    setStatus("Pending — uploading and processing with DetectifAI…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const form = new FormData();
      form.set("file", clip, "test.wav");
      form.set("consent", "true");
      form.set("accessCode", code);
      form.set("operationId", crypto.randomUUID());
      const response = await fetch("/api/test-audio", {
        method: "POST",
        body: form,
        signal: abort.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analysis unavailable.");
      if (abort.signal.aborted) return;
      setResult(body);
      setStatus(body.status === "complete" ? "Complete" : "error");
      setClip(null);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : "Analysis unavailable.");
        setStatus("error");
      }
    } finally {
      locked.current = false;
    }
  }
  const busy = ![
    "idle",
    "Ready to submit",
    "Complete",
    "error",
    "cancelled",
  ].includes(status);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-10">
      <a href="/">← Interview room</a>
      <header>
        <h1 className="text-4xl font-bold">Test audio</h1>
        <p className="mt-3">
          Upload or record a short clip for a real DetectifAI synthetic-speech
          check. No video call or speaker enrollment is required.
        </p>
      </header>
      <section className="panel space-y-4">
        <p>
          Audio is sent through this backend to DetectifAI. The app does not
          save the recording. Results can be wrong; they are not proof of
          misconduct. Vendor retention is governed by the provider. Cancellation
          cannot recall audio already transmitted.
        </p>
        <label className="block">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (!e.target.checked) {
                cancel();
                setClip(null);
              }
            }}
          />
          I have permission from the speaker to process this audio and consent
          to sending it to DetectifAI.
        </label>
        <label className="block">
          Coordinator / demo access code
          <input
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
        </label>
        <p className="note">
          The page is public. The shared demo code protects paid API usage. Use
          a clip longer than 4 seconds and at most 30 seconds. Browser-decodable
          WAV, MP3, M4A, OGG, or WebM files are converted locally to mono WAV
          before upload.
        </p>
        <label className="block">
          Choose audio
          <input
            className="mt-2 block w-full"
            type="file"
            accept="audio/*"
            disabled={!consent || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void prepare(file);
              e.target.value = "";
            }}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            className="secondary"
            disabled={!consent || busy}
            onClick={record}
          >
            Record 10 seconds
          </button>
          <button disabled={!clip || !consent || busy} onClick={analyze}>
            Analyze audio
          </button>
          {busy && (
            <button className="secondary" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
        {name && <p className="note">Selected: {name}</p>}
        <p role="status" aria-live="polite">
          Processing status: {status}
        </p>
        {error && (
          <div className="error" role="alert">
            <strong>Inconclusive — analysis unavailable.</strong>
            <p>{error}</p>
            <p>No model score was returned.</p>
          </div>
        )}
      </section>
      {result && (
        <section className="panel space-y-3" aria-live="polite">
          <h2>{result.label}</h2>
          <p>
            Returned model score:{" "}
            <strong>
              {result.score === null ? "Unavailable" : result.score.toFixed(4)}
            </strong>
          </p>
          <p className="note">
            The score ranges from 0 to 1; higher means the first model
            considered the clip more likely synthetic. The classification
            follows the provider’s verdict, not a threshold applied by this app.
          </p>
          {result.verdict === "not_sure" && (
            <p>
              The provider could not decide reliably. Try a clearer or longer
              sample.
            </p>
          )}
          {result.error && <p className="error">{result.error}</p>}
          <p className="note">
            Request duration: {(result.elapsedMs / 1000).toFixed(1)} seconds ·
            Operation: {result.operationId || "Not returned"}
          </p>
        </section>
      )}
    </main>
  );
}
