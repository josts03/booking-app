import { signOut } from "../actions";

/** Sign-out button, in the sidebar on desktop and the top bar on a phone. */
export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={`inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-ink-muted transition-colors hover:text-ink ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        Odjava
      </button>
    </form>
  );
}
