import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeAnalysis } from "../src/lib/results";
import { encodeWav, inspectWav } from "../src/lib/wav";
import {
  createSession,
  authenticate,
  db,
  getSession,
  claim,
  active,
  rateLimit,
} from "../src/lib/server/store";
import { provider } from "../src/lib/server/provider";
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "signalshift-tests-")),
  "test.sqlite",
);
const response = (speaker: unknown, deepfake: unknown) => ({
  object: "speaker.verification",
  result: { decision: speaker },
  deepfake: { verdict: deepfake },
});
for (const [speaker, deepfake, outcome] of [
  ["match", "real", "passed"],
  ["no_match", "real", "concern"],
  ["match", "fake", "concern"],
  ["match", "not_sure", "incomplete"],
  ["unknown", "real", "incomplete"],
  ["match", "unknown", "incomplete"],
]) {
  test(`fixture only: ${speaker} + ${deepfake} -> ${outcome}`, () =>
    assert.equal(
      normalizeAnalysis(response(speaker, deepfake), true).outcome,
      outcome,
    ));
}
test("partial non-2xx response preserves synthetic-speech concern", () => {
  const result = normalizeAnalysis(
    {
      error: { code: "insufficient_speech" },
      partial: { deepfake: { verdict: "fake", operation_id: "op_test" } },
    },
    false,
  );
  assert.equal(result.speaker, "unavailable");
  assert.equal(result.deepfake, "fake");
  assert.equal(result.outcome, "concern");
  assert.equal(result.partialFailure, true);
  assert.equal(result.speakerError, "insufficient_speech");
});
test("nested deepfake error preserves speaker mismatch but never marks both passed", () => {
  const result = normalizeAnalysis(
    {
      object: "speaker.verification",
      result: { decision: "no_match" },
      deepfake: { error: { code: "inference_timeout" }, verdict: "real" },
    },
    true,
  );
  assert.equal(result.speaker, "no_match");
  assert.equal(result.deepfake, "unavailable");
  assert.equal(result.outcome, "concern");
});
test("malformed, null, legacy-score, and error responses never pass", () => {
  for (const value of [
    null,
    [],
    {},
    response("match", null),
    { result: { decision: "match" }, deepfake: { score: 0.01 } },
    { ...response("match", "real"), error: { code: "failed" } },
  ])
    assert.notEqual(normalizeAnalysis(value, true).outcome, "passed");
  assert.equal(
    normalizeAnalysis(response("match", "real"), false).outcome,
    "incomplete",
  );
});
function tone(seconds: number, rate = 48000) {
  return encodeWav(
    Float32Array.from(
      { length: seconds * rate },
      (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / rate),
    ),
    rate,
  );
}
test("complete WAV has real duration, PCM sample rate, and valid lengths", () => {
  assert.deepEqual(inspectWav(tone(25), "enroll"), {
    duration: 25,
    sampleRate: 48000,
  });
  assert.deepEqual(inspectWav(tone(8, 44100), "analyze"), {
    duration: 8,
    sampleRate: 44100,
  });
});
test("short, silent, truncated, relabeled-rate, oversized, and stereo audio are rejected", () => {
  assert.throws(() => inspectWav(tone(19), "enroll"));
  assert.throws(() => inspectWav(tone(4), "analyze"));
  assert.throws(() =>
    inspectWav(encodeWav(new Float32Array(8 * 48000), 48000), "analyze"),
  );
  assert.throws(() => inspectWav(tone(8).slice(0, -2), "analyze"));
  const corrupted = tone(8);
  new DataView(corrupted).setUint32(24, 22050, true);
  assert.throws(() => inspectWav(corrupted, "analyze"));
  assert.throws(() => inspectWav(new ArrayBuffer(3_500_001), "enroll"));
  const stereo = tone(8);
  new DataView(stereo).setUint16(22, 2, true);
  assert.throws(() => inspectWav(stereo, "analyze"));
});
test("capabilities isolate roles and sessions, expire, and are hashed at rest", () => {
  const a = createSession(),
    b = createSession();
  assert.ok(authenticate(a.id, a.candidate, "candidate"));
  assert.equal(authenticate(a.id, a.candidate, "interviewer"), undefined);
  assert.equal(authenticate(b.id, a.candidate, "candidate"), undefined);
  assert.notEqual(getSession(a.id)?.candidate, a.candidate);
  db().prepare("UPDATE sessions SET expires=0 WHERE id=?").run(a.id);
  assert.equal(authenticate(a.id, a.candidate, "candidate"), undefined);
});
test("consent revocation prevents new work and invalidates in-flight snapshot", () => {
  const created = createSession();
  const initial = getSession(created.id)!;
  assert.equal(claim(initial), false);
  db()
    .prepare("UPDATE sessions SET consent=? WHERE id=?")
    .run(Date.now(), created.id);
  const s = getSession(created.id)!;
  assert.equal(active(s), true);
  assert.equal(claim(s), true);
  assert.equal(claim(s), false);
  db()
    .prepare("UPDATE sessions SET consent=NULL,ended=1 WHERE id=?")
    .run(created.id);
  assert.equal(active(s), false);
  assert.equal(claim(s), false);
});
test("persistent rate limit bounds repeated requests", () => {
  assert.equal(rateLimit("test", 2, 60), true);
  assert.equal(rateLimit("test", 2, 60), true);
  assert.equal(rateLimit("test", 2, 60), false);
});
test("provider adapter sends real documented multipart fields; same key and bytes survive a bounded retry (mock transport)", async () => {
  const original = globalThis.fetch;
  process.env.DETECTIF_API_KEY = "fixture-not-a-real-key";
  let calls = 0;
  const form = new FormData();
  form.set("file", new Blob([tone(8)], { type: "audio/wav" }), "sample.wav");
  form.set("speaker_id", "ss-test");
  form.set("detect_deepfake", "true");
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://platform.detectif.ai/v1/speakers/verify");
    assert.equal(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
      "same-key",
    );
    assert.equal(init?.body, form);
    return new Response(
      JSON.stringify(
        calls === 1
          ? { error: { code: "server_busy" } }
          : response("match", "real"),
      ),
      { status: calls === 1 ? 503 : 200, headers: { "Retry-After": "0" } },
    );
  };
  try {
    const result = await provider("/speakers/verify", {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": "same-key" },
    });
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = original;
    delete process.env.DETECTIF_API_KEY;
  }
});
test("provider does not retry partial responses or ignore long Retry-After (mock transport)", async () => {
  const original = globalThis.fetch;
  process.env.DETECTIF_API_KEY = "fixture-not-a-real-key";
  try {
    for (const [status, body] of [
      [
        502,
        {
          error: { code: "failed" },
          partial: { deepfake: { verdict: "fake" } },
        },
      ],
      [429, { error: { code: "rate_limited" } }],
    ] as const) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Retry-After": "120" },
        });
      };
      await provider("/speakers/verify", { method: "POST" });
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
    delete process.env.DETECTIF_API_KEY;
  }
});

test("AudioWorklet produces one complete bounded segment and averages channels (simulated PCM only)", async () => {
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  let Processor: new (options: unknown) => {
    process(input: Float32Array[][]): boolean;
  };
  const messages: ArrayBuffer[] = [];
  runInNewContext(readFileSync("public/pcm-worklet.js", "utf8"), {
    Float32Array,
    AudioWorkletProcessor: class {
      port = {
        postMessage(buffer: ArrayBuffer) {
          messages.push(buffer);
        },
      };
    },
    registerProcessor(_name: string, ctor: typeof Processor) {
      Processor = ctor;
    },
  });
  const recorder = new Processor!({ processorOptions: { frames: 5 } });
  assert.equal(
    recorder.process([
      [new Float32Array([1, 0, 1]), new Float32Array([-1, 1, 0])],
    ]),
    true,
  );
  assert.equal(messages.length, 0);
  assert.equal(
    recorder.process([[new Float32Array([0.25, 0.5, 0.75])]]),
    false,
  );
  assert.equal(messages.length, 1);
  assert.deepEqual(
    [...new Float32Array(messages[0])],
    [0, 0.5, 0.5, 0.25, 0.5],
  );
});
