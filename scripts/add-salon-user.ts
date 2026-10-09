/**
 * npm run salon-user -- <salon-slug> <e-mail> [owner|staff]
 *
 * Gives an existing Supabase Auth user access to a salon's admin (a row in
 * salon_users). The user is created first in Supabase > Authentication > Users
 * > Add user (the password is typed there, never here). Safe to run again: an
 * existing membership only gets the new role.
 *
 * Uses the SECRET key from .env.local (lib/supabase/admin.ts).
 */
import { adminDb } from "../lib/supabase/admin";

const [slug, email, role = "owner"] = process.argv.slice(2);

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!slug || !email || !["owner", "staff"].includes(role)) {
  stop("Uporaba: npm run salon-user -- <slug-salona> <e-naslov> [owner|staff]\nPrimer:  npm run salon-user -- test ime@primer.si");
}

const db = adminDb();

const salon = await db.from("salons").select("id, name").eq("slug", slug).maybeSingle<{ id: string; name: string }>();
if (salon.error) stop(`Salona ni bilo mogoče prebrati (${salon.error.code}).`);
if (!salon.data) stop(`Salon "${slug}" ne obstaja.`);

// The Auth admin API has no lookup by e-mail: page through the users.
const wanted = email.trim().toLowerCase();
let userId: string | null = null;
for (let page = 1; !userId; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) stop(`Uporabnikov ni bilo mogoče prebrati (${error.code ?? error.name}).`);
  userId = data.users.find((user) => user.email?.toLowerCase() === wanted)?.id ?? null;
  if (data.users.length < 200) break;
}
if (!userId) {
  stop(`Uporabnik ${email} ne obstaja. Najprej ga dodaj v Supabase > Authentication > Users > Add user.`);
}

const { error } = await db
  .from("salon_users")
  .upsert({ salon_id: salon.data.id, user_id: userId, role }, { onConflict: "salon_id,user_id" });
if (error) stop(`Dostopa ni bilo mogoče shraniti (${error.code}).`);

console.log(`Urejeno: ${email} ima dostop do salona "${salon.data.name}" (vloga: ${role}).`);
