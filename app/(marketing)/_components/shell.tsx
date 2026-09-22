import Link from "next/link";
import { PRODUCT_NAME } from "./ui";

/**
 * Frame for the platform's narrow form pages (signup, sign-in): wordmark on
 * top, one centred column, small print at the bottom. The marketing home page
 * is wide and builds its own layout.
 */
export function FormShell({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-gutter">
        <div className="mx-auto flex h-16 max-w-page items-center">
          <Link href="/" className="text-xl font-bold tracking-tight">
            {PRODUCT_NAME}
          </Link>
        </div>
      </header>

      <main className="flex-1 px-gutter py-10 sm:py-16">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-title font-bold text-balance">{title}</h1>
          {lead && <p className="mt-3 text-lead text-ink-muted">{lead}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>

      <footer className="px-gutter py-6 text-sm text-ink-muted">
        <div className="mx-auto max-w-page">© {PRODUCT_NAME}</div>
      </footer>
    </div>
  );
}
