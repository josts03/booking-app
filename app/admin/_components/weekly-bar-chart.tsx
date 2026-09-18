/*
 * One-series column chart: bookings per week. Plain HTML/CSS, no library.
 *
 * Rules followed (dataviz): a single color for the one series and no legend (the
 * title names it); columns at most 24px thick with a 4px rounded top and a square
 * baseline; solid hairline gridlines; round axis values; values labelled only on the
 * extreme and the latest column, the rest in the hover/focus readout AND in the
 * table under the chart, so nothing depends on the tooltip. The hit area of a column
 * is its whole band, not only the painted bar.
 */

export interface WeekBar {
  /** Under the column: "14. 9." */
  label: string;
  /** Tooltip heading: "Teden od 14. 9." */
  title: string;
  value: number;
  /** Extra tooltip line, e.g. revenue. */
  detail: string;
  /** The week is not over yet. */
  partial: boolean;
}

/** A round upper bound and the tick values for it (0, step, 2 step ...). */
function niceScale(max: number): { top: number; ticks: number[] } {
  const raw = Math.max(max, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
  const top = Math.ceil(Math.max(max, 1) / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + 1e-9; tick += step) ticks.push(tick);
  return { top, ticks };
}

export function WeeklyBarChart({
  title,
  subtitle,
  valueName,
  detailName,
  bars,
}: {
  title: string;
  subtitle: string;
  /** "rezervacij" */
  valueName: string;
  /** Table column header for the detail, e.g. "Prihodek". */
  detailName: string;
  bars: WeekBar[];
}) {
  const { top, ticks } = niceScale(Math.max(...bars.map((b) => b.value), 0));
  const maxIndex = bars.reduce((best, bar, i) => (bar.value > bars[best].value ? i : best), 0);
  const labelled = new Set([maxIndex, bars.length - 1]);
  const percent = (value: number) => (value / top) * 100;

  return (
    <figure className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <figcaption>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-ink-muted">{subtitle}</p>
      </figcaption>

      {/* The plot height (12rem) plus the x-axis band below; nothing is cropped. */}
      <div className="mt-8 flex">
        <div className="relative h-48 w-9 shrink-0" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-2 translate-y-1/2 text-xs text-ink-muted tabular-nums"
              style={{ bottom: `${percent(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-48">
            {ticks.map((tick) => (
              <div
                key={tick}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-line"
                style={{ bottom: `${percent(tick)}%` }}
              />
            ))}

            <ol className="absolute inset-0 flex">
              {bars.map((bar, index) => {
                const align =
                  index < bars.length / 3 ? "left-0" : index > (bars.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
                return (
                  <li key={bar.title} className="group relative flex-1">
                    <div
                      tabIndex={0}
                      role="img"
                      aria-label={`${bar.title}${bar.partial ? " (do danes)" : ""}: ${bar.value} ${valueName}. ${bar.detail}`}
                      className="absolute inset-0 flex items-end justify-center"
                    >
                      <div
                        className="w-full max-w-6 rounded-t-[4px] bg-brand-ink transition-opacity group-hover:opacity-75 group-focus-within:opacity-75"
                        style={{ height: `${percent(bar.value)}%` }}
                      />
                    </div>

                    {labelled.has(index) && bar.value > 0 && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-semibold"
                        style={{ bottom: `calc(${percent(bar.value)}% + 4px)` }}
                      >
                        {bar.value}
                      </span>
                    )}

                    <div
                      role="tooltip"
                      aria-hidden="true"
                      className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-control bg-ink px-3 py-2 text-xs text-canvas opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${align}`}
                      style={{ bottom: `calc(${percent(bar.value)}% + 1.75rem)` }}
                    >
                      <p className="text-sm font-semibold">
                        {bar.value} {valueName}
                      </p>
                      <p className="opacity-80">
                        {bar.title}
                        {bar.partial && " (do danes)"}
                      </p>
                      <p className="opacity-80">{bar.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <ol className="mt-2 flex" aria-hidden="true">
            {bars.map((bar, index) => (
              <li
                key={bar.title}
                className={`flex-1 text-center text-[11px] leading-tight text-ink-muted ${
                  bars.length > 8 && index % 2 === 0 && index !== bars.length - 1 ? "max-sm:invisible" : ""
                } ${index === bars.length - 1 ? "font-semibold text-ink" : ""}`}
              >
                {bar.label}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        Vsak stolpec je en teden (od ponedeljka). Zadnji je tekoči teden do danes.
      </p>

      <details className="mt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-brand-ink">
          Prikaži kot tabelo
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 font-semibold">
                Teden
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Rezervacije
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                {detailName}
              </th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.title} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 font-normal">
                  {bar.title}
                  {bar.partial && <span className="text-ink-muted"> (do danes)</span>}
                </th>
                <td className="py-2 text-right tabular-nums">{bar.value}</td>
                <td className="py-2 text-right tabular-nums">{bar.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
