/** Shared class strings for the admin area. Values come from the tokens in app/globals.css. */

const button =
  "inline-flex min-h-11 items-center justify-center rounded-control px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const buttonPrimary = `${button} bg-brand text-brand-foreground hover:bg-brand-strong`;
export const buttonSecondary = `${button} border border-line bg-surface text-ink hover:border-ink-muted`;

export const card = "rounded-card border border-line bg-surface";

export const inputClass =
  "h-11 w-full rounded-control border border-line bg-surface px-3 text-base placeholder:text-ink-muted/60";

export const pageTitle = "text-2xl font-bold tracking-tight";

export const backLink =
  "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink";
