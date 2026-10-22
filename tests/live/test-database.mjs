// Loaded first by `npm run test:live` (--import). The live tests create and
// delete salons and users and run jobs for the whole platform (reminders,
// three-year retention, rate-limit cleanup), so they run ONLY against a
// separate, disposable Supabase project (security review of 22. 10. 2026,
// finding 1):
// - its keys are in .env.test (never .env.local),
// - .env.test says LIVE_TEST_DATABASE=yes,
// - and it is not the project of .env.local (the real one).
import { readFileSync } from "node:fs";

function stop(message) {
  console.error(`\nŽivi testi se ne zaženejo: ${message}\nNavodila: README.md, razdelek "Živi testi".\n`);
  process.exit(1);
}

if (process.env.LIVE_TEST_DATABASE !== "yes") {
  stop("v .env.test ni LIVE_TEST_DATABASE=yes (ali datoteke .env.test ni).");
}

const testUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
if (!testUrl) stop("v .env.test manjka NEXT_PUBLIC_SUPABASE_URL testnega projekta.");

let realUrl = null;
try {
  const line = readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
  realUrl = line?.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "") || null;
} catch {
  // No .env.local: nothing to compare with.
}
if (realUrl && realUrl === testUrl) {
  stop(".env.test kaže na isti Supabase projekt kot .env.local (pravo bazo).");
}
