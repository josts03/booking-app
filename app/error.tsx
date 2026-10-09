"use client"; // Error boundaries must be Client Components

/**
 * Shown when a page fails, for example when the database cannot be reached.
 * A friendly sentence only (CLAUDE.md): the details are in the server log, and
 * in production Next.js does not send the error message to the browser anyway.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-gutter text-center">
      <h1 className="text-2xl font-bold">Nekaj se je zalomilo</h1>
      <p className="mt-3 text-ink-muted">
        Stran se trenutno ne more naložiti. Poskusite znova čez trenutek.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-control bg-brand px-6 font-semibold text-brand-foreground hover:bg-brand-strong"
      >
        Poskusi znova
      </button>
      {error.digest && <p className="mt-6 text-xs text-ink-muted">Koda napake: {error.digest}</p>}
    </main>
  );
}
