import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./safe-next";

describe("safeNextPath: after signing in, only into the admin", () => {
  const kept = [
    "/admin",
    "/admin/koledar",
    "/admin/koledar?view=week&day=2026-10-09",
    "/admin/stranke/7f9c2b1e-4d3a-4f6b-9a8e-1c2d3e4f5a6b",
    "/admin/stranke?q=ana.novak",
  ];
  for (const path of kept) {
    test(`keeps ${path}`, () => assert.equal(safeNextPath(path), path));
  }

  const refused: unknown[] = [
    "https://evil.example/admin",
    "//evil.example/admin",
    "/\\evil.example",
    "/admin@evil.example",
    "/adminx",
    "/admin//evil.example",
    "/admin/../rezervacija",
    "/admin.rsc",
    "/admin/koledar.segments/x",
    "/prijava",
    "javascript:alert(1)",
    "/admin/koledar#x",
    "",
    null,
    undefined,
    ["/admin"],
    `/admin/${"a".repeat(400)}`,
  ];
  for (const value of refused) {
    test(`refuses ${JSON.stringify(value)?.slice(0, 40)}`, () => assert.equal(safeNextPath(value), "/admin"));
  }
});
