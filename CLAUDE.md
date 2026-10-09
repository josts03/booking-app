# Pravila projekta

## Kaj je to
Multi-tenant platforma za naročanje strank v salonih. Več salonov, ena baza.
Vsak salon ima svojo poddomeno (salon.domena.si) in svoj admin.

## Sklad
Next.js App Router, TypeScript, Tailwind, Supabase (Postgres + Auth + RLS),
Vercel, Resend za e-pošto. Brez dodatnih knjižnic brez vprašanja.

## Nedotakljiva pravila
- Vsaka tabela ima salon_id in vklopljen RLS. Edina izjema za salon_id je rate_limits
  (globalna, brez pravil, samo service_role).
- Pravice so dvojne: GRANT (tabele in stolpci) + RLS (vrstice). Nova tabela nima
  pravic za anon, authenticated in service_role, dokler jih izrecno ne dodaš.
- Funkcije SECURITY DEFINER samo v shemi private (API je ne izpostavlja), nikoli v public.
- Javne strani berejo s publishable ključem (vloga anon) brez seje uporabnika. Anon ne vidi
  staff.email, staff.phone, staff.user_id in time_off.reason.
- Tabele customers, bookings, payments, audit_log NE smejo imeti pravil za anon.
- Skrivni ključ (SUPABASE_SECRET_KEY, vloga service_role) samo v lib/supabase/admin.ts,
  ki se uvozi SAMO na strežniku.
- Nobena skrivnost v spremenljivki s predpono NEXT_PUBLIC_.
- Rezervacije se ustvarjajo samo v strežniški akciji, nikoli iz brskalnika.
- Cena se vedno bere iz baze, nikoli iz zahteve.
- Pred vstavljanjem preveri, da service_id, staff_id in salon_id sodijo skupaj.
- Vsi časi v bazi so timestamptz. Urniki so lokalni time.
- Pretvorbe časovnih pasov samo z date-fns-tz. Nikoli ročno prištevanje ur.
- Spremembe sheme samo kot nova datoteka v supabase/migrations/, ista sprememba
  v specs/schema.sql in test v tests/db.test.ts.
- Telefoni strank so v bazi v zapisu E.164 (+38640123456). Pretvorba samo z lib/phone.ts.
- Izmišljeni podatki so samo v lib/fixtures.ts (seed in testi jih delita).
- lib/slots.ts je čista funkcija. Ne bere baze in ne kliče Date.now().

## Slog
- Besedila za uporabnika v slovenščini, koda in komentarji v angleščini.
- Mobilno najprej. Preveri pri 375 px širine.
- Napake uporabniku: prijazen stavek. Podrobnosti v Sentry, nikoli na zaslon.
- Datumi in ure v slovenskem zapisu (21. 9. 2026, 14:30).

## Preden rečeš, da je končano
- npm run build gre skozi
- npm test je zelen
- napiši, katere datoteke si spremenil in zakaj

## Česa ne delaj brez vprašanja
- Ne dodajaj knjižnic.
- Ne spreminjaj sheme baze.
- Ne spreminjaj lib/slots.ts, ko delaš vmesnik.
- Ne "popravljaj" datotek, ki jih naloga ne omenja.

## Next.js
@AGENTS.md
