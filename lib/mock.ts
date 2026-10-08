/**
 * Fake in-memory "database" for phase 1 (no Supabase yet).
 *
 * IMPORTANT: only lib/data.ts may import this file. Everything else reads data
 * through lib/data.ts, so that swapping in Supabase touches one file.
 *
 * The data itself lives in lib/fixtures.ts, shared with scripts/seed.ts, so the
 * seeded database contains exactly the same salon, customers and bookings.
 */
import { buildFixtures } from "./fixtures";

export { toPeriod } from "./fixtures";

/**
 * Arrays are mutable on purpose so that createBooking in lib/data.ts can append
 * to them. State lives in server memory only and resets when the server restarts.
 */
export const mock = buildFixtures(new Date());
