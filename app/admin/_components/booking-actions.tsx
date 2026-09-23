"use client";

import { useActionState, useId, useState } from "react";
import {
  ALLOWED_STATUS,
  STATUS_ACTION,
  STATUS_IS_DESTRUCTIVE,
} from "@/lib/booking-status";
import type { Booking, BookingStatus } from "@/lib/types";
import {
  changeBookingStatus,
  saveInternalNote,
  type BookingActionState,
} from "../koledar/actions";
import { buttonPrimary, buttonSecondary, inputClass } from "./ui";

const destructiveButton =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-danger px-4 text-sm font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60";

/**
 * What the salon can do with a booking: move it to another status, and keep a
 * private note on it.
 *
 * Which buttons appear comes from ALLOWED_STATUS in lib/booking-status.ts — the
 * same map the server checks — so a button is never offered for a move the
 * server would refuse. Cancelling and marking a no-show ask twice, because both
 * are final and one of them frees the slot for someone else.
 */
export function BookingActions({ booking }: { booking: Booking }) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    changeBookingStatus,
    null,
  );
  const [noteState, noteAction, notePending] = useActionState<BookingActionState, FormData>(
    saveInternalNote,
    null,
  );
  const ids = useId();
  const [confirming, setConfirming] = useState<BookingStatus | null>(null);

  const next = ALLOWED_STATUS[booking.status];

  return (
    <div className="mt-5 space-y-4">
      {next.length > 0 && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={booking.id} />

          {confirming ? (
            <div className="rounded-control border border-line bg-canvas p-3">
              <p className="text-sm font-medium">
                {confirming === "cancelled"
                  ? "Res odpovem ta termin? Termin se sprosti za druge stranke."
                  : "Označim, da stranka ni prišla?"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="submit"
                  name="status"
                  value={confirming}
                  disabled={pending}
                  className={destructiveButton}
                >
                  {pending ? "Shranjujem …" : `Da, ${STATUS_ACTION[confirming].toLowerCase()}`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  disabled={pending}
                  className={buttonSecondary}
                >
                  Ne
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {next.map((status) =>
                STATUS_IS_DESTRUCTIVE[status] ? (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setConfirming(status)}
                    disabled={pending}
                    className={destructiveButton}
                  >
                    {STATUS_ACTION[status]}
                  </button>
                ) : (
                  <button
                    key={status}
                    type="submit"
                    name="status"
                    value={status}
                    disabled={pending}
                    className={buttonPrimary}
                  >
                    {pending ? "Shranjujem …" : STATUS_ACTION[status]}
                  </button>
                ),
              )}
            </div>
          )}

          {state && !state.ok && (
            <p role="alert" className="text-sm font-medium text-danger">
              {state.message}
            </p>
          )}
        </form>
      )}

      <form action={noteAction} className="space-y-2">
        <input type="hidden" name="id" value={booking.id} />
        <label htmlFor={`note-${ids}`} className="block text-xs font-medium uppercase tracking-wide text-ink-muted">
          Interni zaznamek
        </label>
        <textarea
          id={`note-${ids}`}
          name="internal_note"
          rows={2}
          maxLength={2000}
          defaultValue={booking.internal_note ?? ""}
          placeholder="Vidi samo salon."
          className={`${inputClass} h-auto py-2`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={notePending} className={buttonSecondary}>
            {notePending ? "Shranjujem …" : "Shrani zaznamek"}
          </button>
          {noteState && (
            <p
              role="status"
              className={`text-sm font-medium ${noteState.ok ? "text-success" : "text-danger"}`}
            >
              {noteState.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
