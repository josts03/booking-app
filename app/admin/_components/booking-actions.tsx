"use client";

import { useActionState, useState } from "react";
import type { BookingStatus } from "@/lib/types";
import { changeStatusAction, rescheduleAction, type BookingActionState } from "../koledar/actions";
import { buttonPrimary, buttonSecondary, inputClass } from "./ui";

export interface StatusAction {
  to: BookingStatus;
  label: string;
  /** Cancel and no-show ask "are you sure?" first. */
  confirm: boolean;
}

interface Props {
  bookingId: string;
  /** Computed on the server (lib/booking-status.ts) and checked there again. */
  actions: StatusAction[];
  /** Pending or confirmed: may be moved. */
  movable: boolean;
  /** The customer has an e-mail for this booking: offer to tell them. */
  hasEmail: boolean;
  view: "day" | "week";
  /** Current place of the booking, the starting values of the move form. */
  move: { date: string; time: string; staffId: string };
  /** Active staff who perform the booking's service. */
  staffOptions: { id: string; name: string }[];
}

const dangerButton =
  "inline-flex min-h-11 items-center justify-center rounded-button bg-danger px-5 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60";

function Message({ state }: { state: BookingActionState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

/**
 * The salon's buttons in a booking's sheet: status changes and moving it.
 * Every change is a server action that checks access and the rules itself;
 * this component only offers what the server will accept.
 */
export function BookingActions({ bookingId, actions, movable, hasEmail, view, move, staffOptions }: Props) {
  const [statusState, statusAction, statusPending] = useActionState<BookingActionState, FormData>(changeStatusAction, null);
  const [moveState, moveAction, movePending] = useActionState<BookingActionState, FormData>(rescheduleAction, null);
  const [asking, setAsking] = useState<StatusAction | null>(null);
  const [moving, setMoving] = useState(false);
  const [notify, setNotify] = useState(true);

  // After a status change went through, close the "are you sure?" panel.
  const [seenStatus, setSeenStatus] = useState<BookingActionState>(null);
  if (statusState !== seenStatus) {
    setSeenStatus(statusState);
    if (statusState?.ok) setAsking(null);
  }

  if (actions.length === 0 && !movable) {
    return statusState?.ok ? (
      <div className="mt-5 border-t border-line pt-4">
        <Message state={statusState} />
      </div>
    ) : null;
  }

  const notifyBox = hasEmail && (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="notify"
        checked={notify}
        onChange={(event) => setNotify(event.target.checked)}
        className="size-5 accent-brand"
      />
      Obvesti stranko po e-pošti
    </label>
  );
  const moveValues = moveState?.values;

  return (
    <div className="mt-5 space-y-4 border-t border-line pt-4">
      {actions.length > 0 && (
        <form action={statusAction} className="space-y-3">
          <input type="hidden" name="id" value={bookingId} />
          {asking ? (
            <div className="space-y-3 rounded-control border border-danger/30 bg-danger/5 p-3">
              <p className="font-medium">
                {asking.to === "cancelled" ? "Res odpovem ta termin?" : "Res označim, da stranka ni prišla?"}
              </p>
              {asking.to === "cancelled" && notifyBox}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setAsking(null)} className={buttonSecondary}>
                  Ne
                </button>
                <button type="submit" name="to" value={asking.to} disabled={statusPending} className={dangerButton}>
                  {statusPending ? "Shranjujem …" : `Da, ${asking.label.toLowerCase()}`}
                </button>
              </div>
            </div>
          ) : (
            <>
              {actions.some((a) => a.to === "confirmed") && notifyBox}
              <div className="grid grid-cols-2 gap-3">
                {actions.map((action) =>
                  action.confirm ? (
                    <button key={action.to} type="button" onClick={() => setAsking(action)} className={buttonSecondary}>
                      {action.label}
                    </button>
                  ) : (
                    <button
                      key={action.to}
                      type="submit"
                      name="to"
                      value={action.to}
                      disabled={statusPending}
                      className={action.to === "confirmed" || action.to === "completed" ? buttonPrimary : buttonSecondary}
                    >
                      {action.label}
                    </button>
                  ),
                )}
              </div>
            </>
          )}
          <Message state={statusState} />
        </form>
      )}

      {movable &&
        (moving ? (
          <form action={moveAction} className="space-y-3" noValidate>
            <input type="hidden" name="id" value={bookingId} />
            <input type="hidden" name="view" value={view} />
            <p className="font-semibold">Prestavi termin</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-muted">Dan</span>
                <input type="date" name="date" defaultValue={moveValues?.date ?? move.date} required className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-muted">Ura</span>
                <input type="time" name="time" step={300} defaultValue={moveValues?.time ?? move.time} required className={inputClass} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-muted">Zaposleni</span>
              <select name="staff" defaultValue={moveValues?.staff ?? move.staffId} className={inputClass}>
                {staffOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            {notifyBox}
            {moveState?.outsideHours ? (
              <div className="space-y-3 rounded-control border border-warning/40 bg-warning/10 p-3">
                <p className="font-medium text-warning">{moveState.message}</p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="submit" disabled={movePending} className={buttonSecondary}>
                    Preveri znova
                  </button>
                  <button type="submit" name="force" value="1" disabled={movePending} className={buttonPrimary}>
                    Vseeno prestavi
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Message state={moveState} />
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setMoving(false)} className={buttonSecondary}>
                    Prekliči
                  </button>
                  <button type="submit" disabled={movePending} className={buttonPrimary}>
                    {movePending ? "Prestavljam …" : "Prestavi"}
                  </button>
                </div>
              </>
            )}
          </form>
        ) : (
          <button type="button" onClick={() => setMoving(true)} className={`${buttonSecondary} w-full`}>
            Prestavi na drug čas ali zaposlenega
          </button>
        ))}
    </div>
  );
}
