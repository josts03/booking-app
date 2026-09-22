"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/admin/koledar",
    label: "Koledar",
    icon: "M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  },
  {
    href: "/admin/storitve",
    label: "Storitve",
    icon: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
  },
  {
    href: "/admin/zaposleni",
    label: "Zaposleni",
    icon: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.15a3.5 3.5 0 0 1 0 6.7",
  },
  {
    href: "/admin/stranke",
    label: "Stranke",
    icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0",
  },
  {
    href: "/admin/analitika",
    label: "Analitika",
    icon: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  },
  {
    href: "/admin/nastavitve",
    label: "Nastavitve",
    icon: "M21 4h-7M10 4H3m18 8h-9M8 12H3m18 8h-5m-4 0H3M14 2v4M8 10v4M16 18v4",
  },
];

/**
 * Main navigation. `bottom` is the phone version (fixed tab bar under the
 * thumb), `side` the desktop sidebar. Same links, different layout.
 */
export function AdminNav({ variant }: { variant: "bottom" | "side" }) {
  const pathname = usePathname();

  const list =
    variant === "bottom"
      ? "grid grid-cols-6"
      : "flex flex-col gap-1";
  const item =
    variant === "bottom"
      ? "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10px] leading-tight font-medium"
      : "flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium";

  return (
    <nav aria-label="Glavni meni">
      <ul className={list}>
        {items.map((entry) => {
          const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
          const color = active
            ? variant === "bottom"
              ? "text-brand-ink"
              : "bg-brand-soft text-brand-ink"
            : "text-ink-muted hover:text-ink";
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={`${item} ${color}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-6 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={entry.icon} />
                </svg>
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
