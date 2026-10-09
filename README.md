# Termin: spletno naročanje za salone

Multi-tenant platforma za naročanje strank v salonih. Več salonov, ena baza. Vsak
salon ima svojo poddomeno (`salon.domena.si`), javno stran za naročanje in admin.

**Stanje: teden 6.** Aplikacija bere in piše v pravo bazo (Supabase).
Prijave še ni (teden 7), zato **admin deluje samo na tvojem računalniku**
(`npm run dev`); povsod drugje, tudi z `npm run start`, je `/admin` zaprt (404).
**Projekta še ne objavljaj na javni naslov.**

## Sklad

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, date-fns in date-fns-tz.
Baza: Supabase (Postgres, Auth, RLS) prek `@supabase/supabase-js`, preverjanje
vnosov z `zod`. Kasneje: Vercel, Resend.
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
| `npm run test:live` | testi proti **pravi** bazi iz `.env.local`: API res zavrača prepovedano, rezervacije delujejo, dve hkratni rezervaciji istega termina -> ena uspe. Kar ustvarijo, na koncu pobrišejo |
| `npm run seed` | ustvari `supabase/seed.sql` s testnim salonom |

Preverjanje tipov: `npx tsc --noEmit`. Zaženi ga po `npm run build`, ker gradnja
ustvari globalne tipe (`PageProps`, `LayoutProps`).

## Poti

| Pot | Kaj je |
|---|---|
| `/` | prodajna stran platforme |
| `/rezervacija` | javna stran za naročanje (4 koraki) |
| `/rezervacija/potrditev/[token]` | potrditev termina |
| `/admin` | admin: koledar, storitve, zaposleni, stranke, analitika |

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
(`sb_secret_…`). Ostale spremenljivke so za naslednje tedne (glej `.env.example`).
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
  supabase/       odjemalca: public.ts (javni ključ, RLS) in admin.ts (skrivni ključ, samo strežnik)
  admin-access.ts kdo sme v admin (do prijave: samo npm run dev)
  slots.ts        motor prostih terminov (čista funkcija, specs/slots.md)
  fixtures.ts     izmišljeni podatki testnega salona (seed in testi)
  phone.ts        telefonske številke v zapis E.164
  analytics.ts    čista funkcija za analitiko
  format.ts       slovenski zapisi (cene, datumi, trajanje)
  brand.ts        barva salona v CSS spremenljivke
proxy.ts          poddomena -> glava x-salon-slug
supabase/
  migrations/     001_tables, 002_constraints, 003_rls, 004_private_helpers
scripts/
  seed.ts         npm run seed
tests/
  db.test.ts      testi baze (Postgres v pomnilniku)
  live/           testi proti pravi bazi (npm run test:live)
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
