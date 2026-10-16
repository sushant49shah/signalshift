"use client";
import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type LocalTrack,
  type RemoteTrack,
  ConnectionState,
} from "livekit-client";
import { capture } from "@/lib/capture";
import type { AnalysisResult } from "@/lib/results";
type Role = "interviewer" | "candidate";
type Session = {
  id: string;
  consent: boolean;
  enrolled: boolean;
  ended: boolean;
  cleanup: string | null;
  expires: number;
  serverTime: number;
};
type Result = AnalysisResult & {
  id: string;
  captureStart: number;
  captureEnd: number;
  receivedAt: number;
  providerStatus: number;
};
async function api(
  action: string,
  data: Record<string, unknown> | FormData,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/" + action, {
    method: "POST",
    headers:
      data instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body: data instanceof FormData ? data : JSON.stringify(data),
    signal,
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok)
    throw new Error(body.error || "Request failed; results are unavailable.");
  return body;
}
function Video({ participant }: { participant?: Participant }) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = participant?.getTrackPublication(Track.Source.Camera)?.track;
  const muted = participant?.getTrackPublication(Track.Source.Camera)?.isMuted;
  useEffect(() => {
    if (!ref.current || !track || muted) return;
    const el = ref.current;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track, muted]);
  return (
    <div className="tile">
      {track && !muted ? (
        <video ref={ref} autoPlay playsInline muted />
      ) : (
        <p>Camera off / waiting</p>
      )}
      <span>{participant?.identity || "Waiting for participant"}</span>
    </div>
  );
}
function RemoteAudio({ track }: { track: RemoteTrack | LocalTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}
const speakerText = {
  match: "Matches the enrolled reference",
  no_match: "Voice differs from the enrolled reference",
  unavailable: "Unavailable — no pass assumed",
};
const deepfakeText = {
  real: "Classified as real speech",
  fake: "Possible synthetic speech detected",
  not_sure: "Uncertain — try a longer or clearer sample",
  unavailable: "Unavailable — no pass assumed",
};
export default function Interview() {
  const [id, setId] = useState(""),
    [role, setRole] = useState<Role>("interviewer"),
    [session, setSession] = useState<Session | null>(null);
  const [invitation, setInvitation] = useState(""),
    [accessCode, setAccessCode] = useState(""),
    [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [elapsed, setElapsed] = useState(0);
  const [room, setRoom] = useState<Room | null>(null),
    [connection, setConnection] = useState("Disconnected"),
    [, redraw] = useState(0);
  const [results, setResults] = useState<Result[]>([]),
    [ready, setReady] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const roomRef = useRef<Room | null>(null),
    operation = useRef<AbortController | null>(null),
    sessionRef = useRef<Session | null>(null),
    processing = useRef(false);
  const clockOffset = useRef(0);
  sessionRef.current = session;
  function cancel() {
    operation.current?.abort();
    operation.current = null;
  }
  useEffect(() => {
    const url = new URL(location.href),
      sid = url.searchParams.get("session"),
      r =
        url.searchParams.get("role") === "candidate"
          ? "candidate"
          : "interviewer";
    setRole(r);
    if (sid) {
      setId(sid);
      const invite = url.hash.slice(1);
      if (invite && r === "candidate") {
        api("join", { id: sid, role: r, invitation: invite })
          .then((s) => {
            clockOffset.current = s.serverTime - Date.now();
            setSession(s);
            history.replaceState(null, "", url.pathname + url.search);
            setReady(true);
          })
          .catch((e) => {
            setError(e.message);
            setReady(true);
          });
      } else {
        setReady(true);
      }
    } else {
      setReady(true);
    }
    return () => {
      operation.current?.abort();
      void roomRef.current?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!id || !ready) return;
    let stopped = false;
    async function refresh() {
      try {
        const s = await api("status", { id, role });
        if (stopped) return;
        clockOffset.current = s.serverTime - Date.now();
        setSession(s);
        if (s.ended) {
          cancel();
          void roomRef.current?.disconnect();
        }
        if (!s.consent) {
          cancel();
        }
      } catch (e) {
        if (!stopped) {
          cancel();
          setSession(null);
          setError(
            e instanceof Error ? e.message : "Session state unavailable.",
          );
        }
      }
    }
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, role, ready]);
  async function run(task: () => Promise<void>) {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed.");
    } finally {
      processing.current = false;
      setBusy(false);
      setPhase("");
    }
  }
  async function create() {
    await run(async () => {
      const data = await api("sessions", { accessCode });
      setId(data.id);
      setRole("interviewer");
      setInvitation(
        `${data.origin}/?session=${data.id}&role=candidate#${data.invitation}`,
      );
      history.replaceState(null, "", `/?session=${data.id}&role=interviewer`);
    });
  }
  async function connect() {
    await run(async () => {
      await roomRef.current?.disconnect();
      if (role === "candidate" && !session?.consent) {
        if (!accepted) throw new Error("Explicit consent is required.");
        setSession(
          await api("consent", {
            id,
            role,
            accepted: true,
            notice: "2026-10-16-v1",
          }),
        );
      }
      const data = await api("rooms/token", { id, role });
      const next = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = next;
      setRoom(next);
      const update = () => redraw((x) => x + 1);
      next.on(RoomEvent.ConnectionStateChanged, (state) => {
        setConnection(state);
        if (state !== ConnectionState.Connected) cancel();
        update();
      });
      next
        .on(RoomEvent.ParticipantConnected, update)
        .on(RoomEvent.ParticipantDisconnected, () => {
          cancel();
          update();
        })
        .on(RoomEvent.TrackSubscribed, update)
        .on(RoomEvent.TrackUnsubscribed, () => {
          cancel();
          update();
        })
        .on(RoomEvent.LocalTrackPublished, update)
        .on(RoomEvent.LocalTrackUnpublished, () => {
          cancel();
          update();
        })
        .on(RoomEvent.TrackMuted, () => {
          cancel();
          update();
        })
        .on(RoomEvent.TrackUnmuted, update);
      try {
        await next.connect(data.url, data.token);
        await next.startAudio();
        await next.localParticipant.setMicrophoneEnabled(true);
        try {
          await next.localParticipant.setCameraEnabled(true);
        } catch {
          setMessage(
            "Camera permission unavailable. Audio is connected; camera remains off.",
          );
        }
        update();
      } catch {
        await next.disconnect();
        setRoom(null);
        roomRef.current = null;
        throw new Error(
          "Could not connect or enable the microphone. Check media permissions and LiveKit configuration.",
        );
      }
    });
  }
  async function record(kind: "enroll" | "analyze") {
    await run(async () => {
      setAnalysisError("");
      const current = roomRef.current;
      if (
        !current ||
        current.state !== ConnectionState.Connected ||
        !sessionRef.current?.consent ||
        sessionRef.current.ended
      )
        throw new Error("A connected call and active consent are required.");
      const participant =
        kind === "enroll"
          ? current.localParticipant
          : current.remoteParticipants.get("candidate");
      const publication = participant?.getTrackPublication(
        Track.Source.Microphone,
      );
      if (
        !publication?.track ||
        publication.isMuted ||
        participant?.identity !== "candidate"
      )
        throw new Error("Candidate microphone is unavailable or muted.");
      const controller = new AbortController();
      operation.current = controller;
      const seconds = kind === "enroll" ? 25 : 8;
      setElapsed(0);
      setPhase(
        kind === "enroll"
          ? "Recording voice reference (25 seconds)"
          : "Capturing candidate remote audio (8 seconds)",
      );
      const timer = setInterval(
        () => setElapsed((v) => Math.min(seconds, v + 1)),
        1000,
      );
      try {
        const clip = await capture(
          publication.track.mediaStreamTrack,
          seconds,
          controller.signal,
        );
        clearInterval(timer);
        if (
          controller.signal.aborted ||
          !sessionRef.current?.consent ||
          sessionRef.current.ended
        )
          throw new Error("Capture cancelled.");
        setPhase(
          kind === "enroll"
            ? "Creating voice reference with DetectifAI…"
            : "Pending — DetectifAI is analyzing both checks…",
        );
        const form = new FormData();
        form.set("id", id);
        form.set("role", role);
        form.set("file", clip.file, "sample.wav");
        form.set("operationId", crypto.randomUUID());
        form.set("captureStart", String(clip.start + clockOffset.current));
        form.set("captureEnd", String(clip.end + clockOffset.current));
        const result = await api(kind, form, controller.signal);
        if (controller.signal.aborted || sessionRef.current?.ended) return;
        if (kind === "enroll") {
          setSession(await api("status", { id, role }));
          setMessage(
            "DetectifAI accepted the voice reference. The interviewer can now check an audio segment.",
          );
        } else setResults((previous) => [...previous, result]);
      } catch (e) {
        if (kind === "analyze")
          setAnalysisError(
            controller.signal.aborted
              ? "Check cancelled or interrupted. No result assumed."
              : e instanceof Error
                ? e.message
                : "Analysis failed.",
          );
        throw e;
      } finally {
        clearInterval(timer);
        if (operation.current === controller) operation.current = null;
      }
    });
  }
  async function stop(action: "end" | "withdraw") {
    cancel();
    setSession((s) =>
      s ? { ...s, ended: true, consent: false, enrolled: false } : s,
    );
    void roomRef.current?.disconnect();
    setMessage("Stopping session and requesting reference cleanup…");
    try {
      const result = await api(action, { id, role });
      setMessage(
        `${result.cleanup} ${result.roomCleanup} Already transmitted audio cannot be recalled.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup failed.");
      setMessage(
        "Local capture stopped. Server revocation or cleanup was not confirmed. Retry ending the session.",
      );
    }
  }
  const connected = room?.state === ConnectionState.Connected;
  const remote = room ? [...room.remoteParticipants.values()][0] : undefined;
  const candidate =
    role === "candidate"
      ? room?.localParticipant
      : room?.remoteParticipants.get("candidate");
  const candidateMic = candidate?.getTrackPublication(Track.Source.Microphone);
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-10">
      <nav>
        <a href="/test-audio">Test audio without a call →</a>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            Technical foundation · live provider integration
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">
            SignalShift AI
          </h1>
          <p className="mt-2 text-slate-600">
            Voice continuity and synthetic-speech checks for a consented
            interview.
          </p>
        </div>
        <span className="rounded-full border border-slate-300 px-3 py-2 text-sm">
          {id ? role : "Two-person room"}
        </span>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="panel">
          {message}
        </p>
      )}
      {!id ? (
        <section className="panel max-w-xl space-y-5">
          <h2>Start an interview</h2>
          <p>
            Create a room, invite the candidate, enroll their voice, then check
            one complete audio segment.
          </p>
          <label className="block space-y-2">
            <span>Demo access code (if configured)</span>
            <input
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button disabled={busy || !ready} onClick={create}>
            Create interview
          </button>
          <p className="note">
            Requires configured LiveKit and DetectifAI accounts. Results apply
            only to the checked sample and do not establish legal identity.
          </p>
        </section>
      ) : (
        <>
          {invitation && (
            <section className="panel space-y-3">
              <h2>Invite the candidate</h2>
              <p className="note">
                Share privately. This link grants candidate access for up to two
                hours. Use a separate browser or device and headphones.
              </p>
              <input
                aria-label="Candidate invitation"
                type="text"
                readOnly
                value={invitation}
              />
              <button
                className="secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(invitation)
                    .then(() => setMessage("Candidate link copied."))
                    .catch(() =>
                      setError(
                        "Clipboard unavailable. Select and copy the link.",
                      ),
                    )
                }
              >
                Copy candidate link
              </button>
            </section>
          )}
          {role === "candidate" && !session?.consent && !session?.ended && (
            <section className="panel space-y-4">
              <h2>Before you join</h2>
              <p>
                Audio and video travel through LiveKit. With your consent, a
                25-second voice reference and selected audio clips are sent
                through this application to DetectifAI for speaker comparison
                and synthetic-speech detection. Video is not analyzed.
              </p>
              <p>
                Results can be wrong. They support human review and never
                automatically reject a candidate. The application does not save
                audio recordings. DetectifAI retains a speaker reference; we
                request deletion when the session ends. Vendor retention and
                deletion guarantees have not been independently verified.
              </p>
              <p>
                You can withdraw below. This stops the session and new uploads;
                audio already sent cannot be recalled. Consent and result
                metadata remain in the local server database. Browser microphone
                permission is separate from this consent.
              </p>
              <label className="block">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                I agree to voice enrollment and analysis for this session.
              </label>
              <p className="note">Notice version: 2026-10-16-v1</p>
            </section>
          )}
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <section className="panel space-y-4">
              <div className="flex flex-wrap justify-between gap-2">
                <h2>Interview room</h2>
                <span className="note">Call: {connection}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Video participant={room?.localParticipant} />
                <Video participant={remote} />
              </div>
              {remote &&
                [...remote.audioTrackPublications.values()]
                  .filter((p) => p.track)
                  .map((p) => (
                    <RemoteAudio key={p.trackSid} track={p.track!} />
                  ))}
              <div className="flex flex-wrap gap-2">
                {!connected && !session?.ended && (
                  <button
                    disabled={
                      busy ||
                      !session ||
                      (role === "candidate" && !accepted && !session.consent)
                    }
                    onClick={connect}
                  >
                    {role === "candidate" && !session?.consent
                      ? "Agree and join call"
                      : "Join call"}
                  </button>
                )}
                {connected && (
                  <>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await room!.localParticipant.setMicrophoneEnabled(
                            !room!.localParticipant.isMicrophoneEnabled,
                          );
                          redraw((v) => v + 1);
                        })
                      }
                    >
                      {room?.localParticipant.isMicrophoneEnabled
                        ? "Mute"
                        : "Enable microphone"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await room!.localParticipant.setCameraEnabled(
                            !room!.localParticipant.isCameraEnabled,
                          );
                          redraw((v) => v + 1);
                        })
                      }
                    >
                      {room?.localParticipant.isCameraEnabled
                        ? "Turn camera off"
                        : "Enable camera"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        room!
                          .startAudio()
                          .catch(() =>
                            setError("Audio playback blocked by browser."),
                          )
                      }
                    >
                      Enable playback
                    </button>
                  </>
                )}
                <button
                  className="danger"
                  onClick={() =>
                    stop(role === "candidate" ? "withdraw" : "end")
                  }
                >
                  {session?.ended
                    ? "Retry session cleanup"
                    : role === "candidate"
                      ? session?.consent
                        ? "Withdraw consent & end"
                        : "Decline & leave"
                      : "End session"}
                </button>
              </div>
              <p className="note">
                {session?.ended
                  ? "Session ended. Capture and new analysis are stopped."
                  : candidateMic?.isMuted
                    ? "Candidate microphone muted — no analyzable sample."
                    : "Use headphones to reduce acoustic echo. Keep the recording tab active."}
              </p>
            </section>
            <section className="panel space-y-4" aria-live="polite">
              <h2>Voice analysis</h2>
              <p>
                Consent:{" "}
                <strong>
                  {session?.consent
                    ? "Accepted"
                    : session?.ended
                      ? "Withdrawn / ended"
                      : "Awaiting candidate"}
                </strong>
              </p>
              <p>
                Voice reference:{" "}
                <strong>
                  {session?.enrolled ? "Accepted by DetectifAI" : "Not ready"}
                </strong>
              </p>
              {role === "candidate" ? (
                <>
                  <p>
                    Introduce yourself and describe a recent project. Speak
                    naturally for 25 seconds, with at least 10 seconds of clear
                    speech.
                  </p>
                  <button
                    disabled={
                      busy ||
                      !connected ||
                      !session?.consent ||
                      session.enrolled ||
                      session.ended
                    }
                    onClick={() => record("enroll")}
                  >
                    Record 25-second voice reference
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Ask the candidate to speak, then capture one complete
                    eight-second segment from their remote microphone track.
                  </p>
                  <button
                    disabled={
                      busy ||
                      !connected ||
                      !session?.enrolled ||
                      !session.consent ||
                      session.ended ||
                      !candidateMic?.track ||
                      candidateMic.isMuted
                    }
                    onClick={() => record("analyze")}
                  >
                    Capture & analyze 8 seconds
                  </button>
                  <p className="note">
                    Manual sample checks only. Time between samples is not
                    analyzed.
                  </p>
                </>
              )}
              {phase && (
                <div role="status" className="result">
                  <p>{phase}</p>
                  {phase.startsWith("Recording") ||
                  phase.startsWith("Capturing") ? (
                    <p>{elapsed} seconds</p>
                  ) : (
                    <>
                      <p>Speaker comparison: pending</p>
                      <p>Synthetic speech: pending</p>
                    </>
                  )}
                  <button className="secondary mt-3" onClick={cancel}>
                    Cancel capture / request
                  </button>
                </div>
              )}
              {!phase && analysisError && (
                <div role="alert" className="error">
                  <p>{analysisError}</p>
                  <p>
                    Speaker comparison: unavailable.
                    <br />
                    Synthetic speech: unavailable.
                  </p>
                </div>
              )}
              {!phase && !analysisError && results.length === 0 && (
                <p className="note">
                  Speaker comparison: no result yet.
                  <br />
                  Synthetic speech: no result yet.
                </p>
              )}
            </section>
          </div>
          {role === "interviewer" && (
            <section className="panel space-y-4">
              <h2>Actual sample results</h2>
              <p className="note">
                Only a speaker match plus a real-speech verdict passes both
                checks. A technical failure never counts as a pass. Earlier
                results remain visible.
              </p>
              {results.map((result) => (
                <article
                  key={result.id}
                  className="result space-y-2"
                  data-outcome={result.outcome}
                >
                  <h3>
                    {result.outcome === "passed"
                      ? "Both checks passed for this sample"
                      : result.outcome === "concern"
                        ? "Human review needed"
                        : "Analysis incomplete / uncertain"}
                  </h3>
                  <p className="note">
                    {new Date(result.captureStart).toLocaleTimeString()} –{" "}
                    {new Date(result.captureEnd).toLocaleTimeString()}
                  </p>
                  <p>
                    <strong>Speaker comparison:</strong>{" "}
                    {speakerText[result.speaker]}
                  </p>
                  <p>
                    <strong>Synthetic speech:</strong>{" "}
                    {deepfakeText[result.deepfake]}
                  </p>
                  {result.partialFailure && (
                    <p>
                      One or more checks are unavailable. {result.speakerError}{" "}
                      {result.deepfakeError}
                    </p>
                  )}
                  <details className="note">
                    <summary>Provider operation details</summary>
                    <p>
                      Speaker operation: {result.operationId || "Not returned"}
                      <br />
                      Deepfake operation:{" "}
                      {result.deepfakeOperationId || "Not returned"}
                      <br />
                      Provider HTTP status: {result.providerStatus}
                    </p>
                  </details>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      <footer className="note">
        Prototype for consented testing. Voice comparison is not proof of
        identity; synthetic-speech classification is not proof of misconduct.
      </footer>
    </main>
  );
}
