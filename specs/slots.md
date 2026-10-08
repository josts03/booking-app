# Specifikacija: motor prostih terminov

Najbolj kritičen del sistema. Testi se pišejo PRVI.

## Podpis

```ts
export type Okno = { start: string; end: string };        // "09:00", "17:00"
export type Interval = { od: Date; do: Date };

export type VhodTerminov = {
  dan: string;              // "2026-09-21" (lokalni datum salona)
  casovniPas: string;       // "Europe/Ljubljana"
  trajanjeMin: number;      // services.duration_min
  cistilniCasMin: number;   // services.buffer_after_min
  korakMin: number;         // salons.slot_interval_min
  najkrajsaNajavaMin: number; // salons.min_lead_time_min
  zdaj: Date;               // vedno parameter, NIKOLI Date.now() v funkciji
  urniki: Okno[];           // staff_hours za ta dan tedna
  odsotnosti: Interval[];   // time_off, ki se prekriva s tem dnevom
  zasedeno: Interval[];     // rezervacije (pending + confirmed), z čistilnim časom
};

export function prostiTermini(v: VhodTerminov): Interval[];
```

## Pravila

1. Če je `urniki` prazen, vrni prazen seznam.
2. Lokalni čas okna pretvori v absolutni čas v `casovniPas`, ne v času strežnika.
3. Od okna odštej vse `odsotnosti`.
4. Od okna odštej vse `zasedeno`.
5. Po preostalih oknih koračaj po `korakMin` od začetka okna.
6. Termin obdrži samo, če `trajanjeMin + cistilniCasMin` v celoti pade v okno
   in se ne prekriva z ničemer.
7. Odvrzi termine, kjer je `zacetek < zdaj + najkrajsaNajavaMin`.
8. Vrnjeni `konec` je `zacetek + trajanjeMin` (BREZ čistilnega časa) — to je,
   kar vidi stranka. Čistilni čas šteje samo pri preverjanju prostosti.
9. Rezultat je urejen naraščajoče po `zacetek`.
10. Pretvorbe pasov samo z `date-fns-tz`. Nikoli ročno prištevanje ur.

## Deset testov (lib/slots.test.ts)

| # | Postavitev | Pričakovano |
|---|---|---|
| 1 | `urniki: []` | prazen seznam |
| 2 | Okno 9–17, odsotnost 12–17 | ni terminov po 12:00 |
| 3 | Okno 9–10, trajanje 90 | prazen seznam |
| 4 | Okno 9–10, trajanje 60, korak 15 | natanko en termin, 9:00 |
| 5 | Zasedeno 9–10 in 10:30–12, trajanje 30 | obstaja termin 10:00 |
| 6 | Enako kot 5, a čistilni čas 10 min | termina 10:00 NI |
| 7 | `zdaj` = 8:30, najkrajša najava 120 min, okno 9–17 | prvi termin ni pred 10:30 |
| 8 | Dan prehoda na poletni čas (zadnja nedelja v marcu), okno 9–17 | ni podvojenih ali manjkajočih terminov; vsi so v pravem lokalnem času |
| 9 | Dan prehoda na zimski čas (zadnja nedelja v oktobru), okno 9–17 | enako kot 8 |
| 10 | Okno 9–17, zasedeno prekriva celotno okno | prazen seznam |

Test 11 (integracijski, ne v tej datoteki): dve sočasni vstavljanji istega
termina — eno uspe, drugo dobi napako `23P01`.

## Ravnanje z napako baze

```ts
try {
  await vstaviRezervacijo(podatki);
} catch (e: any) {
  if (e.code === '23P01') {          // exclusion_violation
    return { napaka: 'Ta termin je bil pravkar zaseden. Izberite drug.' };
  }
  throw e;
}
```

Nikoli ne zanašaj se samo na preverjanje pred vstavljanjem — pri dveh sočasnih
zahtevah gresta obe skozi. Izključitveni pogoj v bazi je edina prava zaščita.
