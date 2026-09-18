import Link from "next/link";

export interface SummaryRow {
  label: string;
  value: string;
  changeHref: string;
}

/** What the visitor has picked so far, each with a link to change it. */
export function SelectionSummary({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-line rounded-card border border-line bg-surface">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 px-4">
          <div className="py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {row.label}
            </dt>
            <dd className="mt-0.5 font-medium">{row.value}</dd>
          </div>
          <Link
            href={row.changeHref}
            className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm font-medium text-brand-ink hover:underline"
          >
            Spremeni
          </Link>
        </div>
      ))}
    </dl>
  );
}
