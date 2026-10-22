import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, RATE_LIMITS, rateLimitBucket } from "./rate-limit";

describe("rate-limit rules (specs/security.md)", () => {
  test("5 bookings per IP an hour, 3 per phone a day, 10 sign-ins per IP in 15 minutes, 5 password resets and 20 cancels per IP an hour", () => {
    assert.deepEqual(
      Object.values(RATE_LIMITS).map((r) => [r.prefix, r.limit, r.windowMs / 60_000]),
      [
        ["booking-ip", 5, 60],
        ["booking-phone", 3, 24 * 60],
        ["signin-ip", 10, 15],
        ["reset-ip", 5, 60],
        ["cancel-ip", 20, 60],
      ],
    );
  });
});

describe("rateLimitBucket", () => {
  test("the same value always gives the same bucket; the value itself is not in it", () => {
    const phone = "+38640123456";
    const bucket = rateLimitBucket(RATE_LIMITS.bookingPerPhone, phone);
    assert.equal(bucket, rateLimitBucket(RATE_LIMITS.bookingPerPhone, phone));
    assert.match(bucket, /^booking-phone:[0-9a-f]{64}$/);
    assert.ok(!bucket.includes("40123456"));
  });

  test("different rules and values never share a bucket", () => {
    const ip = "203.0.113.7";
    assert.notEqual(rateLimitBucket(RATE_LIMITS.bookingPerIp, ip), rateLimitBucket(RATE_LIMITS.signInPerIp, ip));
    assert.notEqual(rateLimitBucket(RATE_LIMITS.bookingPerIp, ip), rateLimitBucket(RATE_LIMITS.bookingPerIp, "203.0.113.8"));
  });
});

describe("clientIp", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  test("the first x-forwarded-for entry, else x-real-ip", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientIp(headers({ "x-forwarded-for": " 2001:db8::1 " })), "2001:db8::1");
    assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  });

  test("none: null, so no shared bucket blocks everyone", () => {
    assert.equal(clientIp(headers({})), null);
    assert.equal(clientIp(headers({ "x-forwarded-for": " , " })), null);
  });
});
