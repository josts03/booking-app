# Termin: spletno naročanje za salone

Multi-tenant platforma za naročanje strank v salonih. Več salonov, ena baza. Vsak
salon ima svojo poddomeno (`salon.domena.si`), javno stran za naročanje in admin.

**Stanje: teden 7.** Aplikacija bere in piše v pravo bazo (Supabase). `/admin`
je zaščiten s prijavo (Supabase Auth): noter sme samo uporabnik, ki je v
`salon_users` za salon s tega naslova. Po rezervaciji gre stranki potrditvena
e-pošta (Resend) s povezavo za odpoved.
**Projekta še ne objavljaj na javni naslov:** omejitev hitrosti in Turnstile
pridejo v tednu 11.

## Sklad

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, date-fns in date-fns-tz.
Baza: Supabase (Postgres, Auth, RLS) prek `@supabase/supabase-js`, seja prijave v
piškotku prek `@supabase/ssr`, preverjanje vnosov z `zod`. E-pošta: Resend (navaden
`fetch`, brez knjižnice). Kasneje: Vercel.
Samo za teste: PGlite (Postgres v pomnilniku, `devDependencies`).

## Zagon

Potrebuješ Node.js 22.18 ali novejši (priporočeno 24). Testi in seed tečejo
neposredno iz TypeScripta, kar zna samo novejši Node.

```bash
npm install
cp .env.example .env.local   # nato vpiši ključe Supabase (glej Okolje)
npm run dev
```

Odpri http://localhost:3000. Brez izpolnjenega `.env.local` strani s podatki ne delujejo.

| Ukaz | Kaj naredi |
|---|---|
| `npm run dev` | razvojni strežnik z osveževanjem |
| `npm run build` | produkcijska gradnja (mora iti skozi brez napak) |
| `npm run start` | zažene gradnjo (najprej `npm run build`) |
| `npm run lint` | ESLint |
| `npm test` | testi brez interneta: motor terminov, telefon, podatki in **baza** (migracije, RLS, pravila v Postgresu v pomnilniku) |
| `npm run test:live` | testi proti ločenemu **testnemu** Supabase projektu iz `.env.test` (glej "Živi testi"): API res zavrača prepovedano, rezervacije delujejo, dve hkratni rezervaciji istega termina -> ena uspe. Kar ustvarijo, na koncu pobrišejo |
| `npm run seed` | ustvari `supabase/seed.sql` s testnim salonom |
| `npm run salon-user -- test ime@primer.si` | da obstoječemu uporabniku dostop do admina salona `test` (vloga `owner`; za zaposlenega dodaj `staff`) |

Preverjanje tipov: `npx tsc --noEmit`. Zaženi ga po `npm run build`, ker gradnja
ustvari globalne tipe (`PageProps`, `LayoutProps`).

## Poti

| Pot | Kaj je |
|---|---|
| `/` | prodajna stran platforme |
| `/rezervacija` | javna stran za naročanje (4 koraki) |
| `/rezervacija/potrditev/[token]` | potrditev termina |
| `/odpoved/[token]` | odpoved termina (povezava iz e-pošte) |
| `/prijava` | prijava v admin salona |
| `/pozabljeno-geslo`, `/novo-geslo` | ponastavitev gesla (povezava iz e-pošte) |
| `/admin` | admin: koledar, storitve, zaposleni, stranke, analitika (samo s prijavo) |

Salon se izbere po poddomeni: `test.localhost:3000` je salon s slugom `test`.
Brez poddomene (`localhost:3000`) se uporabi `test`. Na poddomeni salona je
koren `/` stran za naročanje, na glavni domeni pa prodajna stran.

## Okolje

```bash
cp .env.example .env.local
```

`.env.local` ni v gitu. Za delovanje so potrebne tri vrednosti iz Supabase
(Project Settings > API Keys): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) in `SUPABASE_SECRET_KEY`
(`sb_secret_…`). Za e-pošto še `RESEND_API_KEY` in `EMAIL_FROM` (brez njiju se
e-pošta ne pošilja, vse drugo deluje). Ostale spremenljivke so za naslednje tedne
(glej `.env.example`).
Skrivnosti nikoli ne gredo v spremenljivko s predpono `NEXT_PUBLIC_`; aplikacija se
ne zažene, če je skrivni ključ pomotoma v javni spremenljivki.

## Baza

Migracije so v `supabase/migrations/` in se poženejo po vrsti:

| Datoteka | Kaj naredi |
|---|---|
| `001_tables.sql` | tipi in tabele |
| `002_constraints.sql` | pravila, ki jih baza preveri sama: ni prekrivanja terminov, vse iz istega salona, veljavne vrednosti |
| `003_rls.sql` | kdo sme kaj brati in pisati (pravice na tabele in stolpce + RLS) |
| `004_private_helpers.sql` | pomožne funkcije izven dosega API-ja (Security Advisor brez opozoril) |

`specs/schema.sql` je ista vsebina v enem kosu, za branje.

**Novi Supabase projekt** (regija `eu-central-1`, Frankfurt):

1. Supabase > SQL Editor: po vrsti prilepi in poženi vse datoteke iz
   `supabase/migrations/` (001, 002, 003, 004 ...). Ali s Supabase CLI: `supabase db push`.
2. `npm run seed`, nato vsebino `supabase/seed.sql` prilepi v SQL Editor in poženi.
   Ustvari testni salon (slug `test`) z istimi podatki, kot jih kaže aplikacija zdaj.
   Seed lahko poženeš večkrat; podatki testnega salona se zamenjajo.

`supabase/seed.sql` ni v gitu (vsakič se ustvari na novo, datumi so relativni).

**Prijava** (Supabase > Authentication):

1. Users > Add user > Create new user (e-naslov, geslo, Auto Confirm User), nato
   `npm run salon-user -- <slug> <e-naslov>`. Registracija je izklopljena.
2. URL Configuration: Site URL in Redirect URLs (`http://*.localhost:3000/**`,
   v produkciji `https://*.domena.si/**`). Brez tega povezava za novo geslo ne dela.
3. Emails > Reset password: zadeva in besedilo iz `supabase/templates/reset-password.html`.
4. Providers > Email: najmanjša dolžina gesla 10.
5. Pred pravimi saloni: Emails > SMTP Settings z Resend (`smtp.resend.com`, port 465,
   uporabnik `resend`, geslo = ločen Resend ključ). Vgrajena pošta Supabase pošilja
   samo članom ekipe projekta in le nekaj sporočil na uro.

**Živi testi** (`npm run test:live`, `tests/live/`) tečejo proti pravemu Supabase
projektu, a **samo proti ločenemu testnemu projektu**, nikoli proti bazi s pravimi
saloni: ustvarjajo in brišejo salone ter uporabnike in poženejo opravila za celo
platformo (opomniki, anonimizacija po treh letih). Varovalo `tests/live/test-database.mjs`
jih ustavi, če `.env.test` ni ali kaže na isti projekt kot `.env.local`.

1. Supabase > New project (npr. `termin-test`, regija Frankfurt). Brezplačni paket
   dovoli dva projekta.
2. SQL Editor: prilepi in poženi `specs/schema.sql` (vse migracije v enem kosu),
   nato `npm run seed` in vsebino `supabase/seed.sql`.
3. Authentication > Sign In / Providers: izklopi "Allow new users to sign up".
4. Datoteka `.env.test` (ni v gitu) s ključi TESTNEGA projekta:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<testni-projekt>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   LIVE_TEST_DATABASE=yes
   ```
   E-pošte testi ne pošiljajo (ponarejen pošiljatelj), zato Resend ključ ni potreben.

**Testi baze** (`tests/db.test.ts`) poženejo migracije in seed v pravem Postgresu
v pomnilniku in preverijo varnostni seznam iz `specs/security.md`: anonimni
obiskovalec ne bere strank in rezervacij, admin vidi samo svoj salon, termini se
ne prekrivajo, tuji `service_id` je zavrnjen ... Vsaka sprememba sheme mora imeti test.

## Zgradba

```
app/
  (marketing)/    prodajna stran
  (salon)/        javna stran salona (layout z barvo in logotipom salona)
  admin/          admin (koledar, storitve, zaposleni, stranke, analitika)
lib/
  types.ts        tipi, 1:1 s tabelami v specs/schema.sql
  data.ts         EDINA pot do podatkov (Supabase)
  supabase/       odjemalci: public.ts (javni ključ, RLS), admin.ts (skrivni ključ, samo strežnik),
                  session.ts in session-client.ts (seja prijavljenega uporabnika v piškotku)
  auth.ts         prijava, odjava, novo geslo (Supabase Auth)
  admin-access.ts kdo sme v admin: prijavljen in v salon_users za ta salon
  safe-next.ts    kam po prijavi (samo znotraj /admin)
  email.ts        predlogi (potrditev, opomnik) in pošiljanje prek Resend
  notifications.ts potrditev po rezervaciji, zapis v booking_notifications
  cancel.ts       pravilo odpovedi (več kot cancel_window_hours pred terminom)
  tenant.ts       salon iz poddomene, naslov salona za povezave v e-pošti
  slots.ts        motor prostih terminov (čista funkcija, specs/slots.md)
  fixtures.ts     izmišljeni podatki testnega salona (seed in testi)
  phone.ts        telefonske številke v zapis E.164
  analytics.ts    čista funkcija za analitiko
  format.ts       slovenski zapisi (cene, datumi, trajanje)
  brand.ts        barva salona v CSS spremenljivke
proxy.ts          poddomena -> glava x-salon-slug; /admin brez seje -> /prijava
supabase/
  migrations/     001_tables, 002_constraints, 003_rls, 004_private_helpers
  templates/      besedila e-pošte za Supabase Auth (ponastavitev gesla)
scripts/
  seed.ts         npm run seed
  add-salon-user.ts npm run salon-user
tests/
  db.test.ts      testi baze (Postgres v pomnilniku)
  live/           testi proti testnemu Supabase projektu (npm run test:live, .env.test)
```

Barve, tipografija in razmiki so na enem mestu: `app/globals.css`. Vsak salon
prepiše samo `--brand` (in izpeljani vrednosti) iz podatka `salons.brand_color`.

## Pravila

- Podatke bere in piše samo `lib/data.ts`. Javni podatki gredo prek javnega ključa
  (RLS omeji, kaj se vidi), vse ostalo prek skrivnega ključa na strežniku.
- Vsi časi v bazi so `timestamptz`, urniki so lokalni `time`. Pretvorbe pasov samo z `date-fns-tz`.
- Cena se vedno bere iz baze, nikoli iz zahteve. Rezervacije nastajajo samo v strežniški akciji.
- Telefoni strank so v bazi v zapisu E.164 (`+38640123456`), pretvorba z `lib/phone.ts`.
- Besedila za uporabnika so v slovenščini, koda in komentarji v angleščini.
