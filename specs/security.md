# Specifikacija: varnost

## Obvezno v kodi

1. RLS na vseh tabelah. Nobene izjeme.
2. Nobenega pravila `to anon` na `customers`, `bookings`, `payments`,
   `audit_log`, `rate_limits`.
3. Preverjanje vhodov z Zod v vsaki strežniški akciji.
4. Navzkrižna preverba: `service_id`, `staff_id` in `salon_id` morajo sodit skupaj.
5. Cena vedno iz baze, nikoli iz zahteve.
6. `cancel_token` je uuid in se primerja v celoti. Nikoli iskanje po id.
7. Omejitev hitrosti: 5 rezervacij na IP na uro, 3 na isti telefon na dan.
   Uporabi tabelo `rate_limits` v Postgresu (ali obstoječi Upstash setup,
   če je že v uporabi za kontaktne obrazce).
8. Cloudflare Turnstile na javnem obrazcu, preverjanje na strežniku.
9. Napake uporabniku: prijazen stavek. Nikoli SQL besedilo ali imena tabel.
10. `service_role` samo v `lib/supabase/admin.ts`, uvoz samo na strežniku.

## Kontrolni seznam pred prvim pravim salonom

- [ ] Vse tabele imajo `enable row level security`
- [ ] Poskus branja tujega salona vrne prazen seznam, ne napake
- [ ] `grep -r "NEXT_PUBLIC" .` ne najde nobenega skrivnega ključa
- [ ] Anonimni uporabnik ne more brati ne pisati customers in bookings
- [ ] Rezervacija s tujim service_id je zavrnjena
- [ ] Dve sočasni rezervaciji: ena uspe, druga dobi sporočilo
- [ ] 50 zahtev v minuti je ustavljenih
- [ ] Turnstile je vklopljen na javnem obrazcu
- [ ] .env.local ni v Gitu (`git log --all -- .env.local` je prazen)
- [ ] 2FA vklopljen na GitHubu, Vercelu in Supabaseu
- [ ] Sentry javlja napake in v njih ni telefonov ali e-pošt
- [ ] Supabase Pro z dnevnimi backupi je vklopljen
- [ ] Ročni izvoz baze narejen in shranjen zunaj Supabasea
- [ ] Backup enkrat POVRNJEN v testni projekt
- [ ] Politika zasebnosti in pogoji objavljeni in povezani z obrazca
- [ ] Pogodba o obdelavi osebnih podatkov podpisana s salonom

## GDPR v kodi

- Regija Supabase projekta: `eu-central-1` (Frankfurt). Nepovratno.
- Izbris stranke = anonimizacija: prepiši ime, telefon, e-pošto, opombe,
  nastavi `anonymized_at`, rezervacije OHRANI (zaradi statistike salona).
- Izvoz stranke v CSV: gumb v kartici stranke.
- Rezervacije, starejše od treh let, se samodejno anonimizirajo.
- Izvoz celega salona v CSV ob prekinitvi naročnine.
