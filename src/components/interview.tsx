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
import { inspectWav } from "@/lib/wav";
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
  question: string;
  receivedAt: number;
  providerStatus: number | null;
  humanReview?: { action: string; at: number };
};
function candidateError(error: unknown) {
  const text = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    /quiet|silent|speech|too short|unclear|insufficient|audio track/.test(text)
  )
    return "We couldn’t hear enough clear speech. Please check your microphone and try again in a quiet place.";
  if (/connect|permission|microphone/.test(text))
    return "We couldn’t connect your microphone. Check your browser permissions and try again.";
  return "We couldn’t complete the voice check. Please let your interviewer know so you can try again.";
}
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
  const [question, setQuestion] = useState(
    "Tell me about a recent project you worked on.",
  );
  const [captureLimit, setCaptureLimit] = useState(30);
  const [reviewBusy, setReviewBusy] = useState("");
  const roomRef = useRef<Room | null>(null),
    operation = useRef<AbortController | null>(null),
    finishCapture = useRef<AbortController | null>(null),
    sessionRef = useRef<Session | null>(null),
    processing = useRef(false);
  const clockOffset = useRef(0);
  sessionRef.current = session;
  function cancel() {
    operation.current?.abort();
    operation.current = null;
    finishCapture.current = null;
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
            setError(candidateError(e));
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
            role === "candidate"
              ? candidateError(e)
              : e instanceof Error
                ? e.message
                : "Session state unavailable.",
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
  useEffect(() => {
    if (!id || !ready || role !== "interviewer") return;
    let stopped = false;
    const refreshHistory = () => {
      api("history", { id, role })
        .then((history: Result[]) => {
          if (!stopped) setResults(history);
        })
        .catch(() => {
          // Keep the last known dashboard history visible during a transient error.
        });
    };
    refreshHistory();
    const timer = setInterval(refreshHistory, 5000);
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
      setError(
        role === "candidate"
          ? candidateError(e)
          : e instanceof Error
            ? e.message
            : "The operation failed.",
      );
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
    const answerQuestion = question.trim();
    await run(async () => {
      setAnalysisError("");
      if (kind === "analyze" && !answerQuestion)
        throw new Error(
          "Add the interview question before capturing an answer.",
        );
      if (
        kind === "analyze" &&
        (!Number.isFinite(captureLimit) ||
          captureLimit < 5 ||
          captureLimit > 30)
      )
        throw new Error("Choose a capture limit from 5 to 30 seconds.");
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
      const stopController =
        kind === "analyze" ? new AbortController() : undefined;
      finishCapture.current = stopController ?? null;
      const seconds = kind === "enroll" ? 25 : captureLimit;
      setElapsed(0);
      setPhase(
        kind === "enroll"
          ? "Recording your voice sample"
          : "Recording candidate answer",
      );
      const timer = setInterval(
        () => setElapsed((v) => Math.min(seconds, v + 1)),
        1000,
      );
      let capturedInterval: { start: number; end: number } | undefined;
      let uploadStarted = false;
      try {
        const clip = await capture(
          publication.track.mediaStreamTrack,
          seconds,
          controller.signal,
          stopController?.signal,
        );
        finishCapture.current = null;
        clearInterval(timer);
        if (
          controller.signal.aborted ||
          !sessionRef.current?.consent ||
          sessionRef.current.ended
        )
          throw new Error("Capture cancelled.");
        capturedInterval = {
          start: clip.start + clockOffset.current,
          end: clip.end + clockOffset.current,
        };
        inspectWav(await clip.file.arrayBuffer(), kind);
        setPhase(
          kind === "enroll"
            ? "Preparing your voice check…"
            : "Uploading the answer for verification…",
        );
        const form = new FormData();
        form.set("id", id);
        form.set("role", role);
        form.set("file", clip.file, "sample.wav");
        form.set("operationId", crypto.randomUUID());
        form.set("captureStart", String(capturedInterval.start));
        form.set("captureEnd", String(capturedInterval.end));
        if (kind === "analyze") form.set("question", answerQuestion);
        uploadStarted = true;
        const result = await api(kind, form, controller.signal);
        if (controller.signal.aborted || sessionRef.current?.ended) return;
        if (kind === "enroll") {
          setSession(await api("status", { id, role }));
          setMessage(
            "Your voice reference is ready. The interviewer can continue.",
          );
        } else setResults((previous) => [...previous, result]);
      } catch (e) {
        if (
          kind === "analyze" &&
          role === "interviewer" &&
          !uploadStarted &&
          capturedInterval &&
          !controller.signal.aborted
        ) {
          try {
            const incomplete = await api("incomplete", {
              id,
              role,
              operationId: crypto.randomUUID(),
              question: answerQuestion,
              captureStart: capturedInterval.start,
              captureEnd: capturedInterval.end,
              reason:
                e instanceof Error
                  ? e.message
                  : "Audio could not be checked before upload.",
            });
            setResults((previous) => [...previous, incomplete]);
          } catch {
            // The original capture error remains visible if history cannot be saved.
          }
        }
        if (kind === "analyze")
          setAnalysisError(
            controller.signal.aborted
              ? role === "candidate"
                ? candidateError(new Error("Audio check interrupted"))
                : "Capture cancelled or interrupted. This sample has no completed result."
              : role === "candidate"
                ? candidateError(e)
                : e instanceof Error
                  ? e.message
                  : "Analysis failed.",
          );
        if (kind === "analyze" && role === "interviewer") {
          api("history", { id, role })
            .then((history: Result[]) => setResults(history))
            .catch(() => undefined);
        }
        throw e;
      } finally {
        clearInterval(timer);
        finishCapture.current = null;
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
    setMessage(
      role === "candidate"
        ? "Ending the interview and stopping new recordings…"
        : "Stopping the session and requesting voice-reference cleanup…",
    );
    try {
      const result = await api(action, { id, role });
      setMessage(
        role === "candidate"
          ? "The interview has ended and no new audio will be recorded. Audio already sent for analysis cannot be recalled."
          : `${result.cleanup} ${result.roomCleanup} Already transmitted audio cannot be recalled.`,
      );
    } catch (e) {
      setError(
        role === "candidate"
          ? "We couldn’t confirm that the interview ended. Please ask your interviewer for help."
          : e instanceof Error
            ? e.message
            : "Cleanup failed.",
      );
      setMessage(
        role === "candidate"
          ? "Your local call has stopped, but the server did not confirm the end of the interview. Please try again or contact your interviewer."
          : "Local capture stopped. Server revocation or cleanup was not confirmed. Retry ending the session.",
      );
    }
  }
  async function markConcernContinued(result: Result) {
    setReviewBusy(result.id);
    try {
      const updated = await api("review", {
        id,
        role,
        operationId: result.id,
      });
      setResults((current) =>
        current.map((item) => (item.id === result.id ? updated : item)),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save the review action.",
      );
    } finally {
      setReviewBusy("");
    }
  }
  function repeatQuestion(result: Result) {
    setQuestion(result.question);
    setAnalysisError("");
    document.getElementById("answer-capture")?.scrollIntoView();
  }
  const connected = room?.state === ConnectionState.Connected;
  const remote = room ? [...room.remoteParticipants.values()][0] : undefined;
  const candidate =
    role === "candidate"
      ? room?.localParticipant
      : room?.remoteParticipants.get("candidate");
  const candidateMic = candidate?.getTrackPublication(Track.Source.Microphone);
  return (
    <main
      className={`app-shell mx-auto max-w-6xl space-y-6 px-5 py-10 ${role === "interviewer" ? "interviewer-shell" : ""}`}
    >
      <nav
        className={`top-nav ${id ? "active-interview-nav" : ""}`}
        aria-label="Main navigation"
      >
        <a className="brand-lockup" href="/" aria-label="SignalShift AI home">
          <span className="signal-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>
              SignalShift <b>AI</b>
            </strong>
            {id && <small>Secure · Fair · Trusted Interviews</small>}
          </span>
        </a>
        {id ? (
          <div className="active-interview-tools">
            {role === "interviewer" && <a href="/test-audio">Test audio</a>}
            <span className="role-badge">{role}</span>
            {role === "interviewer" && <a href="/">New interview</a>}
          </div>
        ) : (
          <div className="nav-links">
            <a className="nav-cta" href="#start-session">
              Get started
            </a>
          </div>
        )}
      </nav>
      {!id && (
        <header
          className={`masthead flex flex-wrap items-start justify-between gap-4 ${role === "candidate" ? "candidate-masthead" : ""}`}
          id="overview"
        >
          <div className="brand-copy">
            <p className="eyebrow">
              {role === "candidate"
                ? "CONSENTED INTERVIEW"
                : "TECHNICAL FOUNDATION · LIVE PROVIDER INTEGRATION"}
            </p>
            <h1 className="brand-title">
              SignalShift <span>AI</span>
            </h1>
            <p className="brand-description">
              {role === "candidate"
                ? "Secure · Fair · Trusted Interviews"
                : "Voice continuity and synthetic-speech checks for a consented interview."}
            </p>
          </div>
          <span className="role-badge">{id ? role : "Two-person room"}</span>
        </header>
      )}
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
        <>
          <div className="landing-grid">
            <section
              className="panel setup-panel max-w-xl space-y-5"
              id="start-session"
            >
              <div className="section-kicker">NEW SESSION</div>
              <h2>Start an interview</h2>
              <p>
                Create a room, invite the candidate, enroll their voice, then
                check one complete audio segment.
              </p>
              <label className="block space-y-2">
                <span className="field-label">
                  Demo access code <span>(if configured)</span>
                </span>
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
                Requires configured LiveKit and DetectifAI accounts. Results
                apply only to the checked sample and do not establish legal
                identity.
              </p>
            </section>
            <section className="panel steps-panel" id="workflow">
              <div className="summary-heading">
                <span className="summary-dot" />
                <h2>Consent-first workflow</h2>
                <span className="summary-label">3 steps</span>
              </div>
              <p className="note">
                A clear sequence for both people in the interview.
              </p>
              <ol className="steps-list">
                <li>
                  <span>01</span>
                  <div>
                    <strong>Create a private room</strong>
                    <p>Invite one candidate using a time-limited link.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Enroll with consent</strong>
                    <p>The candidate records a short voice reference.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Check a sample</strong>
                    <p>The interviewer captures a segment for both checks.</p>
                  </div>
                </li>
              </ol>
              <div className="sample-note">
                <strong>Human review stays in control</strong>
                <p>
                  Results apply only to the checked sample and never establish
                  identity or misconduct.
                </p>
              </div>
            </section>
          </div>
          <section className="feature-row" aria-label="What SignalShift checks">
            <article className="feature-card">
              <span className="feature-icon blue">〰</span>
              <div>
                <h3>Voice continuity</h3>
                <p>Compare a sample with the enrolled reference.</p>
              </div>
            </article>
            <article className="feature-card">
              <span className="feature-icon violet">✦</span>
              <div>
                <h3>Synthetic-speech check</h3>
                <p>Review the provider’s classification for that sample.</p>
              </div>
            </article>
            <article className="feature-card">
              <span className="feature-icon green">✓</span>
              <div>
                <h3>Consent-first</h3>
                <p>Candidate consent is required before audio analysis.</p>
              </div>
            </article>
          </section>
        </>
      ) : role === "candidate" && !ready ? (
        <section className="panel candidate-load-error" role="status">
          <h2>Opening your interview</h2>
          <p>Please wait while we confirm your invitation.</p>
        </section>
      ) : role === "candidate" && !session ? (
        <section className="panel candidate-load-error" role="alert">
          <h2>This interview link isn’t available</h2>
          <p>Please ask your interviewer for a current invitation.</p>
          <a href="/">Return to SignalShift AI</a>
        </section>
      ) : (
        <>
          {invitation && (
            <details className="invite-disclosure">
              <summary>Invite candidate</summary>
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
            </details>
          )}
          {role === "candidate" && !session?.consent && !session?.ended && (
            <section className="panel candidate-consent space-y-4">
              <h2>Before you join</h2>
              <p>
                Short audio samples will be recorded and analyzed for interview
                integrity and voice verification. This includes a 25-second
                voice sample and answer clips selected by your interviewer. Your
                camera is used for the call but is not analyzed.
              </p>
              <p>
                The app does not retain audio recordings. The service provider
                creates and retains a derived voice profile for comparison; the
                app requests its deletion when the interview ends, but deletion
                may not always be confirmed. Interview and verification metadata
                are retained by this app.
              </p>
              <p>
                Results can be wrong and are reviewed by the interviewer. They
                will not automatically reject you. You can withdraw at any time;
                this stops new recording and analysis, but audio already sent
                cannot be recalled. Browser microphone permission is separate
                from your consent.
              </p>
              <label className="block">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                I consent to recording and analyzing short audio samples for
                this interview.
              </label>
            </section>
          )}
          {!session?.ended && (role === "interviewer" || session?.consent) && (
            <section
              className={`candidate-welcome ${role === "interviewer" ? "interviewer-welcome" : ""} ${role === "interviewer" && !session?.consent ? "is-waiting" : ""}`}
              role="status"
            >
              <span className="welcome-check" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>
                  {role === "candidate"
                    ? "Thank you for your consent!"
                    : session?.consent
                      ? "Candidate consent confirmed"
                      : "Waiting for candidate consent"}
                </strong>
                <p>
                  {role === "candidate"
                    ? "We’ll now move to the interview. Please speak naturally and clearly."
                    : session?.consent
                      ? "The candidate can continue with the interview. Their voice sample status is shown in the prompt panel."
                      : "The candidate must review the disclosure and agree before audio recording or analysis begins."}
                </p>
              </div>
            </section>
          )}
          <div className="workspace-grid grid gap-6 lg:grid-cols-[1.5fr_1fr] interview-workspace">
            <section className="panel call-panel space-y-4 candidate-call-panel">
              <div className="flex flex-wrap justify-between gap-2">
                <h2>Interview room</h2>
                <span
                  className={`connection-badge ${connected ? "is-connected" : ""}`}
                >
                  <i />
                  {connection}
                </span>
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
              <div className="flex flex-wrap gap-2 candidate-controls">
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
                  onClick={() => {
                    const action = role === "candidate" ? "withdraw" : "end";
                    const confirmed =
                      session?.ended ||
                      window.confirm(
                        role === "candidate"
                          ? "End this interview and withdraw consent? Any audio already sent cannot be recalled."
                          : "End this interview? This disconnects both people and stops further capture and analysis.",
                      );
                    if (confirmed) stop(action);
                  }}
                >
                  {session?.ended
                    ? role === "candidate"
                      ? "Retry ending interview"
                      : "Retry session cleanup"
                    : role === "candidate"
                      ? session?.consent
                        ? "Withdraw consent and leave"
                        : "Decline and leave"
                      : "End session"}
                </button>
              </div>
              <p className="note">
                {session?.ended
                  ? "Session ended. Capture and new analysis are stopped."
                  : candidateMic?.isMuted
                    ? role === "candidate"
                      ? "Your microphone is muted. Turn it on before recording your voice sample."
                      : "Candidate microphone muted — no analyzable sample."
                    : "Use headphones to reduce acoustic echo. Keep the recording tab active."}
              </p>
            </section>
            <section
              className="panel analysis-panel space-y-4 candidate-question-panel"
              aria-live="polite"
              id="workflow"
            >
              <h2>
                {role === "candidate" ? "Your interview" : "Candidate answer"}
              </h2>
              {session?.ended ? (
                <div className="workflow-notice is-ended" role="status">
                  <strong>This interview has ended.</strong>
                  <p>
                    Audio capture and analysis are stopped for this room. Start
                    a new interview to continue.
                  </p>
                  <a href="/">Start a new interview →</a>
                </div>
              ) : role === "interviewer" && !session?.enrolled ? (
                <div className="workflow-notice" role="status">
                  <strong>Waiting for the candidate’s voice reference</strong>
                  <p>
                    The candidate must stay connected, finish the 25-second
                    recording, and receive confirmation that enrollment was
                    accepted. Then join or reconnect to capture an 8-second
                    sample.
                  </p>
                </div>
              ) : null}
              <div className="session-status-list">
                <p>
                  {role === "candidate" ? "Your consent" : "Candidate consent"}:{" "}
                  <strong>
                    {session?.consent
                      ? "Accepted"
                      : session?.ended
                        ? "Withdrawn / ended"
                        : "Awaiting candidate"}
                  </strong>
                </p>
                <p>
                  {role === "candidate" ? "Voice sample" : "Enrollment status"}:{" "}
                  <strong>
                    {session?.enrolled
                      ? role === "candidate"
                        ? "Ready"
                        : "Enrolled and accepted"
                      : session?.ended
                        ? "Session ended"
                        : role === "interviewer"
                          ? "Waiting for candidate"
                          : "Not complete"}
                  </strong>
                </p>
              </div>
              {role === "candidate" ? (
                session?.consent ? (
                  <>
                    <span className="candidate-prompt-tag">Introduction</span>
                    <p>
                      Please introduce yourself and describe a recent project
                      you’ve worked on. Speak naturally for about 25 seconds so
                      there is at least 10 seconds of clear speech.
                    </p>
                    <ul className="candidate-speaking-tips">
                      <li>
                        <span aria-hidden="true">▤</span> Speak naturally and at
                        a comfortable pace.
                      </li>
                      <li>
                        <span aria-hidden="true">〰</span> Try to speak for
                        about 25 seconds.
                      </li>
                      <li>
                        <span aria-hidden="true">◷</span> Take a moment to think
                        before you start.
                      </li>
                    </ul>
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
                      {session.enrolled ? (
                        "Voice sample received"
                      ) : (
                        <>
                          <span aria-hidden="true">🎙</span> Start recording
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <p className="note">
                    Review the consent information above and choose “Agree and
                    join call” to continue. The recording prompt appears after
                    you join.
                  </p>
                )
              ) : (
                <>
                  <p>
                    Record the candidate’s answer to a specific question. Only
                    the candidate’s remote microphone track is captured.
                  </p>
                  <div className="capture-fields" id="answer-capture">
                    <label className="field-label" htmlFor="question-prompt">
                      Interview question
                    </label>
                    <textarea
                      id="question-prompt"
                      value={question}
                      maxLength={1000}
                      disabled={busy}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="Enter the question asked"
                    />
                    <label className="field-label" htmlFor="capture-limit">
                      Maximum answer recording · seconds
                    </label>
                    <input
                      id="capture-limit"
                      type="number"
                      min={5}
                      max={30}
                      step={1}
                      value={captureLimit}
                      disabled={busy}
                      onChange={(event) =>
                        setCaptureLimit(
                          Math.min(
                            30,
                            Math.max(5, Number(event.target.value) || 5),
                          ),
                        )
                      }
                    />
                    <p className="note">
                      Minimum 5 seconds; the combined checks need more than 4
                      seconds. Clear, uninterrupted speech gives the most useful
                      sample.
                    </p>
                    {phase === "Recording candidate answer" ? (
                      <button
                        className="secondary stop-recording"
                        onClick={() => finishCapture.current?.abort()}
                      >
                        Stop recording &amp; submit answer
                      </button>
                    ) : (
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
                        Start answer capture · up to {captureLimit}s
                      </button>
                    )}
                  </div>
                  {!session?.ended && session?.enrolled && !connected && (
                    <p className="note">
                      Join the call first and make sure the candidate is
                      connected with an enabled microphone.
                    </p>
                  )}
                  {!session?.ended && !session?.enrolled && (
                    <p className="note">
                      Capture is locked until the candidate finishes voice
                      enrollment and the reference is accepted.
                    </p>
                  )}
                  <p className="note">
                    Manual sample checks only. Time between samples is not
                    analyzed.
                  </p>
                </>
              )}
              {phase && (
                <div role="status" className="result">
                  <p>{phase}</p>
                  {phase.startsWith("Recording") ? (
                    <p>{elapsed} seconds</p>
                  ) : role === "candidate" ? (
                    <p>Please wait while we complete your voice check.</p>
                  ) : (
                    <p>
                      Speaker verification and synthetic-speech checks are
                      processing.
                    </p>
                  )}
                  {phase !== "Recording candidate answer" && (
                    <button className="secondary mt-3" onClick={cancel}>
                      {role === "candidate"
                        ? "Cancel"
                        : "Cancel capture / request"}
                    </button>
                  )}
                </div>
              )}
              {!phase && analysisError && (
                <div role="alert" className="error">
                  <p>{analysisError}</p>
                  {role === "interviewer" && (
                    <p>
                      One or both checks may be incomplete. Review the
                      verification history below.
                    </p>
                  )}
                </div>
              )}
              {role === "interviewer" &&
                !phase &&
                !analysisError &&
                results.length === 0 && (
                  <p className="note">
                    Speaker comparison: no result yet.
                    <br />
                    Synthetic speech: no result yet.
                  </p>
                )}
            </section>
          </div>
          {role === "interviewer" && (
            <section className="panel results-panel space-y-4">
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
                  <div className="history-heading">
                    <h3>
                      {result.outcome === "passed"
                        ? "Both checks passed for this sample"
                        : result.outcome === "concern"
                          ? "Review required · concern detected"
                          : "Verification incomplete / uncertain"}
                    </h3>
                    <span className={`outcome-tag outcome-${result.outcome}`}>
                      {result.outcome === "passed"
                        ? "Complete"
                        : result.outcome === "concern"
                          ? "Concern"
                          : "Incomplete"}
                    </span>
                  </div>
                  <p>
                    <strong>Question:</strong>{" "}
                    {result.question || "Question not recorded"}
                  </p>
                  <p className="note">
                    Captured{" "}
                    {new Date(result.captureStart).toLocaleTimeString()} –{" "}
                    {new Date(result.captureEnd).toLocaleTimeString()}
                  </p>
                  {result.speaker === "no_match" && (
                    <p className="concern-flag">
                      Possible speaker substitution flagged for human review.
                    </p>
                  )}
                  {result.deepfake === "fake" && (
                    <p className="concern-flag">
                      Potentially synthetic speech flagged for human review.
                    </p>
                  )}
                  <div className="technical-checks">
                    <div
                      className={`technical-check ${result.speaker === "no_match" ? "check-concern" : result.speaker === "unavailable" ? "check-incomplete" : ""}`}
                    >
                      <strong>Speaker verification</strong>
                      <span>{speakerText[result.speaker]}</span>
                      {result.speakerSimilarity !== null &&
                        result.speakerSimilarity !== undefined && (
                          <span className="score-line">
                            Similarity: {result.speakerSimilarity.toFixed(4)} ·
                            threshold:{" "}
                            {result.speakerThreshold?.toFixed(4) ??
                              "Not returned"}{" "}
                            <small>
                              (higher means more alike; not a percentage)
                            </small>
                          </span>
                        )}
                      {result.speakerDurationSeconds != null && (
                        <span className="score-line">
                          Analyzed audio:{" "}
                          {result.speakerDurationSeconds.toFixed(2)} seconds
                        </span>
                      )}
                      {(result.speakerErrorCode ||
                        result.speakerErrorMessage ||
                        result.speakerError) && (
                        <span className="technical-error">
                          Error {result.speakerErrorCode || result.speakerError}
                          :{" "}
                          {result.speakerErrorMessage ||
                            "Verification unavailable."}
                        </span>
                      )}
                    </div>
                    <div
                      className={`technical-check ${result.deepfake === "fake" ? "check-concern" : result.deepfake === "not_sure" || result.deepfake === "unavailable" ? "check-incomplete" : ""}`}
                    >
                      <strong>Synthetic-speech detection</strong>
                      <span>{deepfakeText[result.deepfake]}</span>
                      {result.deepfakeScore !== null &&
                        result.deepfakeScore !== undefined && (
                          <span className="score-line">
                            Synthetic-likelihood score:{" "}
                            {result.deepfakeScore.toFixed(4)} · threshold:{" "}
                            {result.deepfakeThreshold?.toFixed(4) ??
                              "Not returned"}{" "}
                            <small>
                              (higher means more likely synthetic; decide with
                              verdict)
                            </small>
                          </span>
                        )}
                      {result.deepfakeDurationSeconds != null && (
                        <span className="score-line">
                          Analyzed audio:{" "}
                          {result.deepfakeDurationSeconds.toFixed(2)} seconds
                        </span>
                      )}
                      {result.deepfakeDecidedBy && (
                        <span className="score-line">
                          Decision source: {result.deepfakeDecidedBy}
                        </span>
                      )}
                      {(result.deepfakeErrorCode ||
                        result.deepfakeErrorMessage ||
                        result.deepfakeError) && (
                        <span className="technical-error">
                          Error{" "}
                          {result.deepfakeErrorCode || result.deepfakeError}:{" "}
                          {result.deepfakeErrorMessage ||
                            "Detection unavailable."}
                        </span>
                      )}
                    </div>
                  </div>
                  {result.deepfakeSegments.length > 0 && (
                    <details className="note">
                      <summary>Detection segments</summary>
                      <ul>
                        {result.deepfakeSegments.map((segment, index) => (
                          <li key={`${segment.start}-${index}`}>
                            {segment.start.toFixed(2)}–{segment.end.toFixed(2)}{" "}
                            sec · synthetic-likelihood score{" "}
                            {segment.score.toFixed(4)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {result.partialFailure && (
                    <p className="incomplete-note">
                      At least one check is incomplete. Do not treat this answer
                      as a pass.
                    </p>
                  )}
                  <details className="note">
                    <summary>Provider request details</summary>
                    <p>
                      Speaker operation: {result.operationId || "Not returned"}
                      <br />
                      Deepfake operation:{" "}
                      {result.deepfakeOperationId || "Not returned"}
                      <br />
                      Provider HTTP status:{" "}
                      {result.providerStatus ?? "Not submitted after preflight"}
                      <br />
                      Request ID: {result.requestId || "Not returned"}
                      <br />
                      Processed: {new Date(result.receivedAt).toLocaleString()}
                    </p>
                  </details>
                  <div className="history-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => repeatQuestion(result)}
                    >
                      Repeat this answer
                    </button>
                    {result.outcome !== "passed" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => repeatQuestion(result)}
                      >
                        Request a fresh sample
                      </button>
                    )}
                    {result.outcome !== "passed" &&
                      (result.humanReview?.action ===
                      "continue_with_unresolved_result" ? (
                        <span className="review-recorded">
                          Earlier{" "}
                          {result.outcome === "concern"
                            ? "concern"
                            : "incomplete check"}{" "}
                          remains recorded · continued{" "}
                          {new Date(result.humanReview.at).toLocaleTimeString()}
                        </span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={reviewBusy === result.id}
                          onClick={() => markConcernContinued(result)}
                        >
                          {reviewBusy === result.id
                            ? "Saving review…"
                            : "Continue with unresolved result noted"}
                        </button>
                      ))}
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      <footer className="app-footer note">
        {role === "candidate"
          ? "Voice verification supports a human review and is not proof of identity."
          : "Prototype for consented testing. Voice comparison is not proof of identity; synthetic-speech classification is not proof of misconduct."}
      </footer>
    </main>
  );
}
