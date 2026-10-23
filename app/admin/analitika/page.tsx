import Link from "next/link";
import { format, parseISO, subWeeks } from "date-fns";
import { notFound } from "next/navigation";
import { computeAnalytics } from "@/lib/analytics";
import { getCurrentSalon } from "@/lib/current-salon";
import { getBookings, getStaff, getStaffHours, getTimeOff } from "@/lib/data";
import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { WeeklyBarChart } from "../_components/weekly-bar-chart";
import { card, pageTitle } from "../_components/ui";

const PERIODS = [4, 8, 12];

export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analitika">) {
  const raw = await searchParams;
  const requested = Number(typeof raw.weeks === "string" ? raw.weeks : "");
  const weeks = PERIODS.includes(requested) ? requested : 8;

  const salon = await getCurrentSalon();
  if (!salon) notFound();

  const now = new Date();
  // Load a little more than needed; computeAnalytics cuts the exact period.
  const from = subWeeks(now, weeks + 1);

  const [bookings, staff, hours, timeOff] = await Promise.all([
    getBookings(salon.id, from, now),
    getStaff(salon.id, { includeInactive: true }),
    getStaffHours(salon.id),
    getTimeOff(salon.id, from, now),
  ]);
  // Admin screen: all staff via the admin client, then the active ones. (The
  // public reading would hide staff of a salon that is not bookable right now.)
  const activeIds = new Set(staff.filter((s) => s.is_active).map((s) => s.id));

  const stats = computeAnalytics({
    bookings,
    staffHours: hours.filter((h) => activeIds.has(h.staff_id)),
    timeOff,
    timezone: salon.timezone,
    weeks,
    now,
  });

  const since = format(parseISO(stats.weeks[0].week_start), "d. M. yyyy");
  const tiles = [
    {
      label: "Rezervacije",
      value: formatNumber(stats.bookings),
      note: "brez odpovedanih",
    },
    {
      label: "Prihodek",
      value: formatPrice(stats.revenue_cents),
      note: "opravljene storitve",
    },
    {
      label: "Zasedenost",
      value: stats.occupancy === null ? "—" : formatPercent(stats.occupancy),
      note: "delovnega časa je bilo rezerviranega",
    },
    {
      label: "Neprihodi",
      value: stats.no_show_rate === null ? "—" : formatPercent(stats.no_show_rate),
      note: `${stats.no_shows} od ${stats.completed + stats.no_shows} terminov`,
    },
  ];

  // Comparison: everyone in the salon's order; former staff only if they worked in the period.
  const staffById = new Map(staff.map((member) => [member.id, member]));
  const comparison = stats.staff
    .flatMap((stat) => {
      const member = staffById.get(stat.staff_id);
      return member && (member.is_active || stat.bookings > 0) ? [{ stat, member }] : [];
    })
    .sort((a, b) => a.member.sort_order - b.member.sort_order);

  const bars = stats.weeks.map((week, index) => {
    const label = format(parseISO(week.week_start), "d. M.");
    return {
      label,
      title: `Teden od ${label}`,
      value: week.bookings,
      detail: `Prihodek ${formatPrice(week.revenue_cents)}`,
      partial: index === stats.weeks.length - 1,
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className={pageTitle}>Analitika</h1>
        <p className="mt-1 text-ink-muted">Od {since} do danes.</p>
      </div>

      {/* One filter row above everything it scopes: numbers and chart use the same period. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Obdobje: zadnjih nekaj tednov">
        {PERIODS.map((option) => (
          <Link
            key={option}
            href={`/admin/analitika?weeks=${option}`}
            aria-current={option === weeks ? "true" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
              option === weeks
                ? "border-ink bg-ink text-canvas"
                : "border-line bg-surface hover:border-ink-muted"
            }`}
          >
            {option} {option === 4 ? "tedne" : "tednov"}
          </Link>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className={`${card} p-4`}>
            <dt className="text-sm text-ink-muted">{tile.label}</dt>
            <dd className="mt-1 text-3xl font-semibold tracking-tight">{tile.value}</dd>
            <dd className="mt-1 text-xs text-ink-muted">{tile.note}</dd>
          </div>
        ))}
      </dl>

      <WeeklyBarChart
        title="Rezervacije po tednih"
        subtitle="Število terminov na teden, brez odpovedanih"
        valueName="rezervacij"
        detailName="Prihodek"
        bars={bars}
      />

      {comparison.length > 0 && (
        <section className={`${card} p-4 sm:p-5`}>
          <h2 className="font-semibold">Primerjava zaposlenih</h2>
          <p className="text-sm text-ink-muted">
            Isto obdobje kot zgoraj. Zasedenost je izračunana iz sedanjega tedenskega urnika.
          </p>
          <ul className="mt-4 grid gap-x-8 divide-y divide-line lg:grid-cols-2 lg:divide-y-0">
            {comparison.map(({ stat, member }) => (
              <li key={member.id} className="space-y-2 py-4 first:pt-0 lg:py-0 lg:pb-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: member.color ?? "#64748b" }}
                    />
                    <span className="truncate">{member.name}</span>
                    {!member.is_active && <span className="shrink-0 text-xs text-ink-muted">(neaktiven)</span>}
                  </span>
                  <span className="shrink-0 text-sm text-ink-muted">
                    <span className="font-semibold text-ink tabular-nums">
                      {stat.occupancy === null ? "—" : formatPercent(stat.occupancy)}
                    </span>{" "}
                    zasedeno
                  </span>
                </div>
                {/* A meter: one ratio against the whole working time. The value is the text above. */}
                <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-brand-soft">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.min(100, Math.round((stat.occupancy ?? 0) * 100))}%` }}
                  />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-ink-muted">Rezervacije</dt>
                    <dd className="font-semibold tabular-nums">{formatNumber(stat.bookings)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Prihodek</dt>
                    <dd className="font-semibold tabular-nums">{formatPrice(stat.revenue_cents)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Neprihodi</dt>
                    <dd className="font-semibold tabular-nums">
                      {stat.no_show_rate === null ? "—" : formatPercent(stat.no_show_rate)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
