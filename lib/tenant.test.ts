import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { salonOrigin, salonSlugFromHost } from "./tenant";

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
