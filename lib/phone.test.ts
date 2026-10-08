import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatPhone, isE164, normalizePhone, phoneSearchDigits } from "./phone";

describe("normalizePhone", () => {
  const valid: [string, string][] = [
    ["040 123 456", "+38640123456"],
    ["040-123-456", "+38640123456"],
    ["(040) 123 456", "+38640123456"],
    ["01 234 56 78", "+38612345678"],
    ["+386 40 123 456", "+38640123456"],
    ["00386 40 123 456", "+38640123456"],
    ["+43 664 1234567", "+436641234567"],
    ["  031/000-111 ", "+38631000111"],
  ];
  for (const [input, expected] of valid) {
    test(`"${input}" -> ${expected}`, () => assert.equal(normalizePhone(input), expected));
  }

  const invalid = ["", "abc", "040 123", "040 123 456 789", "40123456", "+0 40 123 456", "+386", "040 12a 456"];
  for (const input of invalid) {
    test(`"${input}" is rejected`, () => assert.equal(normalizePhone(input), null));
  }

  test("the same number typed differently becomes the same customer", () => {
    assert.equal(normalizePhone("040 123 456"), normalizePhone("+386 40 123 456"));
  });
});

test("isE164 matches the database check (customers_phone_e164)", () => {
  assert.ok(isE164("+38640123456"));
  assert.ok(!isE164("040123456"));
  assert.ok(!isE164("+386 40 123 456"));
  assert.ok(!isE164("+0123456789"));
});

test("formatPhone shows Slovenian numbers in the national format", () => {
  assert.equal(formatPhone("+38640123456"), "040 123 456");
  assert.equal(formatPhone("+436641234567"), "+436641234567");
});

test("phoneSearchDigits also tries the national query as E.164", () => {
  assert.deepEqual(phoneSearchDigits("040 123"), ["040123", "38640123"]);
  assert.deepEqual(phoneSearchDigits("12"), []);
});
