"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { recommendVerification, type AnalysisResult } from "@/lib/results";
type Role = "interviewer" | "candidate";
type Session = {
  id: string;
  consent: boolean;
  enrolled: boolean;
  ended: boolean;
  cleanup: string | null;
  expires: number;
  serverTime: number;
  started?: number;
  endedAt?: number | null;
};
type Question = { id: string; position: number; text: string; created: number };
type InterviewState = {
  current_question: string | null;
  capture_status:
    "waiting" | "recording" | "processing" | "completed" | "failed";
  capture_started: number | null;
  recheck_question: string | null;
  recheck_operation: string | null;
  recheck_requested: number | null;
};
type Review = {
  id: string;
  question: string;
  operation: string;
  decision: string;
  notes: string;
  created: number;
};
type Result = AnalysisResult & {
  id: string;
  captureStart: number;
  captureEnd: number;
  question: string;
  receivedAt: number;
  providerStatus: number | null;
  questionId?: string;
  attemptNumber?: number;
  recheckOf?: string | null;
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
type MeetingIconName =
  | "microphone"
  | "microphoneOff"
  | "camera"
  | "cameraOff"
  | "settings"
  | "phone";
function MeetingIcon({ name }: { name: MeetingIconName }) {
  const paths: Record<MeetingIconName, ReactNode> = {
    microphone: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
      </>
    ),
    microphoneOff: (
      <>
        <path d="M9 8v3a3 3 0 0 0 4.7 2.5M15 10V6a3 3 0 0 0-5.5-1.6M5.5 11.5a6.5 6.5 0 0 0 10.7 5M18.5 11.5a6.5 6.5 0 0 1-.8 3.1M12 18v3M9 21h6M3 3l18 18" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3z" />
      </>
    ),
    cameraOff: (
      <>
        <path d="M10.5 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h11V11M16 10l5-3v10l-3-1.8M3 3l18 18" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    phone: (
      <path
        d="M3.5 13.7c5.1-4.2 11.9-4.2 17 0l-2.4 3.2-3.5-1.7v-2.3a8.8 8.8 0 0 0-5.2 0v2.3l-3.5 1.7-2.4-3.2Z"
        fill="currentColor"
        stroke="none"
      />
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
function Video({
  participant,
  label,
}: {
  participant?: Participant;
  label: string;
}) {
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
    <div className={`tile ${track && !muted ? "has-video" : "is-waiting"}`}>
      {track && !muted ? (
        <video ref={ref} autoPlay playsInline muted />
      ) : (
        <div className="camera-placeholder">
          <MeetingIcon name="cameraOff" />
          <p>Camera off / waiting</p>
        </div>
      )}
      <span title={participant?.identity}>{label}</span>
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
function RecommendedAction({ result }: { result: Result }) {
  const recommendation = recommendVerification(result);
  return (
    <aside
      className={`recommended-action recommendation-${recommendation.tone}`}
      aria-label="Recommended action"
    >
      <div className="recommendation-heading">
        <div>
          <p className="section-kicker">RECOMMENDED ACTION</p>
          <h4>{recommendation.action}</h4>
        </div>
        <span>Reviewer guidance</span>
      </div>
      <p>{recommendation.explanation}</p>
      <p className="recommendation-basis">
        Based on provider verdicts: {speakerText[result.speaker]} ·{" "}
        {deepfakeText[result.deepfake]}
      </p>
      <small>
        Workflow recommendation only. The human reviewer retains the final
        decision.
      </small>
    </aside>
  );
}
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
  const [questions, setQuestions] = useState<Question[]>([]);
  const [interviewState, setInterviewState] = useState<InterviewState | null>(
    null,
  );
  const [reviews, setReviews] = useState<Review[]>([]);
  const [analysisError, setAnalysisError] = useState("");
  const [question, setQuestion] = useState(
    "Tell me about a recent project you worked on.",
  );
  const [captureLimit, setCaptureLimit] = useState(30);
  const [reviewBusy, setReviewBusy] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const roomRef = useRef<Room | null>(null),
    operation = useRef<AbortController | null>(null),
    finishCapture = useRef<AbortController | null>(null),
    sessionRef = useRef<Session | null>(null),
    selectedQuestionRef = useRef<string | null>(null),
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
        const workspace = await api("workspace", { id, role });
        const s = workspace.session as Session;
        if (stopped) return;
        clockOffset.current = s.serverTime - Date.now();
        setSession(s);
        setQuestions(workspace.questions);
        setInterviewState(workspace.state);
        if (role === "interviewer") {
          setResults(workspace.history);
          setReviews(workspace.reviews);
        }
        const selected = (workspace.questions as Question[]).find(
          (item) => item.id === workspace.state.current_question,
        );
        if (selected && selectedQuestionRef.current !== selected.id) {
          selectedQuestionRef.current = selected.id;
          setQuestion(selected.text);
        }
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
    const questionId = interviewState?.current_question;
    await run(async () => {
      setAnalysisError("");
      if (kind === "analyze" && !answerQuestion)
        throw new Error(
          "Add the interview question before capturing an answer.",
        );
      if (kind === "analyze" && !questionId)
        throw new Error(
          "Select an interview question before capturing an answer.",
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
      if (kind === "analyze")
        await api("capture/status", {
          id,
          role,
          questionId,
          status: "recording",
        });
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
        if (kind === "analyze")
          await api("capture/status", {
            id,
            role,
            questionId,
            status: "processing",
          });
        const form = new FormData();
        form.set("id", id);
        form.set("role", role);
        form.set("file", clip.file, "sample.wav");
        form.set("operationId", crypto.randomUUID());
        form.set("captureStart", String(capturedInterval.start));
        form.set("captureEnd", String(capturedInterval.end));
        if (kind === "analyze") {
          form.set("question", answerQuestion);
          form.set("questionId", questionId!);
          if (interviewState?.recheck_operation)
            form.set("recheckOf", interviewState.recheck_operation);
        }
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
        if (kind === "analyze" && questionId && !sessionRef.current?.ended)
          void api("capture/status", {
            id,
            role,
            questionId,
            status: "failed",
          }).catch(() => undefined);
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
              questionId,
              recheckOf: interviewState?.recheck_operation,
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
  async function refreshWorkspace() {
    const workspace = await api("workspace", { id, role });
    setSession(workspace.session);
    setQuestions(workspace.questions);
    setInterviewState(workspace.state);
    if (role === "interviewer") {
      setResults(workspace.history);
      setReviews(workspace.reviews);
    }
  }
  async function addQuestion() {
    const created = await api("question/add", {
      id,
      role,
      text: "New interview question",
    });
    await api("question/select", { id, role, questionId: created.id });
    setQuestion(created.text);
    await refreshWorkspace();
  }
  async function saveQuestion() {
    if (!interviewState?.current_question) return;
    await api("question/edit", {
      id,
      role,
      questionId: interviewState.current_question,
      text: question.trim(),
    });
    await refreshWorkspace();
  }
  async function selectQuestion(item: Question) {
    await api("question/select", { id, role, questionId: item.id });
    selectedQuestionRef.current = item.id;
    setQuestion(item.text);
    await refreshWorkspace();
  }
  async function requestRecheck(result: Result) {
    setReviewBusy(result.id);
    try {
      await api("recheck", {
        id,
        role,
        operationId: result.id,
      });
      await refreshWorkspace();
      document.getElementById("answer-capture")?.scrollIntoView();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not request a fair recheck.",
      );
    } finally {
      setReviewBusy("");
    }
  }
  async function saveReview(result: Result, decision: string) {
    if (!result.questionId) return;
    setReviewBusy(result.id);
    try {
      await api("review", {
        id,
        role,
        operationId: result.id,
        questionId: result.questionId,
        decision,
        notes: reviewNotes[result.id] || "",
      });
      await refreshWorkspace();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save the review decision.",
      );
    } finally {
      setReviewBusy("");
    }
  }
  function repeatQuestion(result: Result) {
    const item = questions.find(
      (candidate) => candidate.id === result.questionId,
    );
    if (item) void run(() => selectQuestion(item));
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
  const currentQuestion = questions.find(
    (item) => item.id === interviewState?.current_question,
  );
  const reviewRequired = results.filter((item) => item.outcome !== "passed");
  const answeredQuestionIds = new Set(results.map((item) => item.questionId));
  const latestReview = (operation: string) =>
    [...reviews].reverse().find((item) => item.operation === operation);
  const interviewStarted = session?.started || questions[0]?.created;
  const interviewFinished = session?.endedAt || Date.now();
  const interviewMinutes = interviewStarted
    ? Math.max(1, Math.round((interviewFinished - interviewStarted) / 60_000))
    : null;
  const outstandingConcerns = reviewRequired.filter(
    (item) => latestReview(item.id)?.decision !== "concern_resolved",
  ).length;
  return (
    <main
      className={`app-shell mx-auto max-w-6xl space-y-6 px-5 py-10 ${!id ? "landing-shell" : role === "interviewer" ? "interviewer-shell interviewer-session-shell" : "candidate-session-shell"}`}
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
            <h1 className="brand-title">
              Secure <span>·</span> Fair <span>·</span> Trusted{" "}
              <em>Interviews</em>
            </h1>
            <p className="brand-description">
              Voice continuity and synthetic-speech checks for a consented
              interview.
            </p>
            <a className="hero-cta" href="#start-session">
              Get started <span aria-hidden="true">→</span>
            </a>
          </div>
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
          {role === "interviewer" && (
            <aside
              className="dashboard-sidebar"
              aria-label="Interview workspace"
            >
              <nav>
                <a className="is-active" href="#interview-room">
                  <span aria-hidden="true">⌂</span> Interviewer
                </a>
                <a href="/">
                  <span aria-hidden="true">＋</span> New interview
                </a>
                <a href="/test-audio">
                  <span aria-hidden="true">≋</span> Test audio
                </a>
                <a href="#verification-results">
                  <span aria-hidden="true">◷</span> Results
                </a>
                <a href="#interview-report">
                  <span aria-hidden="true">▤</span> Report
                </a>
              </nav>
              <div className="sidebar-profile">
                <span>S</span>
                <div>
                  <strong>Interviewer</strong>
                  <small>Session owner</small>
                </div>
              </div>
            </aside>
          )}
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
          {role === "candidate" && !session?.ended && (
            <ol className="candidate-progress" aria-label="Interview progress">
              <li className={session?.consent ? "is-complete" : "is-current"}>
                <span>{session?.consent ? "✓" : "1"}</span> Consent
              </li>
              <li
                className={
                  session?.enrolled
                    ? "is-complete"
                    : session?.consent
                      ? "is-current"
                      : ""
                }
              >
                <span>{session?.enrolled ? "✓" : "2"}</span> Voice enrollment
              </li>
              <li className={session?.enrolled ? "is-current" : ""}>
                <span>3</span> Join interview
              </li>
            </ol>
          )}
          {role === "candidate" && !session?.consent && !session?.ended && (
            <div className="candidate-consent-layout">
              <section className="panel candidate-consent space-y-4">
                <div className="consent-heading">
                  <span aria-hidden="true">▤</span>
                  <div>
                    <p className="section-kicker">CONSENT &amp; PRIVACY</p>
                    <h2>Before you join</h2>
                  </div>
                </div>
                <p>
                  Short audio samples will be recorded and analyzed for
                  interview integrity and voice verification. This includes a
                  25-second voice sample and answer clips selected by your
                  interviewer. Your camera is used for the call but is not
                  analyzed.
                </p>
                <div className="consent-assurances">
                  <p>
                    <span aria-hidden="true">▣</span>Your data is used only for
                    this interview.
                  </p>
                  <p>
                    <span aria-hidden="true">●</span>Results are reviewed by the
                    interviewer.
                  </p>
                  <p>
                    <span aria-hidden="true">↗</span>You can withdraw at any
                    time.
                  </p>
                </div>
                <details className="consent-details">
                  <summary>Data retention and withdrawal details</summary>
                  <p>
                    The app does not retain audio recordings. The service
                    provider creates a derived voice profile for comparison and
                    deletion is requested when the interview ends. Metadata is
                    retained, and audio already sent cannot be recalled.
                  </p>
                </details>
                <label className="block consent-checkbox">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  I consent to recording and analyzing short audio samples for
                  this interview.
                </label>
                <div className="consent-actions">
                  <button disabled={busy || !accepted} onClick={connect}>
                    Agree and join call <span aria-hidden="true">→</span>
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => stop("withdraw")}
                  >
                    Decline and leave
                  </button>
                </div>
              </section>
              <aside
                className="panel candidate-guide"
                aria-label="What happens next"
              >
                <p className="section-kicker">YOUR INTERVIEW</p>
                <h2>What happens next?</h2>
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Voice enrollment</strong>
                      <p>Record a 25-second sample to create a reference.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Join the interview</strong>
                      <p>
                        Connect to the room with your camera and microphone.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Answer questions</strong>
                      <p>
                        Your interviewer captures short audio segments for
                        verification.
                      </p>
                    </div>
                  </li>
                </ol>
              </aside>
            </div>
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
          {role === "interviewer" && (
            <section
              className="panel interview-overview"
              aria-label="Interview overview"
            >
              <div className="overview-heading">
                <div>
                  <p className="section-kicker">INTERVIEW OVERVIEW</p>
                  <h2>
                    {session?.ended
                      ? "Interview ended"
                      : "Interview in progress"}
                  </h2>
                </div>
                <span className="outcome-tag">Session {id.slice(0, 8)}</span>
              </div>
              <div className="overview-grid">
                <p>
                  <span>Candidate</span>
                  <strong>candidate</strong>
                </p>
                <p>
                  <span>Consent</span>
                  <strong>{session?.consent ? "Granted" : "Awaiting"}</strong>
                </p>
                <p>
                  <span>Voice enrollment</span>
                  <strong>{session?.enrolled ? "Complete" : "Pending"}</strong>
                </p>
                <p>
                  <span>Questions completed</span>
                  <strong>
                    {answeredQuestionIds.size} / {questions.length}
                  </strong>
                </p>
                <p>
                  <span>Verified answers</span>
                  <strong>
                    {results.filter((item) => item.outcome === "passed").length}
                  </strong>
                </p>
                <p>
                  <span>Requires review</span>
                  <strong>{reviewRequired.length}</strong>
                </p>
              </div>
            </section>
          )}
          <div
            className={`workspace-grid grid gap-6 lg:grid-cols-[1.5fr_1fr] interview-workspace ${role === "candidate" && !session?.consent ? "consent-pending-workspace" : ""}`}
          >
            <section
              className="panel call-panel space-y-4 candidate-call-panel"
              id="interview-room"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h2>Interview room</h2>
                <span
                  className={`connection-badge ${connected ? "is-connected" : ""}`}
                >
                  <i />
                  {connection}
                </span>
              </div>
              <div className="meeting-video-grid">
                <Video participant={room?.localParticipant} label="You" />
                <Video
                  participant={remote}
                  label={role === "candidate" ? "Interviewer" : "Candidate"}
                />
              </div>
              {remote &&
                [...remote.audioTrackPublications.values()]
                  .filter((p) => p.track)
                  .map((p) => (
                    <RemoteAudio key={p.trackSid} track={p.track!} />
                  ))}
              <div
                className={`candidate-controls meeting-controls ${connected ? "is-connected" : "is-disconnected"}`}
              >
                {!connected && !session?.ended && (
                  <button
                    className="meeting-join"
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
                      className={`secondary meeting-control ${room?.localParticipant.isMicrophoneEnabled ? "" : "is-off"}`}
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
                      <span className="control-icon">
                        <MeetingIcon
                          name={
                            room?.localParticipant.isMicrophoneEnabled
                              ? "microphone"
                              : "microphoneOff"
                          }
                        />
                      </span>
                      <span>
                        {room?.localParticipant.isMicrophoneEnabled
                          ? "Mute"
                          : "Unmute"}
                      </span>
                    </button>
                    <button
                      className={`secondary meeting-control ${room?.localParticipant.isCameraEnabled ? "" : "is-off"}`}
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
                      <span className="control-icon">
                        <MeetingIcon
                          name={
                            room?.localParticipant.isCameraEnabled
                              ? "camera"
                              : "cameraOff"
                          }
                        />
                      </span>
                      <span>
                        {room?.localParticipant.isCameraEnabled
                          ? "Turn camera off"
                          : "Turn camera on"}
                      </span>
                    </button>
                    <button
                      className="secondary meeting-control"
                      onClick={() =>
                        room!
                          .startAudio()
                          .catch(() =>
                            setError("Audio playback blocked by browser."),
                          )
                      }
                    >
                      <span className="control-icon">
                        <MeetingIcon name="settings" />
                      </span>
                      <span>Audio setup</span>
                    </button>
                  </>
                )}
                <button
                  className="danger meeting-control meeting-leave"
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
                  <span className="control-icon">
                    <MeetingIcon name="phone" />
                  </span>
                  <span>
                    {session?.ended
                      ? role === "candidate"
                        ? "Retry leaving"
                        : "Retry cleanup"
                      : role === "candidate"
                        ? session?.consent
                          ? "Withdraw & leave"
                          : "Decline & leave"
                        : "End interview"}
                  </span>
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
              {role === "candidate" && currentQuestion && (
                <div className="candidate-interview-info">
                  <span className="candidate-prompt-tag">
                    Question {currentQuestion.position} of {questions.length}
                  </span>
                  <h3>“{currentQuestion.text}”</h3>
                  {interviewState?.recheck_question === currentQuestion.id && (
                    <div className="recheck-notice" role="status">
                      <strong>Additional voice verification requested.</strong>
                      <p>
                        You can take a moment to prepare. Your interviewer will
                        start another recording for this question.
                      </p>
                    </div>
                  )}
                  <p className="capture-status">
                    Status:{" "}
                    <strong>
                      {interviewState?.capture_status === "recording"
                        ? "Your answer is being recorded for verification"
                        : interviewState?.capture_status === "processing"
                          ? "Your answer is being verified"
                          : interviewState?.capture_status === "completed"
                            ? "Verification completed"
                            : interviewState?.capture_status === "failed"
                              ? "The recording could not be verified. Please try again"
                              : "Waiting for interviewer"}
                    </strong>
                  </p>
                  {interviewState?.capture_status === "recording" && (
                    <p className="recording-indicator">
                      <i /> Recording in progress
                    </p>
                  )}
                </div>
              )}
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
                    <div className="enrollment-status">
                      <p>
                        Microphone permission:{" "}
                        <strong>
                          {connected &&
                          candidateMic?.track &&
                          !candidateMic.isMuted
                            ? "Ready"
                            : connected
                              ? "Unavailable or muted"
                              : "Checked when you join"}
                        </strong>
                      </p>
                      <p>
                        Enrollment status:{" "}
                        <strong>
                          {session.enrolled
                            ? "Voice Enrollment Successful"
                            : phase.startsWith("Recording")
                              ? "Recording Voice Reference"
                              : phase
                                ? "Processing Voice Reference"
                                : "Waiting for Enrollment"}
                        </strong>
                      </p>
                      {(phase.startsWith("Recording") || session.enrolled) && (
                        <progress
                          max={25}
                          value={session.enrolled ? 25 : elapsed}
                          aria-label="Voice enrollment progress"
                        />
                      )}
                    </div>
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
                    <div className="question-manager">
                      <div className="question-manager-heading">
                        <strong>Interview questions</strong>
                        <button
                          className="secondary compact-button"
                          disabled={busy}
                          onClick={() => run(addQuestion)}
                        >
                          Add question
                        </button>
                      </div>
                      <div
                        className="question-tabs"
                        role="list"
                        aria-label="Interview questions"
                      >
                        {questions.map((item) => {
                          const questionResults = results.filter(
                            (result) => result.questionId === item.id,
                          );
                          const status = questionResults.some(
                            (result) => result.outcome !== "passed",
                          )
                            ? "Review required"
                            : questionResults.some(
                                  (result) => result.outcome === "passed",
                                )
                              ? "Verified"
                              : "Pending";
                          return (
                            <button
                              type="button"
                              role="listitem"
                              className={`question-tab ${item.id === interviewState?.current_question ? "is-current" : ""}`}
                              key={item.id}
                              disabled={busy}
                              onClick={() => run(() => selectQuestion(item))}
                            >
                              <span>Question {item.position}</span>
                              <small>{status}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
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
                    <div className="question-edit-actions">
                      <button
                        className="secondary"
                        disabled={busy || !question.trim()}
                        onClick={() => run(saveQuestion)}
                      >
                        Save question
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          !currentQuestion ||
                          currentQuestion.position >= questions.length
                        }
                        onClick={() => {
                          const next = questions.find(
                            (item) =>
                              item.position ===
                              (currentQuestion?.position || 0) + 1,
                          );
                          if (next) void run(() => selectQuestion(next));
                        }}
                      >
                        Next question
                      </button>
                    </div>
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
            <section
              className="panel results-panel space-y-4"
              id="verification-results"
            >
              <div className="results-title-row">
                <div>
                  <p className="section-kicker">VERIFICATION DASHBOARD</p>
                  <h2>Question-level results</h2>
                </div>
                <button className="secondary" onClick={() => window.print()}>
                  Download report
                </button>
              </div>
              <p className="note">
                Only a speaker match plus a real-speech verdict passes both
                checks. A technical failure never counts as a pass. Earlier
                results remain visible.
              </p>
              {reviewRequired.length > 0 && (
                <div className="requires-review">
                  <h3>Requires Review</h3>
                  {reviewRequired.map((result) => (
                    <div className="review-summary" key={`review-${result.id}`}>
                      <div>
                        <strong>
                          Question{" "}
                          {questions.find(
                            (item) => item.id === result.questionId,
                          )?.position || "—"}
                        </strong>
                        <p>{result.question}</p>
                        <small>
                          {result.outcome === "concern"
                            ? "Provider signal requires human review"
                            : "Verification was inconclusive or incomplete"}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy || !!interviewState?.recheck_operation}
                        onClick={() => requestRecheck(result)}
                      >
                        Request Recheck
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {results.map((result) => (
                <article
                  key={result.id}
                  className="result space-y-2"
                  data-outcome={result.outcome}
                >
                  <div className="history-heading">
                    <h3>
                      Question{" "}
                      {questions.find((item) => item.id === result.questionId)
                        ?.position || "—"}{" "}
                      · Attempt {result.attemptNumber || 1}
                      <span className="result-heading-detail">
                        {" "}
                        —{" "}
                        {result.outcome === "passed"
                          ? "Both checks passed for this sample"
                          : result.outcome === "concern"
                            ? "Review required · concern detected"
                            : "Verification incomplete / uncertain"}
                      </span>
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
                  <RecommendedAction result={result} />
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
                  <details className="evidence-details">
                    <summary>View Evidence</summary>
                    <div className="technical-checks">
                      <div
                        className={`technical-check ${result.speaker === "no_match" ? "check-concern" : result.speaker === "unavailable" ? "check-incomplete" : ""}`}
                      >
                        <strong>Speaker verification</strong>
                        <span>{speakerText[result.speaker]}</span>
                        {result.speakerSimilarity !== null &&
                          result.speakerSimilarity !== undefined && (
                            <span className="score-line">
                              Similarity: {result.speakerSimilarity.toFixed(4)}{" "}
                              · threshold:{" "}
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
                            Error{" "}
                            {result.speakerErrorCode || result.speakerError}:{" "}
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
                              {segment.start.toFixed(2)}–
                              {segment.end.toFixed(2)} sec ·
                              synthetic-likelihood score{" "}
                              {segment.score.toFixed(4)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {result.partialFailure && (
                      <p className="incomplete-note">
                        At least one check is incomplete. Do not treat this
                        answer as a pass.
                      </p>
                    )}
                    <details className="note">
                      <summary>Provider request details</summary>
                      <p>
                        Speaker operation:{" "}
                        {result.operationId || "Not returned"}
                        <br />
                        Deepfake operation:{" "}
                        {result.deepfakeOperationId || "Not returned"}
                        <br />
                        Provider HTTP status:{" "}
                        {result.providerStatus ??
                          "Not submitted after preflight"}
                        <br />
                        Request ID: {result.requestId || "Not returned"}
                        <br />
                        Processed:{" "}
                        {new Date(result.receivedAt).toLocaleString()}
                      </p>
                    </details>
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
                        disabled={busy || !!interviewState?.recheck_operation}
                        onClick={() => requestRecheck(result)}
                      >
                        Request Recheck
                      </button>
                    )}
                  </div>
                  <div className="human-review-panel">
                    <strong>Human reviewer decision</strong>
                    {latestReview(result.id) && (
                      <p className="review-recorded">
                        Latest:{" "}
                        {latestReview(result.id)!.decision.replaceAll("_", " ")}{" "}
                        ·{" "}
                        {new Date(
                          latestReview(result.id)!.created,
                        ).toLocaleString()}
                        {latestReview(result.id)!.notes && (
                          <> — {latestReview(result.id)!.notes}</>
                        )}
                      </p>
                    )}
                    <textarea
                      aria-label={`Reviewer notes for ${result.question}`}
                      value={reviewNotes[result.id] || ""}
                      onChange={(event) =>
                        setReviewNotes((current) => ({
                          ...current,
                          [result.id]: event.target.value,
                        }))
                      }
                      placeholder="Optional reviewer notes"
                      maxLength={1000}
                    />
                    <div className="review-buttons">
                      <button
                        className="secondary"
                        disabled={reviewBusy === result.id}
                        onClick={() => saveReview(result, "concern_resolved")}
                      >
                        Mark Resolved
                      </button>
                      <button
                        className="secondary"
                        disabled={reviewBusy === result.id}
                        onClick={() =>
                          saveReview(result, "further_verification_required")
                        }
                      >
                        Further Verification
                      </button>
                      <button
                        className="secondary"
                        disabled={reviewBusy === result.id}
                        onClick={() =>
                          saveReview(result, "escalated_manual_review")
                        }
                      >
                        Escalate for Manual Review
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              <section
                className="interview-report"
                aria-label="Interview report"
                id="interview-report"
              >
                <div className="results-title-row">
                  <div>
                    <p className="section-kicker">INTERVIEW REPORT</p>
                    <h2>Integrity review summary</h2>
                  </div>
                  <span className="outcome-tag">
                    {session?.ended ? "Ended" : "In progress"}
                  </span>
                </div>
                <div className="report-summary">
                  <p>
                    <strong>Session:</strong> {id}
                  </p>
                  <p>
                    <strong>Candidate:</strong> candidate
                  </p>
                  <p>
                    <strong>Interview date:</strong>{" "}
                    {questions[0]
                      ? new Date(questions[0].created).toLocaleString()
                      : "Unavailable"}
                  </p>
                  <p>
                    <strong>Interview duration:</strong>{" "}
                    {interviewMinutes
                      ? `${interviewMinutes} minute${interviewMinutes === 1 ? "" : "s"}`
                      : "Unavailable"}
                  </p>
                  <p>
                    <strong>Total questions:</strong> {questions.length}
                  </p>
                  <p>
                    <strong>Verified answers:</strong>{" "}
                    {results.filter((item) => item.outcome === "passed").length}
                  </p>
                  <p>
                    <strong>Requires review:</strong> {reviewRequired.length}
                  </p>
                  <p>
                    <strong>Inconclusive:</strong>{" "}
                    {
                      results.filter((item) => item.outcome === "incomplete")
                        .length
                    }
                  </p>
                  <p>
                    <strong>Rechecks performed:</strong>{" "}
                    {results.filter((item) => item.recheckOf).length}
                  </p>
                </div>
                <div className="report-questions">
                  {questions.map((item) => {
                    const attempts = results.filter(
                      (result) => result.questionId === item.id,
                    );
                    return (
                      <article key={`report-${item.id}`}>
                        <strong>
                          Question {item.position}: {item.text}
                        </strong>
                        <p>
                          {attempts.length
                            ? attempts
                                .map(
                                  (attempt) =>
                                    `Attempt ${attempt.attemptNumber || 1}: ${speakerText[attempt.speaker]}; ${deepfakeText[attempt.deepfake]}; ${attempt.outcome}`,
                                )
                                .join(" | ")
                            : "No answer verified."}
                        </p>
                        <p>
                          Human review:{" "}
                          {attempts
                            .map((attempt) =>
                              latestReview(attempt.id)?.decision.replaceAll(
                                "_",
                                " ",
                              ),
                            )
                            .filter(Boolean)
                            .join(", ") || "Pending review"}
                        </p>
                      </article>
                    );
                  })}
                </div>
                <div className="report-final-review">
                  <h3>Final review</h3>
                  <p>
                    <strong>Overall status:</strong>{" "}
                    {outstandingConcerns
                      ? "Human review required"
                      : results.length
                        ? "No outstanding concerns recorded"
                        : "Pending verification"}
                  </p>
                  <p>
                    <strong>Outstanding concerns:</strong> {outstandingConcerns}
                  </p>
                  <p>
                    <strong>Reviewer notes:</strong>{" "}
                    {reviews
                      .map((item) => item.notes)
                      .filter(Boolean)
                      .join(" | ") || "No reviewer notes recorded."}
                  </p>
                </div>
                <p className="report-disclaimer">
                  AI verification results are supporting signals and do not
                  independently establish candidate identity, dishonesty, or
                  misconduct.
                </p>
              </section>
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
