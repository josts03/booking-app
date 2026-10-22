import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { requestHost, salonOrigin, salonSlugFromHost } from "./tenant";

const env = process.env as Record<string, string | undefined>;
const saved = { ROOT_DOMAIN: env.ROOT_DOMAIN, NODE_ENV: env.NODE_ENV, PORT: env.PORT };
afterEach(() => Object.assign(env, saved));

describe("salonOrigin: the salon's address for links in e-mails", () => {
  test("with ROOT_DOMAIN: https on the salon's subdomain", () => {
    env.ROOT_DOMAIN = "Domena.si";
    assert.equal(salonOrigin("frizerstvo-test"), "https://frizerstvo-test.domena.si");
  });

  test("in development without ROOT_DOMAIN: <slug>.localhost", () => {
    delete env.ROOT_DOMAIN;
    env.NODE_ENV = "development";
    delete env.PORT;
    assert.equal(salonOrigin("test"), "http://test.localhost:3000");
  });

  test("in production without ROOT_DOMAIN: refuses instead of a broken link", () => {
    delete env.ROOT_DOMAIN;
    env.NODE_ENV = "production";
    assert.throws(() => salonOrigin("test"), /ROOT_DOMAIN/);
  });

  test("never builds a link from something that is not a slug", () => {
    env.ROOT_DOMAIN = "domena.si";
    for (const slug of ["evil.example/x", "Test", "", "a b", "-x"]) {
      assert.throws(() => salonOrigin(slug), /invalid slug/, slug);
    }
  });

  test("agrees with salonSlugFromHost in both directions", () => {
    env.ROOT_DOMAIN = "domena.si";
    assert.equal(salonSlugFromHost(new URL(salonOrigin("salon-ana")).host), "salon-ana");
  });
});

describe("requestHost: the host the visitor asked for", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  test("x-forwarded-host wins: Next's own internal requests carry its origin in Host", () => {
    assert.equal(
      requestHost(headers({ host: "localhost:3000", "x-forwarded-host": "kozmetika-mile.localhost:3000" })),
      "kozmetika-mile.localhost:3000",
    );
  });

  test("the first of several forwarded hosts; Host when there is none", () => {
    assert.equal(requestHost(headers({ host: "x", "x-forwarded-host": "salon.domena.si, proxy.example" })), "salon.domena.si");
    assert.equal(requestHost(headers({ host: "test.localhost:3000" })), "test.localhost:3000");
    assert.equal(requestHost(headers({ host: "test.localhost:3000", "x-forwarded-host": " " })), "test.localhost:3000");
    assert.equal(requestHost(headers({})), null);
  });
});
