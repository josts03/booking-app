# Specifikacija: Email marketing (plačljiv dodatek, po MVP)

Stanje: **načrt, ni narejeno.** Zapisano 22. 10. 2026. Pred začetkom gradnje se
odločiva o odprtih vprašanjih na koncu in shemo potrdiva posebej (CLAUDE.md).

## Kaj je

Dodatek za salone, ki ga plačajo posebej, ker ima platforma z njim stroške
(vsaka poslana e-pošta šteje v kvoto Resenda). Dve funkciji:

1. **Opomnik za ponoven obisk:** samodejna e-pošta stranki nekaj dni po
   opravljeni storitvi, npr. 30 dni po moškem striženju: »Čas je za novo
   striženje« in gumb »Rezerviraj znova«.
2. **Novice:** salon sam napiše in pošlje e-pošto (akcija, novost, praznični
   delovni čas) strankam, ki so privolile.

Brez dodatka salon ne vidi ne enega ne drugega. Vklopi ga lastnik platforme v /super.

## Pravna osnova (GDPR, ZEKom-2)

Obe funkciji sta trženjski sporočili, ne obvestili o terminu. Zato:

- **Samo s soglasjem.** Prejme jih le stranka z `customers.marketing_consent`
  (neobvezna kljukica na obrazcu, ločena od pogojev; že obstaja). Brez izjem
  za »obstoječe stranke«: tako je preprosto in varno.
- **Dokaz soglasja.** Ob soglasju shranimo, kdaj in s katerim besedilom
  kljukice je bilo dano (nova polja). Ob preklicu shranimo, kdaj.
- **Odjava z enim klikom** v vsakem sporočilu: povezava na stran za odjavo in
  glavi `List-Unsubscribe` + `List-Unsubscribe-Post` (Gmail in Yahoo to zahtevata).
  Odjava velja takoj in za vsa trženjska sporočila tega salona.
- **Kdo je kdo.** Salon je upravljavec podatkov svojih strank, platforma je
  obdelovalec. Zajema to pogodba o obdelavi s salonom (kontrolni seznam v
  `specs/security.md`). V sporočilu je jasno, da pošilja salon.
- **Anonimizacija** (že narejena) izbriše tudi soglasje in dokaz.

## Skupna osnova (najprej)

- Dokaz soglasja in čas preklica na stranki.
- Žeton za odjavo na stranki (uuid, primerja se v celoti, kot `cancel_token`)
  in javna stran `/odjava/[token]`: pokaže salon in en gumb »Odjavi me«.
- **Ločena poddomena za pošiljanje**, npr. `novice.<ROOT_DOMAIN>`, ločena od
  `mail.<ROOT_DOMAIN>` (potrditve, gesla). Če kdo novico označi kot spam, ostane
  dostava potrditev in gesel nedotaknjena. Zahteva plačljiv Resend paket (več domen).
- **Seznam blokiranih naslovov:** naslovi, ki so se odbili ali so sporočilo
  označili kot spam (Resend webhooks), ne dobijo nobenega trženjskega sporočila več.
- **Vklop na salon** (`salons.marketing_enabled`), ki ga lahko spremeni samo
  lastnik platforme (kot `subscription_status`: brez pravice za salon v 003_rls.sql).
- **Štetje porabe na salon na mesec** (poslana trženjska e-pošta), za račun in
  za /super (opozorilo pri porabi kvote, kot zdaj za potrditve).
- Mirni čas: trženjska e-pošta odide samo med 9. in 19. uro po času salona.

## 1. Opomnik za ponoven obisk

**Salon (Storitve):** pri storitvi polje »Opomni stranko po __ dneh« (prazno =
brez). Neobvezno besedilo salona (kot `confirmation_note`, največ 500 znakov).

**Kdaj se pošlje** (urni cron, `app/api/cron/reminders`, nov korak):
- termin ima status `completed`, od njegovega začetka je minilo nastavljeno
  število dni (okno ene ure, kot pri opomnikih),
- stranka ima soglasje, ni anonimizirana in ni na seznamu blokiranih,
- stranka v tem salonu **nima** termina po tem (prihodnjega ali že opravljenega),
- salon ima vklopljen dodatek in je `trial` ali `active`,
- največ en tak opomnik na termin (vrstica v `booking_notifications`, nova vrsta `rebook`).

**Vsebina:** ime salona, »Od vašega zadnjega obiska (moško striženje, 21. 9.)
je minil mesec ...«, gumb **Rezerviraj znova**, ki odpre
`/rezervacija?service=<id>&staff=<isti zaposleni, če je še aktiven, sicer any>`,
besedilo salona, povezava za odjavo.

## 2. Novice

**Salon (admin, nov zavihek »Novice«, samo lastnik):**
1. zadeva, besedilo (preprosto oblikovanje: odstavki, krepko, ena slika, en gumb
   »Rezerviraj«), predogled,
2. prejemniki: vsi s soglasjem, ali samo stranke z obiskom v zadnjih N mesecih,
   ali stranke, ki so imele izbrano storitev; prikaže se število prejemnikov,
3. **testna e-pošta** na naslov salona,
4. Pošlji zdaj ali ob izbranem času.

**V ozadju:** pošiljanje po delih (cron ali čakalna vrsta), ki upošteva omejitev
Resenda (2 zahtevi na sekundo) in mirni čas; vsak prejemnik največ enkrat na
novico (enolična vrstica). Ali pa Resend Broadcasts (stiki in odjave pri Resendu)
— odločiva ob gradnji glede na ceno in na to, kje so podatki strank.

**Omejitve:** največ 2 novici na mesec na salon (nastavljivo v /super), največ
toliko prejemnikov, kot jih dovoljuje paket.

**Statistika:** poslano, ni dostavljeno, odjave. Brez sledenja odpiranju (piksli)
— ni potrebno in je manj osebnih podatkov.

## Sprememba sheme (predlog, ni potrjen)

- `customers`: `marketing_consent_at timestamptz`, `marketing_consent_text text`,
  `marketing_revoked_at timestamptz`, `unsubscribe_token uuid default gen_random_uuid()`
- `services`: `rebook_after_days int` (null = brez), `rebook_note text`
- `salons`: `marketing_enabled boolean default false` (samo service_role)
- `booking_notifications.kind`: nova vrsta `rebook`
- nova tabela `campaigns` (salon_id, zadeva, besedilo, segment, status,
  `scheduled_at`, `sent_count`, ...) in `campaign_sends` (salon_id,
  campaign_id, customer_id, status; enolično campaign_id + customer_id)
- nova tabela `email_suppressions` (salon_id ali globalno, e-naslov, razlog)
- vse z `salon_id`, RLS in izrecnimi pravicami; brez pravil za anon

## Stroški in cena

- Strošek platforme: plačljiv Resend paket (več domen, večja kvota) + vsaka
  trženjska e-pošta. Preveri aktualni cenik Resenda ob gradnji.
- Predlog modela: mesečni dodatek s vključenim številom e-pošt (npr. do 1.000),
  nad tem doplačilo; opomnik za ponoven obisk in novice skupaj.
- Obračun najprej ročno iz števcev v /super (spletnih plačil v MVP ni).

## Vrstni red gradnje

1. Skupna osnova (soglasje, odjava, vklop na salon, štetje, poddomena).
2. Opomnik za ponoven obisk (majhen, samodejen, največ vrednosti).
3. Novice (večji: urejevalnik, segmenti, pošiljanje po delih, statistika).

Vsak korak s testi (čiste funkcije za pravila »komu in kdaj«, živi testi na
testni bazi, `tests/db.test.ts` za shemo), kot doslej.

## Odprta vprašanja

1. Cena dodatka in koliko e-pošt je vključenih?
2. Ali naj bo opomnik za ponoven obisk (malo e-pošt, velika vrednost) del
   osnovnega paketa kot prodajni argument, novice pa dodatek?
3. Lastno pošiljanje po delih ali Resend Broadcasts?
4. Ali stranka lahko odjavo prekliče (ponovna prijava na javni strani salona)?
