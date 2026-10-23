"use client";

import { useActionState } from "react";
import { cancelBookingAction, type CancelState } from "./actions";

const dangerButton =
  "inline-flex min-h-12 w-full items-center justify-center rounded-button bg-danger px-7 font-medium text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60";

/** A POST with a button: opening the link alone (or a mail scanner) never cancels. */
export function CancelForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<CancelState, FormData>(cancelBookingAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state?.message && (
        <div role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-4 text-danger">
          {state.message}
        </div>
      )}
      <button type="submit" disabled={pending} className={dangerButton}>
        {pending ? "Odpovedujem …" : "Da, odpovej termin"}
      </button>
    </form>
  );
}
