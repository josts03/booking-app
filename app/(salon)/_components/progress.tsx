import Link from "next/link";

export const STEP_LABELS = ["Storitev", "Zaposleni", "Termin", "Podatki"] as const;

/**
 * Four-segment progress bar. Finished steps link back to themselves.
 * `hrefs[i]` is the link for step i + 1 (only used while that step is finished).
 */
export function Progress({
  current,
  hrefs,
}: {
  current: 1 | 2 | 3 | 4;
  hrefs: (string | undefined)[];
}) {
  return (
    <nav aria-label="Potek naročanja">
      <p className="text-sm font-medium text-ink-muted">
        Korak {current} od 4 · <span className="text-ink">{STEP_LABELS[current - 1]}</span>
      </p>
      <ol className="mt-3 grid grid-cols-4 gap-2">
        {STEP_LABELS.map((label, index) => {
          const step = index + 1;
          const href = hrefs[index];
          const bar = (
            <span
              className={`block h-1.5 rounded-full ${step <= current ? "bg-brand" : "bg-line"}`}
            />
          );
          return (
            <li key={label} aria-current={step === current ? "step" : undefined}>
              {step < current && href ? (
                // Tall padding, cancelled out by the negative margin, makes the thin bar tappable.
                <Link
                  href={href}
                  aria-label={`Nazaj na korak ${step}: ${label}`}
                  className="-my-5 block py-5"
                >
                  {bar}
                </Link>
              ) : (
                bar
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
