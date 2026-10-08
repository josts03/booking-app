/**
 * npm run seed
 *
 * Writes supabase/seed.sql with the test salon from lib/fixtures.ts, the same
 * data the app shows today from lib/mock.ts. No keys and no network: you run
 * the file yourself (Supabase SQL editor, or `supabase db reset` locally).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFixtures } from "../lib/fixtures";
import { buildSeedSql } from "./seed-sql";

const now = new Date();
const target = fileURLToPath(new URL("../supabase/seed.sql", import.meta.url));
writeFileSync(target, buildSeedSql(now));

const f = buildFixtures(now);
console.log(`Zapisano: supabase/seed.sql`);
console.log(
  `  salon "${f.salons[0].name}", ${f.staff.length} zaposlena, ${f.services.length} storitev, ` +
    `${f.customers.length} strank, ${f.bookings.length} rezervacij`,
);
console.log(`Naslednji korak: odpri Supabase > SQL Editor, prilepi vsebino datoteke in klikni Run.`);
