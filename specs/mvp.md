# Specifikacija: obseg MVP

## Javna stran salona (anonimna stranka)

Štirje zasloni: storitev -> zaposleni -> dan in ura -> podatki in potrditev.

- Seznam storitev po kategorijah, s trajanjem in ceno
- Izbor zaposlenega ali "kdorkoli prost"
- Koledar: dnevi brez prostih terminov so onemogočeni
- Ure v mreži, velike dovolj za prst (min. 44 px)
- Obrazec: ime (obvezno), telefon (obvezno), e-pošta (obvezna), opomba
- Dve ločeni kljukici: pogoji (obvezno) in obveščanje o akcijah (neobvezno)
- Turnstile pred oddajo
- Po uspehu: potrditvena stran + e-pošta s povezavo za odpoved
- Logotip in barva iz tabele salons. Tvoje znamke ni v ospredju.
- Če je salon `suspended`: prijazna stran "naročanje trenutno ni mogoče"

## Admin salona (prijavljen uporabnik)

- Prijava z e-pošto in geslom (Supabase Auth), delujoče pozabljeno geslo
- Koledar: pogled dan in teden, stolpec na zaposlenega, barve po zaposlenem
- Ročni vnos rezervacije (telefonska stranka, e-pošta neobvezna)
- Prestavitev termina, odpoved, neprihod, zaključeno
- Zaposleni: dodajanje, tedenski urnik po dnevih, dopusti in odsotnosti
- Storitve: ime, kategorija, trajanje, čistilni čas, cena, kdo jo izvaja
- Stranke: seznam, iskanje po imenu in telefonu, zgodovina obiskov,
  interna opomba, izvoz v CSV, anonimizacija
- Analitika: rezervacije po tednih, zasedenost v %, prihodek,
  delež neprihodov, primerjava zaposlenih
- Nastavitve: delovni čas, najkrajša najava, koliko dni naprej,
  okno za odpoved, besedilo potrditvene e-pošte

## Nadzorna plošča lastnika platforme (/super)

- Seznam salonov: ime, poddomena, status naročnine, št. rezervacij ta mesec
- Nov salon: obrazec, ki ustvari salon + prvega uporabnika + pošlje vabilo
- Vklop in izklop: nastavitev `subscription_status`
- Uporaba: št. poslanih e-pošt ta mesec (opozorilo pri 80 % Resend kvote)
- Dostop samo za tvoj e-naslov, preverjen na strežniku

## Kaj NI v MVP

SMS, WhatsApp, Google Calendar, vgradni widget, lastna domena salona,
čakalna lista, are in spletna plačila, skupinski termini, sobe in oprema,
darilni boni, zvestoba, večjezičnost, mobilna aplikacija, Stripe naročnine,
davčna blagajna, zaloge.
