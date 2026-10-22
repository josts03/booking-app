import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isSuperAdminEmail, isSuperPath } from "./super-admin";

describe("isSuperAdminEmail: only the e-mail in SUPER_ADMIN_EMAIL", () => {
  const owner = "lastnik@example.com";

  test("the same address, case and spaces aside", () => {
    assert.equal(isSuperAdminEmail("lastnik@example.com", owner), true);
    assert.equal(isSuperAdminEmail("Lastnik@Example.COM", owner), true);
    assert.equal(isSuperAdminEmail("lastnik@example.com", "  LASTNIK@example.com "), true);
  });

  test("anything else is refused", () => {
    for (const email of ["drugi@example.com", "lastnik@example.com.evil.si", "xlastnik@example.com", "lastnik@example", "", null, undefined]) {
      assert.equal(isSuperAdminEmail(email, owner), false, String(email));
    }
  });

  test("fails closed when SUPER_ADMIN_EMAIL is not set", () => {
    assert.equal(isSuperAdminEmail("lastnik@example.com", undefined), false);
    assert.equal(isSuperAdminEmail("lastnik@example.com", ""), false);
    assert.equal(isSuperAdminEmail("", ""), false);
    assert.equal(isSuperAdminEmail("   ", "   "), false);
  });
});

test("isSuperPath", () => {
  assert.equal(isSuperPath("/super"), true);
  assert.equal(isSuperPath("/super/saloni"), true);
  assert.equal(isSuperPath("/superx"), false);
  assert.equal(isSuperPath("/admin"), false);
});
