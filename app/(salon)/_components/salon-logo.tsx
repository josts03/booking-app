import type { Salon } from "@/lib/types";

/** The salon's logo from salons.logo_url, or its initials on the brand color. */
export function SalonLogo({ salon }: { salon: Pick<Salon, "name" | "logo_url"> }) {
  if (salon.logo_url) {
    // Plain <img>: logo hosts are not known at build time, so next/image cannot be configured.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={salon.logo_url} alt="" className="size-10 shrink-0 rounded-full object-cover" />;
  }

  const initials = salon.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground"
    >
      {initials}
    </span>
  );
}
