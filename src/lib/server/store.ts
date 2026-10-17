import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
export type Role = "interviewer" | "candidate";
export interface Session {
  id: string;
  interviewer: string;
  candidate: string;
  expires: number;
  consent: number | null;
  notice: string | null;
  ended: number;
  speaker: string | null;
  enrolled: number;
  busy: number;
  cleanup: string | null;
}
// Remote libSQL is shared by all Vercel instances. Local SQLite remains available for development.
import { createClient, type Client } from "@libsql/client/web";
import { AppError } from "./provider";
type Value = string | number | null;
let database: DatabaseSync | undefined;
let remote: Client | undefined;
let initialized: Promise<void> | undefined;
const schema = `
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, interviewer TEXT, candidate TEXT, expires INTEGER, consent INTEGER, notice TEXT, ended INTEGER DEFAULT 0, speaker TEXT, enrolled INTEGER DEFAULT 0, busy INTEGER DEFAULT 0, cleanup TEXT);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, session TEXT, kind TEXT, digest TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, count INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, session TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS questions_session_position ON questions(session, position);
CREATE TABLE IF NOT EXISTS interview_state (session TEXT PRIMARY KEY, current_question TEXT, capture_status TEXT NOT NULL DEFAULT 'waiting', capture_started INTEGER, recheck_question TEXT, recheck_operation TEXT, recheck_requested INTEGER);
CREATE TABLE IF NOT EXISTS interview_timeline (session TEXT PRIMARY KEY, started INTEGER NOT NULL, ended INTEGER);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, session TEXT NOT NULL, question TEXT NOT NULL, operation TEXT NOT NULL, decision TEXT NOT NULL, notes TEXT NOT NULL, created INTEGER NOT NULL);`;
async function execute(sql: string, args: Value[]) {
  if (process.env.TURSO_DATABASE_URL) {
    if (!process.env.TURSO_AUTH_TOKEN)
      throw new AppError(
        503,
        "Server configuration missing: TURSO_AUTH_TOKEN.",
      );
    remote ??= createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    initialized ??= remote.executeMultiple(schema).catch((error) => {
      initialized = undefined;
      throw error;
    });
    await initialized;
    const result = await remote.execute({ sql, args });
    return { rows: result.rows, changes: result.rowsAffected };
  }
  if (process.env.VERCEL)
    throw new AppError(
      503,
      "Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN on Vercel. Local SQLite is not supported there.",
    );
  if (!database) {
    const path = process.env.DATABASE_PATH || ".data/signalshift.sqlite";
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    database = new DatabaseSync(path);
    database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;" + schema,
    );
  }
  const statement = database.prepare(sql);
  if (/^SELECT|RETURNING/i.test(sql.trim()) || /RETURNING/i.test(sql))
    return { rows: statement.all(...args), changes: 0 };
  const result = statement.run(...args);
  return { rows: [], changes: Number(result.changes) };
}
export function db() {
  return {
    prepare(sql: string) {
      return {
        async run(...args: Value[]) {
          return execute(sql, args);
        },
        async get(...args: Value[]) {
          return (await execute(sql, args)).rows[0];
        },
        async all(...args: Value[]) {
          return (await execute(sql, args)).rows;
        },
      };
    },
  };
}
export const hash = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
export async function createSession() {
  const id = randomUUID(),
    interviewer = randomBytes(32).toString("base64url"),
    candidate = randomBytes(32).toString("base64url");
  await db()
    .prepare(
      "INSERT INTO sessions (id,interviewer,candidate,expires) VALUES (?,?,?,?)",
    )
    .run(
      id,
      hash(interviewer),
      hash(candidate),
      Date.now() + 2 * 60 * 60 * 1000,
    );
  const questionId = randomUUID();
  await db()
    .prepare(
      "INSERT INTO questions (id,session,position,text,created) VALUES (?,?,?,?,?)",
    )
    .run(
      questionId,
      id,
      1,
      "Tell me about a recent project you worked on.",
      Date.now(),
    );
  await db()
    .prepare(
      "INSERT INTO interview_state (session,current_question) VALUES (?,?)",
    )
    .run(id, questionId);
  await db()
    .prepare("INSERT INTO interview_timeline (session,started) VALUES (?,?)")
    .run(id, Date.now());
  return { id, interviewer, candidate };
}
export async function getSession(id: string): Promise<Session | undefined> {
  return (await db()
    .prepare("SELECT * FROM sessions WHERE id=?")
    .get(id)) as unknown as Session | undefined;
}
export async function authenticate(id: string, token: string, role: Role) {
  const s = await getSession(id);
  return s && s.expires > Date.now() && s[role] === hash(token) ? s : undefined;
}
export async function rateLimit(
  bucket: string,
  maximum: number,
  seconds: number,
) {
  const now = Date.now();
  const row = (await db()
    .prepare(
      `INSERT INTO limits (bucket,count,expires) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`,
    )
    .get(bucket, now + seconds * 1000, now, now)) as { count: number };
  return row.count <= maximum;
}
export async function claim(s: Session) {
  const lease = Date.now() + 120_000;
  const result = await db()
    .prepare(
      "UPDATE sessions SET busy=? WHERE id=? AND busy<? AND ended=0 AND consent=? AND expires>? AND enrolled=? AND speaker IS ?",
    )
    .run(lease, s.id, Date.now(), s.consent, Date.now(), s.enrolled, s.speaker);
  if (result.changes === 1) {
    s.busy = lease;
    return true;
  }
  return false;
}
export async function verificationHistory(id: string) {
  const rows = (await db()
    .prepare(
      "SELECT result FROM operations WHERE session=? AND kind='analyze' AND result IS NOT NULL ORDER BY rowid ASC",
    )
    .all(id)) as { result?: string }[];
  return rows.flatMap((row) => {
    try {
      return row.result ? [JSON.parse(row.result)] : [];
    } catch {
      return [];
    }
  });
}
export interface InterviewQuestion {
  id: string;
  position: number;
  text: string;
  created: number;
}
export interface InterviewState {
  current_question: string | null;
  capture_status: string;
  capture_started: number | null;
  recheck_question: string | null;
  recheck_operation: string | null;
  recheck_requested: number | null;
}
export async function ensureInterviewWorkspace(id: string) {
  let questions = await interviewQuestions(id);
  if (!questions.length) {
    const questionId = randomUUID();
    await db()
      .prepare(
        "INSERT INTO questions (id,session,position,text,created) VALUES (?,?,?,?,?)",
      )
      .run(
        questionId,
        id,
        1,
        "Tell me about a recent project you worked on.",
        Date.now(),
      );
    questions = await interviewQuestions(id);
  }
  await db()
    .prepare(
      "INSERT OR IGNORE INTO interview_state (session,current_question) VALUES (?,?)",
    )
    .run(id, questions[0].id);
  await db()
    .prepare(
      "INSERT OR IGNORE INTO interview_timeline (session,started) VALUES (?,?)",
    )
    .run(id, questions[0].created);
}
export async function interviewQuestions(id: string) {
  return (await db()
    .prepare(
      "SELECT id,position,text,created FROM questions WHERE session=? ORDER BY position ASC",
    )
    .all(id)) as unknown as InterviewQuestion[];
}
export async function interviewState(id: string): Promise<InterviewState> {
  const row = (await db()
    .prepare(
      "SELECT current_question,capture_status,capture_started,recheck_question,recheck_operation,recheck_requested FROM interview_state WHERE session=?",
    )
    .get(id)) as unknown as InterviewState | undefined;
  return (
    row || {
      current_question: null,
      capture_status: "waiting",
      capture_started: null,
      recheck_question: null,
      recheck_operation: null,
      recheck_requested: null,
    }
  );
}
export async function reviewHistory(id: string) {
  return db()
    .prepare(
      "SELECT id,question,operation,decision,notes,created FROM reviews WHERE session=? ORDER BY created ASC",
    )
    .all(id);
}
export async function interviewTimeline(id: string) {
  return (await db()
    .prepare("SELECT started,ended FROM interview_timeline WHERE session=?")
    .get(id)) as { started: number; ended: number | null };
}
export async function active(s: Session) {
  const current = await getSession(s.id);
  return (
    !!current &&
    !current.ended &&
    current.expires > Date.now() &&
    !!current.consent &&
    current.consent === s.consent
  );
}
export function publicSession(s: Session) {
  return {
    id: s.id,
    consent: !!s.consent,
    enrolled: !!s.enrolled,
    ended: !!s.ended,
    cleanup: s.cleanup,
    expires: s.expires,
    serverTime: Date.now(),
  };
}
