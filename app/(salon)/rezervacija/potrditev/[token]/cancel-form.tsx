"use client";

import { useActionState, useState } from "react";
import { buttonSecondary } from "../../../_components/ui";
import { cancelBooking, type CancelState } from "./actions";

/**
 * "Cancel this booking", in two steps.
 *
 * The second step is not decoration: this page is opened from a link in an
 * e-mail, and mail clients happily prefetch links. Cancelling has to take a
 * deliberate second click, which a prefetcher never makes.
 */
export function CancelForm({ token, windowHours }: { token: string; windowHours: number }) {
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelBooking, null);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${buttonSecondary} w-full`}
        >
          Odpovej termin
        </button>
        {state?.error && (
          <p role="alert" className="text-center text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-card border border-line bg-surface p-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-center font-medium">Res želite odpovedati ta termin?</p>
      <p className="text-center text-sm text-ink-muted">
        Termin bo sproščen za druge stranke. Odpoved je mogoča do {windowHours} ur pred začetkom.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-danger px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Odpovedujem …" : "Da, odpovej"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={`${buttonSecondary} w-full`}
        >
          Ne, obdrži
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="text-center text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
