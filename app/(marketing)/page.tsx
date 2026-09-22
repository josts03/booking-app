import type { CSSProperties, ReactNode } from "react";
import { PRODUCT_NAME, SIGNIN_HREF, TRIAL_HREF } from "./_components/ui";

const audiences = [
  "Frizerski saloni",
  "Barberji",
  "Kozmetični saloni",
  "Nohtni studii",
  "Masaže",
  "Samostojni obrtniki",
];

const benefits: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: "Naročanje 24 ur na dan",
    text: "Stranka na telefonu izbere storitev, zaposlenega in prosto uro. Brez klicanja, brez tipkanja v zvezek. Stran ima vaše ime, logotip in barvo.",
    icon: (
      <path d="M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm4 10 2 2 4-4" />
    ),
  },
  {
    title: "Manj neprihodov",
    text: "Stranka po rezervaciji prejme potrditev, dan pred terminom pa še opomnik. V obeh je povezava za odpoved, da se prosti termin ne izgubi.",
    icon: (
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Zm4.3 13a2 2 0 0 0 3.4 0" />
    ),
  },
  {
    title: "Nikoli dvojno rezerviran termin",
    text: "Sistem ne dovoli, da bi dve stranki dobili isto uro istega zaposlenega. Koledar po zaposlenih je pregleden tudi na telefonu.",
    icon: (
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Zm-3.5 9 2.5 2.5 4.5-5" />
    ),
  },
];

const plans = [
  { name: "Solo", price: 19, staff: "1 zaposleni", text: "Za samostojnega frizerja ali kozmetičarko." },
  { name: "Salon", price: 39, staff: "Do 5 zaposlenih", text: "Za salon z ekipo.", featured: true },
  { name: "Studio", price: 69, staff: "Do 15 zaposlenih", text: "Za večje salone in več izmen." },
];

const included = [
  "Spletna stran za naročanje na vaši poddomeni",
  "Koledar po zaposlenih, dan in teden",
  "Potrditve in opomniki po e-pošti",
  "Seznam strank in izvoz v CSV",
  "Statistika: zasedenost, prihodek, neprihodi",
];

const buttonBase =
  "inline-flex min-h-12 items-center justify-center rounded-control px-6 font-semibold transition-colors";
const buttonPrimary = `${buttonBase} bg-brand text-brand-foreground hover:bg-brand-strong`;
const buttonSecondary = `${buttonBase} border border-line bg-surface text-ink hover:border-ink-muted`;

export default function MarketingPage() {
  return (
    <>
      <header className="px-gutter">
        <div className="mx-auto flex h-16 max-w-page items-center justify-between">
          <span className="text-xl font-bold tracking-tight">{PRODUCT_NAME}</span>
          <div className="flex items-center gap-1 sm:gap-2">
            <a
              href={SIGNIN_HREF}
              className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-ink transition-colors hover:bg-brand-soft"
            >
              Prijava
            </a>
            <a
              href={TRIAL_HREF}
              className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-strong"
            >
              Začni brezplačno
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* What it is */}
        <section className="px-gutter pt-10 pb-section">
          <div className="mx-auto grid max-w-page items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="mb-5 inline-block rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand-strong">
                Spletno naročanje za salone
              </p>
              <h1 className="text-display font-bold text-balance">
                Stranke se naročijo same. Vi pa strižete.
              </h1>
              <p className="mt-5 max-w-xl text-lead text-ink-muted">
                {PRODUCT_NAME} je spletno naročanje za frizerske, kozmetične in
                druge salone. Vsak salon dobi svojo stran za rezervacije,
                koledar za zaposlene in opomnike po e-pošti.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href={TRIAL_HREF} className={buttonPrimary}>
                  Preizkusi 14 dni brezplačno
                </a>
                <a href="#cenik" className={buttonSecondary}>
                  Poglej cenik
                </a>
              </div>
              <p className="mt-4 text-sm text-ink-muted">
                Brez kartice. Brez obveznosti.
              </p>
            </div>

            <BookingPreview />
          </div>
        </section>

        {/* Who it is for */}
        <section className="border-y border-line bg-surface px-gutter py-section">
          <div className="mx-auto max-w-page">
            <h2 className="max-w-2xl text-title font-bold text-balance">
              Za salone, kjer telefon zvoni med striženjem
            </h2>
            <p className="mt-4 max-w-2xl text-lead text-ink-muted">
              Za samostojne obrtnike in za salone z več zaposlenimi. Vsak
              zaposleni ima svoj urnik, svoje storitve in svoj stolpec v
              koledarju.
            </p>
            <ul className="mt-8 flex flex-wrap gap-3">
              {audiences.map((name) => (
                <li
                  key={name}
                  className="rounded-full border border-line bg-canvas px-4 py-2 font-medium"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Three benefits */}
        <section className="px-gutter py-section">
          <div className="mx-auto max-w-page">
            <h2 className="max-w-2xl text-title font-bold text-balance">
              Manj dela z rezervacijami, več časa za stranke
            </h2>
            <ul className="mt-10 grid gap-5 md:grid-cols-3">
              {benefits.map((benefit) => (
                <li
                  key={benefit.title}
                  className="rounded-card border border-line bg-surface p-6"
                >
                  <span className="flex size-11 items-center justify-center rounded-control bg-brand-soft text-brand">
                    <svg
                      viewBox="0 0 24 24"
                      className="size-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {benefit.icon}
                    </svg>
                  </span>
                  <h3 className="mt-5 text-xl font-semibold">{benefit.title}</h3>
                  <p className="mt-2 text-ink-muted">{benefit.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="cenik"
          className="scroll-mt-4 border-t border-line bg-surface px-gutter py-section"
        >
          <div className="mx-auto max-w-page">
            <h2 className="text-title font-bold">Cenik</h2>
            <p className="mt-4 max-w-2xl text-lead text-ink-muted">
              Cena je odvisna samo od števila zaposlenih. Prvih 14 dni je
              brezplačnih.
            </p>

            <ul className="mt-10 grid gap-5 md:grid-cols-3">
              {plans.map((plan) => (
                <li
                  key={plan.name}
                  className={`flex flex-col rounded-card border p-6 ${
                    plan.featured
                      ? "border-brand bg-brand-soft ring-1 ring-brand"
                      : "border-line bg-canvas"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold">{plan.name}</h3>
                    {plan.featured && (
                      <span className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground">
                        Najpogostejši
                      </span>
                    )}
                  </div>
                  <p className="mt-4">
                    <span className="text-display font-bold">{plan.price} €</span>
                    <span className="text-ink-muted"> / mesec</span>
                  </p>
                  <p className="mt-3 font-medium">{plan.staff}</p>
                  <p className="mt-1 text-ink-muted">{plan.text}</p>
                  <a
                    href={TRIAL_HREF}
                    className={`mt-6 ${plan.featured ? buttonPrimary : buttonSecondary}`}
                  >
                    Preizkusi brezplačno
                  </a>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <h3 className="font-semibold">Vsi paketi vključujejo</h3>
              <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {included.map((item) => (
                  <li key={item} className="flex gap-3">
                    <svg
                      viewBox="0 0 24 24"
                      className="mt-0.5 size-5 shrink-0 text-success"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="px-gutter py-section">
          <div className="mx-auto max-w-page rounded-card bg-ink px-6 py-12 text-center text-canvas sm:px-12">
            <h2 className="mx-auto max-w-2xl text-title font-bold text-balance">
              Preizkusite {PRODUCT_NAME} v svojem salonu
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lead text-canvas/75">
              14 dni brezplačno, brez kartice. Če vam ne ustreza, preprosto
              nehate.
            </p>
            <a href={TRIAL_HREF} className={`mt-8 ${buttonPrimary}`}>
              Začni brezplačni preizkus
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-gutter py-8 text-sm text-ink-muted">
        <div className="mx-auto max-w-page">© {PRODUCT_NAME}</div>
      </footer>
    </>
  );
}

/**
 * Decorative preview of a salon's booking page. It sets its own --brand to
 * show that every salon gets its own color (same mechanism as in globals.css).
 */
function BookingPreview() {
  const days = [
    { label: "Pon", num: "21" },
    { label: "Tor", num: "22", active: true },
    { label: "Sre", num: "23" },
    { label: "Čet", num: "24" },
  ];
  const times = [
    { t: "9:00" },
    { t: "9:15", taken: true },
    { t: "9:30" },
    { t: "10:00", active: true },
    { t: "10:15" },
    { t: "10:30", taken: true },
  ];

  return (
    <div
      aria-hidden="true"
      style={{ "--brand": "#0f766e" } as CSSProperties}
      className="mx-auto w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-brand font-bold text-brand-foreground">
          FT
        </span>
        <div>
          <p className="font-semibold">Frizerstvo Test</p>
          <p className="text-sm text-ink-muted">Izberite dan in uro</p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-control bg-brand-soft px-4 py-3">
        <div>
          <p className="font-medium">Žensko striženje</p>
          <p className="text-sm text-ink-muted">45 min · Maja Novak</p>
        </div>
        <p className="font-semibold text-brand-strong">32 €</p>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2">
        {days.map((day) => (
          <div
            key={day.num}
            className={`rounded-control border py-2 text-center ${
              day.active
                ? "border-brand bg-brand text-brand-foreground"
                : "border-line"
            }`}
          >
            <p className="text-xs opacity-80">{day.label}</p>
            <p className="font-semibold">{day.num}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {times.map((slot) => (
          <div
            key={slot.t}
            className={`flex h-11 items-center justify-center rounded-control border text-sm font-medium ${
              slot.active
                ? "border-brand bg-brand text-brand-foreground"
                : slot.taken
                  ? "border-line text-ink-muted/50 line-through"
                  : "border-brand-line text-brand-strong"
            }`}
          >
            {slot.t}
          </div>
        ))}
      </div>

      <div className="mt-5 flex h-12 items-center justify-center rounded-control bg-brand font-semibold text-brand-foreground">
        Potrdi termin
      </div>
    </div>
  );
}
