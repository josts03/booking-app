/** Shared class strings for the salon pages. Values come from the tokens in app/globals.css. */

const button =
  "inline-flex min-h-12 items-center justify-center rounded-control px-6 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const buttonPrimary = `${button} bg-brand text-brand-foreground hover:bg-brand-strong`;
export const buttonSecondary = `${button} border border-line bg-surface text-ink hover:border-ink-muted`;

/** A whole-card link used to pick a service or a staff member. */
export const choiceCard =
  "flex min-h-16 items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-brand active:bg-brand-soft";

export const backLink =
  "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink";
