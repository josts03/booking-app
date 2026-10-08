# Termin: spletno naročanje za salone

Multi-tenant platforma za naročanje strank v salonih. Več salonov, ena baza. Vsak
salon ima svojo poddomeno (`salon.domena.si`), javno stran za naročanje in admin.

**Stanje: faza 1.** Aplikacija še dela z izmišljenimi podatki (`lib/mock.ts`).
Baza (migracije in seed) je pripravljena in testirana, a še ni priklopljena.
Prijave v `/admin` še ni, zato **projekta ne objavljaj na javni naslov**, dokler
prijava ni narejena.

## Sklad

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, date-fns in date-fns-tz.
Baza: Supabase (Postgres, Auth, RLS). Kasneje: Vercel, Resend.
Samo za teste: PGlite (Postgres v pomnilniku, `devDependencies`).

## Zagon

Potrebuješ Node.js 22.18 ali novejši (priporočeno 24). Testi in seed tečejo
neposredno iz TypeScripta, kar zna samo novejši Node.

```bash
npm install
npm run dev
```

Odpri http://localhost:3000.

| Ukaz | Kaj naredi |
|---|---|
| `npm run dev` | razvojni strežnik z osveževanjem |
| `npm run build` | produkcijska gradnja (mora iti skozi brez napak) |
| `npm run start` | zažene gradnjo (najprej `npm run build`) |
| `npm run lint` | ESLint |
| `npm test` | testi: telefon, izmišljeni podatki in **baza** (migracije, RLS, pravila) |
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

`.env.local` ni v gitu. V kodi se trenutno bere samo `ROOT_DOMAIN`; ostale
spremenljivke so pripravljene za naslednje tedne (glej komentarje v `.env.example`).
Skrivnosti nikoli ne gredo v spremenljivko s predpono `NEXT_PUBLIC_`.

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
  data.ts         EDINA pot do podatkov (zdaj vrača izmišljene)
  mock.ts         izmišljena "baza" v pomnilniku; uvaža jo SAMO data.ts
  fixtures.ts     izmišljeni podatki testnega salona (mock in seed)
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
  db.test.ts      testi baze
```

Barve, tipografija in razmiki so na enem mestu: `app/globals.css`. Vsak salon
prepiše samo `--brand` (in izpeljani vrednosti) iz podatka `salons.brand_color`.

## Pravila

- Podatke bere in piše samo `lib/data.ts`. Ko pride Supabase, se zamenja ta datoteka.
- Vsi časi v bazi so `timestamptz`, urniki so lokalni `time`. Pretvorbe pasov samo z `date-fns-tz`.
- Cena se vedno bere iz baze, nikoli iz zahteve. Rezervacije nastajajo samo v strežniški akciji.
- Telefoni strank so v bazi v zapisu E.164 (`+38640123456`), pretvorba z `lib/phone.ts`.
- Besedila za uporabnika so v slovenščini, koda in komentarji v angleščini.
