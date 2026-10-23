"use client";

import { useActionState, useState } from "react";
import { anonymizeAction, saveNoteAction, type CustomerState } from "../actions";
import { buttonSecondary, card, inputClass } from "../../_components/ui";

const NOTE_MAX = 1000; // CUSTOMER_NOTE_MAX in lib/data.ts (a client file cannot import it)

const dangerButton =
  "inline-flex min-h-11 items-center justify-center rounded-button bg-danger px-5 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60";

function Message({ state }: { state: CustomerState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

/** The salon's internal note. The customer never sees it. */
export function NoteForm({ customerId, note }: { customerId: string; note: string }) {
  const [state, action, pending] = useActionState<CustomerState, FormData>(saveNoteAction, null);
  return (
    <form action={action} className={`${card} space-y-2 p-4`}>
      <input type="hidden" name="id" value={customerId} />
      <label htmlFor="customer-notes" className="block font-semibold">
        Interna opomba
      </label>
      <textarea
        id="customer-notes"
        name="notes"
        rows={3}
        maxLength={NOTE_MAX}
        defaultValue={state?.values?.notes ?? note}
        placeholder="npr. Alergija na amoniak. Raje ima termine zjutraj."
        className={`${inputClass} h-auto py-2`}
      />
      <p className="text-xs text-ink-muted">Vidi jo samo salon, stranka nikoli.</p>
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full sm:w-auto`}>
        {pending ? "Shranjujem …" : "Shrani opombo"}
      </button>
    </form>
  );
}

/** GDPR erasure. Irreversible, so it asks first and says exactly what happens. */
export function AnonymizeForm({ customerId, name }: { customerId: string; name: string }) {
  const [state, action, pending] = useActionState<CustomerState, FormData>(anonymizeAction, null);
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setAsking(true)} className={`${buttonSecondary} w-full text-danger sm:w-auto`}>
          Anonimiziraj stranko
        </button>
        <Message state={state} />
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-control border border-danger/30 bg-danger/5 p-3">
      <input type="hidden" name="id" value={customerId} />
      <p className="font-medium">Res izbrišem osebne podatke stranke {name}?</p>
      <p className="text-sm text-ink-muted">
        Ime, telefon, e-pošta in opombe bodo izbrisani za vedno. Termini ostanejo v analitiki, brez imena. Tega ni mogoče
        razveljaviti.
      </p>
      <Message state={state} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setAsking(false)} className={buttonSecondary}>
          Ne
        </button>
        <button type="submit" disabled={pending} className={dangerButton}>
          {pending ? "Brišem …" : "Da, anonimiziraj"}
        </button>
      </div>
    </form>
  );
}
