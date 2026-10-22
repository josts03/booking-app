import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { verifyTurnstile, type TurnstileDeps } from "./turnstile";

const env = process.env as Record<string, string | undefined>;
const saved = { TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY, NODE_ENV: env.NODE_ENV };
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

/** A fake Cloudflare: records what was sent, answers `reply` (or throws). */
function fakeCloudflare(reply: { status?: number; json?: unknown } | Error) {
  const sent: { url: string; body: URLSearchParams }[] = [];
  const deps: TurnstileDeps = {
    fetch: async (input, init) => {
      sent.push({ url: String(input), body: init?.body as URLSearchParams });
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
    },
  };
  return { sent, deps };
}

describe("verifyTurnstile", () => {
  test("ok: sends the secret, the token and the visitor's IP to Cloudflare", async () => {
    env.TURNSTILE_SECRET_KEY = "secret-x";
    const cloudflare = fakeCloudflare({ json: { success: true } });
    assert.equal(await verifyTurnstile("token-1", "203.0.113.7", cloudflare.deps), "ok");
    assert.equal(cloudflare.sent[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.deepEqual(Object.fromEntries(cloudflare.sent[0].body), { secret: "secret-x", response: "token-1", remoteip: "203.0.113.7" });
  });

  test("Cloudflare says no: invalid", async () => {
    env.TURNSTILE_SECRET_KEY = "secret-x";
    const cloudflare = fakeCloudflare({ json: { success: false, "error-codes": ["timeout-or-duplicate"] } });
    assert.equal(await verifyTurnstile("token-1", null, cloudflare.deps), "invalid");
    assert.ok(!cloudflare.sent[0].body.has("remoteip"));
  });

  test("no token, or an absurdly long one: missing, and Cloudflare is not asked", async () => {
    env.TURNSTILE_SECRET_KEY = "secret-x";
    const cloudflare = fakeCloudflare({ json: { success: true } });
    assert.equal(await verifyTurnstile("", null, cloudflare.deps), "missing");
    assert.equal(await verifyTurnstile("x".repeat(2049), null, cloudflare.deps), "missing");
    assert.equal(cloudflare.sent.length, 0);
  });

  test("Cloudflare unreachable or failing: unavailable (the booking is refused, not let through)", async () => {
    env.TURNSTILE_SECRET_KEY = "secret-x";
    assert.equal(await verifyTurnstile("t", null, fakeCloudflare(new TypeError("fetch failed")).deps), "unavailable");
    assert.equal(await verifyTurnstile("t", null, fakeCloudflare({ status: 500 }).deps), "unavailable");
  });

  test("not configured: skipped in development, refused in production", async () => {
    delete env.TURNSTILE_SECRET_KEY;
    const cloudflare = fakeCloudflare({ json: { success: true } });
    env.NODE_ENV = "development";
    assert.equal(await verifyTurnstile("", null, cloudflare.deps), "skipped");
    env.NODE_ENV = "production";
    assert.equal(await verifyTurnstile("token", null, cloudflare.deps), "unavailable");
    assert.equal(cloudflare.sent.length, 0);
  });
});
