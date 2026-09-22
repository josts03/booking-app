/**
 * Shared class strings and constants for the platform's own pages (marketing,
 * signup, sign-in). The salon pages have their own set in app/(salon) and the
 * admin in app/admin/_components/ui.ts. Values come from the tokens in
 * app/globals.css; nothing here hard-codes a color or a size.
 */

export const PRODUCT_NAME = "Termin";

/** Where the "start free" buttons lead. */
export const TRIAL_HREF = "/registracija";
export const SIGNIN_HREF = "/prijava";

const buttonBase =
  "inline-flex min-h-12 items-center justify-center rounded-control px-6 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const buttonPrimary = `${buttonBase} bg-brand text-brand-foreground hover:bg-brand-strong`;
export const buttonSecondary = `${buttonBase} border border-line bg-surface text-ink hover:border-ink-muted`;

export const card = "rounded-card border border-line bg-surface";

export const inputClass =
  "h-12 w-full rounded-control border border-line bg-surface px-3 text-base placeholder:text-ink-muted/60";

export const labelClass = "mb-1.5 block text-sm font-medium";

export const hintClass = "mt-1.5 text-sm text-ink-muted";

export const errorClass = "mt-1.5 text-sm font-medium text-danger";
