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
let database: DatabaseSync;
export function db() {
  if (database) return database;
  const path = process.env.DATABASE_PATH || ".data/signalshift.sqlite";
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, interviewer TEXT, candidate TEXT, expires INTEGER, consent INTEGER, notice TEXT, ended INTEGER DEFAULT 0, speaker TEXT, enrolled INTEGER DEFAULT 0, busy INTEGER DEFAULT 0, cleanup TEXT);
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, session TEXT, kind TEXT, digest TEXT, result TEXT);
    CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, count INTEGER, expires INTEGER);`);
  return database;
}
export const hash = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
export function createSession() {
  const id = randomUUID(),
    interviewer = randomBytes(32).toString("base64url"),
    candidate = randomBytes(32).toString("base64url");
  db()
    .prepare(
      "INSERT INTO sessions (id,interviewer,candidate,expires) VALUES (?,?,?,?)",
    )
    .run(
      id,
      hash(interviewer),
      hash(candidate),
      Date.now() + 2 * 60 * 60 * 1000,
    );
  return { id, interviewer, candidate };
}
export function getSession(id: string): Session | undefined {
  return db()
    .prepare("SELECT * FROM sessions WHERE id=?")
    .get(id) as unknown as Session | undefined;
}
export function authenticate(id: string, token: string, role: Role) {
  const s = getSession(id);
  return s && s.expires > Date.now() && s[role] === hash(token) ? s : undefined;
}
export function rateLimit(bucket: string, maximum: number, seconds: number) {
  const now = Date.now();
  db().prepare("DELETE FROM limits WHERE expires < ?").run(now);
  const row = db()
    .prepare(
      `INSERT INTO limits (bucket,count,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`,
    )
    .get(bucket, now + seconds * 1000) as { count: number };
  return row.count <= maximum;
}
export function claim(s: Session) {
  return (
    db()
      .prepare(
        "UPDATE sessions SET busy=? WHERE id=? AND busy<? AND ended=0 AND consent=?",
      )
      .run(Date.now() + 120_000, s.id, Date.now(), s.consent).changes === 1
  );
}
export function active(s: Session) {
  const current = getSession(s.id);
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
  };
}
