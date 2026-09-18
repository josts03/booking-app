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
    getStaff(salon.id),
    getStaffHours(salon.id),
    getTimeOff(salon.id, from, now),
  ]);
  const activeIds = new Set(staff.map((s) => s.id));

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
            <dd className="mt-1 text-3xl font-bold tracking-tight">{tile.value}</dd>
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
    </div>
  );
}
