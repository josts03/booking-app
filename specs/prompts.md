# Prompti za Claude Code, po tednih

Vrstni red: najprej videz z izmišljenimi podatki (teden 1-3), baza od tedna 4.
Železno pravilo: tipi v lib/types.ts ustrezajo specs/schema.sql, vsi podatki
tečejo skozi lib/data.ts. Ko pride baza, zamenjaš samo to eno datoteko.

## Pravila za vsak prompt
1. Ena naloga naenkrat.
2. Vedno povej, česa naj se NE dotika.
3. Pri večji nalogi: "Najprej mi napiši načrt. Ne piši kode, dokler ne rečem v redu."
4. Commitaj po vsakem uspešnem koraku.
5. Če dvakrat ne uspe, razdeli nalogo na pol.
6. Nikoli mu ne daj pravih podatkov strank.

## Teden 1 - postavitev in videz
```
Preberi CLAUDE.md in vse datoteke v specs/. Nato postavi Next.js projekt
(App Router, TypeScript, Tailwind) v tej mapi.

FAZA 1 GRADNJE: samo videz z izmišljenimi podatki. Baze še NE priklapljamo.

Naredi:
1. lib/types.ts - TypeScript tipi, ki se ENA PROTI ENA ujemajo s tabelami iz
   specs/schema.sql (Salon, Staff, Service, StaffHours, TimeOff, Customer,
   Booking). Imena polj naj bodo enaka kot v SQL.
2. lib/mock.ts - izmišljeni podatki za en salon: "Frizerstvo Test", dva
   zaposlena, pet storitev s trajanjem in ceno, urniki pon-pet 9:00-17:00,
   pet rezervacij v prihodnjem tednu.
3. lib/data.ts - EDINA datoteka, prek katere kdorkoli bere podatke.
   Funkcije: getSalon(slug), getServices(salonId), getStaff(salonId),
   getFreeSlots(...), getBookings(salonId, od, do), createBooking(...).
   Zdaj vračajo podatke iz mock.ts. Kasneje bom vsebino te datoteke zamenjal
   s Supabase klici, zato noben drug del kode ne sme uvažati mock.ts.
4. middleware.ts, ki iz glave Host prebere poddomeno in jo poda naprej kot
   glavo x-salon-slug. Če poddomene ni, uporabi "test".
5. app/(marketing)/page.tsx - moja prodajna stran: kaj je, za koga,
   tri prednosti, cenik, gumb za brezplačen preizkus.
6. Oblikovni sistem: barve, tipografija in razmiki kot Tailwind spremenljivke
   v enem mestu, da lahko kasneje vsak salon dobi svojo barvo.

Slog: čist, moderen, mobilno najprej. Preveri pri 375 px širine.
Slovenska besedila, angleška imena v kodi.

Ne dodajaj drugih knjižnic razen date-fns in date-fns-tz.
Na koncu mi napiši seznam datotek in ukaz za zagon.
```

## Teden 2 - javna stran, še vedno samo videz
```
Naredi javno stran za naročanje na app/(salon)/, po specs/mvp.md.
Še vedno samo videz - podatke jemlji izključno iz lib/data.ts.

Štirje koraki v enem toku, s prikazom napredka:
1. Izbor storitve - po kategorijah, s trajanjem in ceno
2. Izbor zaposlenega - kartice in možnost "kdorkoli prost"
3. Izbor dneva in ure - koledar, dnevi brez prostih terminov onemogočeni,
   ure v mreži, gumbi vsaj 44 px visoki
4. Podatki in potrditev - ime, telefon, e-pošta, opomba, dve ločeni kljukici
   (pogoji obvezno, obveščanje o akcijah neobvezno)

Po oddaji pokaži potrditveno stran s povzetkom termina.
Logotip in barvo beri iz podatkov salona, ne zakodiraj ju.

getFreeSlots naj zaenkrat vrača izmišljene ure - pravi motor pišemo kasneje
po specs/slots.md. Podpis funkcije mora ostati isti.

Ne spreminjaj lib/types.ts in ne dodajaj knjižnic.
```

## Teden 3 - admin in objava
```
Naredi ogrodje admina na /admin, še vedno z izmišljenimi podatki iz lib/data.ts.
Prijave še ne delamo - dostop naj bo zaenkrat prost.

Zasloni:
- Koledar: pogled dan in teden, stolpec na zaposlenega, barve po zaposlenem,
  klik na termin odpre podrobnosti
- Storitve: tabela z urejanjem
- Zaposleni: seznam in tedenski urnik po dnevih
- Stranke: seznam z iskanjem in kartica z zgodovino
- Analitika: štiri številke na vrhu (rezervacije, prihodek, zasedenost,
  neprihodi) in en preprost graf po tednih

Mora delati tudi na telefonu - frizerka bo to gledala med delom.
Ne dodajaj knjižnic za koledar, naredi ga sam s CSS mrežo.
```

Nato priprava za objavo:
```
Pripravi projekt za objavo:
- .gitignore, ki vsebuje .env.local, .next, node_modules
- .env.example z vsemi spremenljivkami, ki jih bomo rabili kasneje
- README.md z ukazi za zagon
- preveri, da npm run build gre skozi brez napak

Nato mi napiši točne git ukaze, ki jih moram pognati.
```

## Teden 4 - baza
```
Iz specs/schema.sql naredi migracije v supabase/migrations/:
001_tables.sql, 002_constraints.sql, 003_rls.sql.

Nato naredi scripts/seed.ts, ki ustvari testni salon "Frizerstvo Test"
(slug "test"), dva zaposlena, pet storitev, urnike pon-pet 9:00-17:00
in tri rezervacije v prihodnjem tednu. Podatki naj bodo enaki kot v
lib/mock.ts, da bo prehod neopazen.

Sheme si ne izmišljaj. Če misliš, da je v specs napaka, mi jo najprej
javi in počakaj na odgovor.
```

## Teden 5 - motor terminov (najpomembnejši prompt)
```
Napiši TESTE PRVE.

1. Iz specs/slots.md naredi lib/slots.test.ts z vsemi desetimi primeri.
   Poženi jih - morajo pasti.
2. Nato napiši lib/slots.ts, dokler niso vsi zeleni.

Zahteve iz specs/slots.md upoštevaj dobesedno, posebej:
- prostiTermini() je čista funkcija in ne bere baze
- trenutni čas dobi kot parameter, nikoli Date.now() v funkciji
- časovne pasove obravnavaj z date-fns-tz
- čistilni čas šteje k zasedenosti, ne k prikazanemu trajanju

Ko so testi zeleni, mi prilepi izpis npm test. Ne piši vmesnika.
```

## Teden 6 - priklop na bazo
```
Zdaj priklopimo pravo bazo. Vmesnika se NE dotikaj.

1. V lib/data.ts zamenjaj vsebino vseh funkcij tako, da berejo iz Supabase
   namesto iz mock.ts. Podpisi funkcij in tipi ostanejo enaki.
2. getFreeSlots naj naloži urnike, odsotnosti in rezervacije iz baze in jih
   poda lib/slots.ts. Ne piši logike za termine na novo.
3. createBooking premakni v strežniško akcijo, ki:
   - preveri vhode z Zod
   - preveri, da storitev in zaposleni pripadata temu salonu
   - ceno vzame iz baze, nikoli iz zahteve
   - ponovno preveri prostost in ujame napako 23P01 s sporočilom
     "Ta termin je bil pravkar zaseden."
4. lib/mock.ts izbriši šele, ko vse deluje.

Po končanem mi naštej vse datoteke, ki še uvažajo mock.ts. Če jih je več
kot nič, je nekaj narobe z arhitekturo in mi povej, kje.
```

## Teden 7 - prijava, e-pošta, odpoved
```
1. Prijava: Supabase Auth, e-pošta in geslo, delujoče pozabljeno geslo.
   Dostop do /admin sme imeti samo uporabnik, ki je v salon_users za ta
   salon. Preveri to na strežniku, ne v brskalniku.
2. lib/email.ts z Resendom in dve predlogi: potrditev in opomnik.
   V zadevi naj bo ime salona, Reply-To naj bo e-naslov salona.
3. app/odpoved/[token]/page.tsx: po cancel_token najde rezervacijo, prikaže
   podatke in dovoli odpoved, če je do termina več kot cancel_window_hours
   ur. Žeton primerjaj v celoti.
4. Po uspešni rezervaciji pošlji potrditev in zapiši vrstico v
   booking_notifications.
```

## Teden 8 - upravljanje terminov
```
Dodaj v admin: ročni vnos rezervacije, prestavitev na drugo uro in drugega
zaposlenega, odpoved, neprihod, zaključeno.

Ročni vnos sme preskočiti najkrajšo najavo (salon vpisuje za nazaj), a NE
sme preskočiti izključitvenega pogoja. Če se prekriva, pokaži jasno napako.
```

## Teden 9 - zaposleni, urniki, storitve
```
Poveži admin strani za zaposlene (tedenski urnik po dnevih, dopusti) in
storitve (trajanje, čistilni čas, cena, kdo jo izvaja) s pravo bazo.

Urniki se hranijo kot lokalni time, ne kot absolutni čas.
Sprememba urnika ali dopusta mora takoj vplivati na proste termine.
```

## Teden 10 - stranke, analitika, nadzorna plošča
```
1. Stranke: iskanje, kartica z zgodovino obiskov, interna opomba,
   izvoz v CSV, gumb za anonimizacijo po specs/security.md.
2. Analitika s pravimi podatki: rezervacije po tednih, zasedenost v %,
   prihodek, delež neprihodov, primerjava zaposlenih.
3. Nadzorna plošča /super po specs/mvp.md, dostopna samo mojemu e-naslovu,
   preverjeno na strežniku.
```

## Teden 11 - opomniki in zaščita
```
1. app/api/cron/reminders/route.ts: najde rezervacije, ki se začnejo v
   naslednjih 23 do 25 urah, so confirmed in še nimajo vrstice
   (booking_id, 'reminder', 'email') v booking_notifications. Pošlje
   opomnik in zapiše vrstico. Pot zaščiti s skrivnostjo iz CRON_SECRET.
2. vercel.json z urnikom vsako uro.
3. Omejitev hitrosti na javni akciji po specs/security.md.
4. Cloudflare Turnstile na obrazcu, preverjanje na strežniku.
```

## Varnostni pregled (teden 12 in po vsaki večji funkciji)
```
Preglej to kodo kot napadalec. Preveri natančno teh šest stvari:

1. Ali obstaja katerakoli pot, po kateri anonimni uporabnik prebere
   customers ali bookings?
2. Ali je service_role ključ kjerkoli dosegljiv brskalniku?
3. Kje manjka preverba, da service_id, staff_id in salon_id sodijo skupaj?
4. Ali se cena kje vzame iz zahteve namesto iz baze?
5. Ali katera napaka vrne uporabniku SQL besedilo ali ime tabele?
6. Ali je kakšna pot brez omejitve hitrosti, ki piše v bazo?

Za vsako najdbo napiši datoteko, vrstico, zakaj je to težava in predlog
popravka. NE popravljaj še ničesar - najprej hočem videti seznam.
```
