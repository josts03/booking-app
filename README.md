# Termin: spletno naročanje za salone

Multi-tenant platforma za naročanje strank v salonih. Več salonov, ena baza. Vsak
salon ima svojo poddomeno (`salon.domena.si`), javno stran za naročanje in admin.

**Stanje: faza 1.** Vse deluje z izmišljenimi podatki (`lib/mock.ts`), baze še ni.
Prijave v `/admin` še ni, zato **projekta ne objavljaj na javni naslov**, dokler
prijava ni narejena.

Zasloni in pisalne poti so narejeni; manjka le baza. Pot do faze 2:
požene se `specs/schema.sql` v Supabase, nato se zamenjajo telesa funkcij v
`lib/data.ts` (podpisi in tipi ostanejo enaki) in se vklopi `signIn()`.

## Sklad

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, date-fns in date-fns-tz.
Kasneje: Supabase (Postgres, Auth, RLS), Vercel, Resend.

## Zagon

Potrebuješ Node.js 20 ali novejši.

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

Preverjanje tipov: `npx tsc --noEmit`. Zaženi ga po `npm run build`, ker gradnja
ustvari globalne tipe (`PageProps`, `LayoutProps`).

## Poti

| Pot | Kaj je |
|---|---|
| `/` | prodajna stran platforme |
| `/registracija` | ustvarjanje novega salona (izbira poddomene) |
| `/prijava` | prijava lastnika (zaslon je narejen, prijave še ni) |
| `/rezervacija` | javna stran za naročanje (4 koraki) |
| `/rezervacija/potrditev/[token]` | potrditev termina |
| `/admin` | admin: koledar, storitve, zaposleni, stranke, analitika, nastavitve |

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

## Zgradba

```
app/
  (marketing)/    prodajna stran
  (salon)/        javna stran salona (layout z barvo in logotipom salona)
  admin/          admin (koledar, storitve, zaposleni, stranke, analitika)
lib/
  types.ts        tipi, 1:1 s tabelami v specs/schema.sql
  data.ts         EDINA pot do podatkov (zdaj vrača izmišljene)
  mock.ts         izmišljeni podatki; uvaža ga SAMO data.ts
  analytics.ts    čista funkcija za analitiko
  format.ts       slovenski zapisi (cene, datumi, trajanje)
  brand.ts        barva salona v CSS spremenljivke
specs/
  schema.sql      SQL shema: tabele, omejitve, RLS. types.ts je 1:1 z njo.
proxy.ts          poddomena -> glava x-salon-slug
```

Barve, tipografija in razmiki so na enem mestu: `app/globals.css`. Vsak salon
prepiše samo `--brand` (in izpeljani vrednosti) iz podatka `salons.brand_color`.

## Pravila

- Podatke bere in piše samo `lib/data.ts`. Ko pride Supabase, se zamenja ta datoteka.
- Vsi časi v bazi so `timestamptz`, urniki so lokalni `time`. Pretvorbe pasov samo z `date-fns-tz`.
- Cena se vedno bere iz baze, nikoli iz zahteve. Rezervacije nastajajo samo v strežniški akciji.
- Besedila za uporabnika so v slovenščini, koda in komentarji v angleščini.
