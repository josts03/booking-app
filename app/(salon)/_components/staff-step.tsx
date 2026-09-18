import Link from "next/link";
import { safeColor } from "@/lib/brand";
import type { Staff } from "@/lib/types";
import { flowHref } from "./flow-url";
import { choiceCard } from "./ui";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/** Step 2: staff who perform the chosen service, plus "anyone available". */
export function StaffStep({ serviceId, staff }: { serviceId: string; staff: Staff[] }) {
  if (staff.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-title font-bold">Izberite zaposlenega</h1>
        <p className="rounded-card border border-line bg-surface p-5 text-ink-muted">
          Te storitve trenutno ni mogoče naročiti prek spleta. Izberite drugo storitev ali pokličite
          salon.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-title font-bold">Izberite zaposlenega</h1>
      <ul className="space-y-3">
        <li>
          <Link href={flowHref({ service: serviceId, staff: "any" })} className={choiceCard}>
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.15a3.5 3.5 0 0 1 0 6.7" />
              </svg>
            </span>
            <span>
              <span className="block font-semibold">Kdorkoli prost</span>
              <span className="mt-0.5 block text-sm text-ink-muted">
                Prikažemo vse proste termine
              </span>
            </span>
          </Link>
        </li>
        {staff.map((member) => (
          <li key={member.id}>
            <Link href={flowHref({ service: serviceId, staff: member.id })} className={choiceCard}>
              <span
                aria-hidden="true"
                style={{ borderColor: safeColor(member.color) }}
                className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 bg-brand-soft font-semibold text-brand-ink"
              >
                {initials(member.name)}
              </span>
              <span className="font-semibold">{member.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
