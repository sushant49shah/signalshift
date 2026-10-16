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
CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, count INTEGER, expires INTEGER);`;
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
