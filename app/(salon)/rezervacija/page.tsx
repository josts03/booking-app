import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { getFreeSlots, getServices, getStaff } from "@/lib/data";
import {
  formatDuration,
  formatPrice,
  formatTime,
  formatWeekdayDate,
  localDay,
} from "@/lib/format";
import type { Salon } from "@/lib/types";
import { BookingForm } from "../_components/booking-form";
import { DateTimeStep } from "../_components/datetime-step";
import { flowHref } from "../_components/flow-url";
import { Progress } from "../_components/progress";
import { SelectionSummary, type SummaryRow } from "../_components/selection-summary";
import { ServiceStep } from "../_components/service-step";
import { StaffStep } from "../_components/staff-step";
import { backLink } from "../_components/ui";

/** True if `time` is exactly one of the free start times (so stale links fall back a step). */
async function isFreeStart(
  salon: Salon,
  serviceId: string,
  staffId: string | null,
  time: string | undefined,
): Promise<boolean> {
  const start = time ? new Date(time) : null;
  if (!start || Number.isNaN(start.getTime())) return false;
  const slots = await getFreeSlots({
    salon_id: salon.id,
    service_id: serviceId,
    staff_id: staffId,
    day: localDay(start, salon.timezone),
  });
  return slots.some((slot) => new Date(slot.starts_at).getTime() === start.getTime());
}

/**
 * The four-step booking flow. The step is derived from the URL (see flow-url.ts);
 * anything invalid or stale simply drops the visitor back to the step that needs it.
 */
export default async function BookingPage({ searchParams }: PageProps<"/rezervacija">) {
  const raw = await searchParams;
  const param = (key: string) => (typeof raw[key] === "string" ? raw[key] : undefined);

  const salon = await getCurrentSalon();
  if (!salon) notFound();
  // The layout shows the "booking unavailable" page; do not even load the data.
  if (!isBookable(salon)) return null;

  const services = await getServices(salon.id);
  const service = services.find((s) => s.id === param("service"));
  const staffList = service ? await getStaff(salon.id, { serviceId: service.id }) : [];
  const staffParam = param("staff");
  const staffMember = staffList.find((s) => s.id === staffParam);
  const staffChosen = staffParam === "any" ? staffList.length > 0 : staffMember !== undefined;

  let step: 1 | 2 | 3 | 4 = 1;
  let time: string | undefined;
  if (service) {
    step = 2;
    if (staffChosen && staffParam) {
      step = 3;
      const candidate = param("time");
      if (await isFreeStart(salon, service.id, staffParam === "any" ? null : staffParam, candidate)) {
        step = 4;
        time = candidate;
      }
    }
  }

  // Links back to finished steps (used by the progress bar, the summary and "Nazaj").
  const serviceHref = flowHref({});
  const staffHref = flowHref({ service: service?.id });
  const timeHref = flowHref({
    service: service?.id,
    staff: staffParam,
    day: time ? localDay(time, salon.timezone) : undefined,
  });
  const hrefs = [serviceHref, staffHref, timeHref];

  const rows: SummaryRow[] = [];
  if (service && step >= 3) {
    rows.push({
      label: "Storitev",
      value: `${service.name} · ${formatDuration(service.duration_min)} · ${formatPrice(service.price_cents)}`,
      changeHref: serviceHref,
    });
    rows.push({
      label: "Zaposleni",
      value: staffMember?.name ?? "Kdorkoli prost",
      changeHref: staffHref,
    });
  }
  if (step === 4 && time) {
    rows.push({
      label: "Termin",
      value: `${formatWeekdayDate(time, salon.timezone)} ob ${formatTime(time, salon.timezone)}`,
      changeHref: timeHref,
    });
  }

  return (
    <div className="space-y-6">
      <Progress current={step} hrefs={hrefs} />

      {step > 1 && (
        <Link href={hrefs[step - 2]} className={backLink}>
          <span aria-hidden="true">←</span> Nazaj
        </Link>
      )}

      {/* Steps 1 and 2 have nothing worth summarising yet, so rows stay empty there. */}
      <SelectionSummary rows={rows} />

      {step === 1 && <ServiceStep services={services} />}
      {step === 2 && service && <StaffStep serviceId={service.id} staff={staffList} />}
      {step === 3 && service && staffParam && (
        <DateTimeStep
          salon={salon}
          service={service}
          staff={staffParam}
          monthParam={param("month")}
          dayParam={param("day")}
        />
      )}
      {step === 4 && service && staffParam && time && (
        <section className="space-y-4">
          <h1 className="text-title font-bold">Vaši podatki</h1>
          <BookingForm
            service={service.id}
            staff={staffParam}
            time={time}
            pickAnotherTimeHref={timeHref}
          />
        </section>
      )}
    </div>
  );
}
