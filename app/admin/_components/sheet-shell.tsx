"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A bottom sheet on phones, a centered dialog on larger screens. Its open
 * state is the URL: closing means going to `closeHref`, so it also works
 * with the back button. Escape closes it, the page behind does not scroll.
 */
export function SheetShell({
  closeHref,
  titleId,
  children,
}: {
  closeHref: string;
  titleId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push(closeHref);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-50">
      <Link href={closeHref} aria-label="Zapri podrobnosti" className="absolute inset-0 bg-ink/40" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-card bg-surface p-5 pb-8 shadow-card outline-none md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[28rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:pb-5"
      >
        {children}
      </div>
    </div>
  );
}
