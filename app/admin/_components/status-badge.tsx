import type { BookingStatus } from "@/lib/types";

const labels: Record<BookingStatus, string> = {
  pending: "Čaka potrditev",
  confirmed: "Potrjeno",
  cancelled: "Odpovedano",
  no_show: "Neprihod",
  completed: "Opravljeno",
};

const styles: Record<BookingStatus, string> = {
  pending: "bg-warning/10 text-warning",
  confirmed: "bg-success/10 text-success",
  cancelled: "bg-line text-ink-muted",
  no_show: "bg-danger/10 text-danger",
  completed: "bg-brand-soft text-brand-ink",
};

export function statusLabel(status: BookingStatus): string {
  return labels[status];
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
