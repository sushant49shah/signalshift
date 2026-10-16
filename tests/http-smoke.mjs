// Runs against a local server. No voice upload, provider call, or real consented session.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
try {
  process.loadEnvFile(".env.local");
} catch {}
const origin = process.env.SMOKE_ORIGIN || "http://localhost:3000";
async function post(path, data, cookie = "", requestOrigin = origin) {
  const res = await fetch(origin + "/api/" + path, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(data),
  });
  return {
    status: res.status,
    body: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
assert.equal((await fetch(origin)).status, 200);
assert.equal(
  (await post("sessions", {}, "", "https://untrusted.example")).status,
  403,
);
const created = await post("sessions", {
  accessCode:
    process.env.SMOKE_ACCESS_CODE || process.env.DEMO_ACCESS_CODE || "",
});
assert.equal(created.status, 200);
const { id, invitation } = created.body;
assert.ok(created.cookie);
assert.equal((await post("status", { id, role: "interviewer" })).status, 403);
assert.equal(
  (await post("status", { id, role: "candidate" }, created.cookie)).status,
  403,
);
assert.equal(
  (
    await post(
      "consent",
      { id, role: "interviewer", accepted: true, notice: "2026-10-16-v1" },
      created.cookie,
    )
  ).status,
  403,
);
const joined = await post("join", { id, role: "candidate", invitation });
assert.equal(joined.status, 200);
assert.equal(
  (
    await post(
      "consent",
      { id, role: "candidate", accepted: false, notice: "2026-10-16-v1" },
      joined.cookie,
    )
  ).status,
  403,
);
assert.equal(
  (await post("rooms/token", { id, role: "candidate" }, joined.cookie)).status,
  403,
);
const consent = await post(
  "consent",
  { id, role: "candidate", accepted: true, notice: "2026-10-16-v1" },
  joined.cookie,
);
assert.equal(consent.status, 200);
assert.equal(consent.body.consent, true);
assert.equal(consent.body.enrolled, false);
async function upload(action, role, cookie, extra = false) {
  const form = new FormData();
  form.set("id", id);
  form.set("role", role);
  form.set("operationId", crypto.randomUUID());
  form.set("captureStart", String(Date.now() - 8000));
  form.set("captureEnd", String(Date.now()));
  form.set(
    "file",
    new Blob(["not a WAV"], { type: "audio/wav" }),
    "invalid.wav",
  );
  if (extra) form.set("speaker_id", "unauthorized-speaker");
  return fetch(origin + "/api/" + action, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
    body: form,
  });
}
assert.equal((await upload("analyze", "candidate", joined.cookie)).status, 403);
assert.equal(
  (await upload("enroll", "candidate", joined.cookie, true)).status,
  400,
);
assert.equal((await upload("enroll", "candidate", joined.cookie)).status, 422);
// Revoke this test-only session directly without contacting LiveKit.
const db = new DatabaseSync(
  process.env.DATABASE_PATH || ".data/signalshift.sqlite",
);
db.prepare("UPDATE sessions SET ended=1,consent=NULL WHERE id=?").run(id);
db.close();
assert.equal(
  (await post("status", { id, role: "candidate" }, joined.cookie)).body.ended,
  true,
);
assert.equal(
  (await post("rooms/token", { id, role: "candidate" }, joined.cookie)).status,
  409,
);
console.log(
  "HTTP smoke passed: page, origin rejection, cookie session creation, role isolation, invitation exchange, declined/affirmative fixture consent, pre-consent and revoked-session token rejection, forbidden speaker substitution, malformed WAV rejection. No media/provider checks performed.",
);
