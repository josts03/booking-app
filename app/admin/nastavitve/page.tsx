import { notFound } from "next/navigation";
import { getAdminAccess } from "@/lib/admin-access";
import { safeColor } from "@/lib/brand";
import { pageTitle } from "../_components/ui";
import { SettingsForm } from "./settings-form";

/**
 * The salon's own settings, for its owner (decision of 22. 10. 2026). Slug,
 * subscription and time zone are not here: only the platform changes those.
 */
export default async function SettingsPage() {
  const access = await getAdminAccess();
  if (!access.ok) notFound(); // the admin layout handles signed-out and non-members
  const { salon } = access;

  if (access.role !== "owner") {
    return (
      <div className="space-y-2">
        <h1 className={pageTitle}>Nastavitve</h1>
        <p className="text-ink-muted">Nastavitve salona lahko ureja samo lastnik salona.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className={pageTitle}>Nastavitve</h1>
        <p className="mt-1 text-ink-muted">Spremembe veljajo takoj, tudi na strani za naročanje.</p>
      </div>
      <SettingsForm
        defaults={{
          name: salon.name,
          phone: salon.phone ?? "",
          email: salon.email ?? "",
          address: salon.address ?? "",
          brand_color: safeColor(salon.brand_color),
          slot_interval_min: String(salon.slot_interval_min),
          min_lead_time_hours: String(Math.round(salon.min_lead_time_min / 60)),
          max_days_ahead: String(salon.max_days_ahead),
          cancel_window_hours: String(salon.cancel_window_hours),
          reminder_hours_before: String(salon.reminder_hours_before),
          confirmation_note: salon.confirmation_note ?? "",
          require_confirmation: salon.require_confirmation,
        }}
      />
    </div>
  );
}
