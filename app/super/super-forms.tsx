"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUSES } from "@/lib/super-admin";
import type { SubscriptionStatus } from "@/lib/types";
import { buttonPrimary, buttonSecondary, card, inputClass } from "../admin/_components/ui";
import { createSalonAction, setStatusAction, type SuperState } from "./actions";

function Message({ state }: { state: SuperState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

/** Switching a salon on or off. Each option says whether the booking page works. */
export function StatusForm({ salonId, salonName, status }: { salonId: string; salonName: string; status: SubscriptionStatus }) {
  const [state, action, pending] = useActionState<SuperState, FormData>(setStatusAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={salonId} />
      <div className="flex gap-2">
        <label htmlFor={`status-${salonId}`} className="sr-only">
          Status salona {salonName}
        </label>
        <select id={`status-${salonId}`} name="status" defaultValue={status} className={inputClass}>
          {SUBSCRIPTION_STATUSES.map((option) => {
            const { label, bookable } = SUBSCRIPTION_STATUS_LABELS[option];
            return (
              <option key={option} value={option}>
                {label} ({bookable ? "naročanje deluje" : "naročanje ne deluje"})
              </option>
            );
          })}
        </select>
        <button type="submit" disabled={pending} className={`${buttonSecondary} shrink-0`}>
          {pending ? "Shranjujem …" : "Shrani"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

/** "Frizerstvo Čarovnija" -> "frizerstvo-carovnija" (only a suggestion; the owner of the platform may change it). */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function NewSalonForm({ domain }: { domain: string }) {
  const [state, action, pending] = useActionState<SuperState, FormData>(createSalonAction, null);
  const values = state?.values;
  const errors = state?.errors ?? {};
  const [name, setName] = useState(values?.name ?? "");
  const [slug, setSlug] = useState(values?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(values?.slug));

  if (state?.ok) {
    return (
      <div className={`${card} space-y-4 p-4`}>
        <Message state={state} />
        <Link href="/super" className={`${buttonPrimary} w-full sm:w-auto`}>
          Nazaj na seznam salonov
        </Link>
      </div>
    );
  }

  const fieldClass = (key: string) => `${inputClass} ${errors[key] ? "border-danger" : ""}`;
  const error = (key: string) => errors[key] && <p className="mt-1 text-xs text-danger">{errors[key]}</p>;

  return (
    <form action={action} noValidate className={`${card} space-y-4 p-4`}>
      <div>
        <label htmlFor="salon-name" className="mb-1 block text-sm font-medium">
          Ime salona
        </label>
        <input
          id="salon-name"
          name="name"
          type="text"
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(suggestSlug(event.target.value));
          }}
          aria-invalid={errors.name ? true : undefined}
          className={fieldClass("name")}
        />
        {error("name")}
      </div>
      <div>
        <label htmlFor="salon-slug" className="mb-1 block text-sm font-medium">
          Poddomena
        </label>
        <div className="flex items-center gap-2">
          <input
            id="salon-slug"
            name="slug"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugEdited(true);
            }}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby="salon-slug-help"
            className={fieldClass("slug")}
          />
          <span className="shrink-0 text-sm text-ink-muted">.{domain}</span>
        </div>
        <p id="salon-slug-help" className="mt-1 text-xs text-ink-muted">
          Male črke, številke in vezaj. Kasneje je ni mogoče spremeniti.
        </p>
        {error("slug")}
      </div>
      <div>
        <label htmlFor="owner-email" className="mb-1 block text-sm font-medium">
          E-naslov lastnika salona
        </label>
        <input
          id="owner-email"
          name="owner_email"
          type="email"
          inputMode="email"
          autoComplete="off"
          defaultValue={values?.owner_email ?? ""}
          aria-invalid={errors.owner_email ? true : undefined}
          className={fieldClass("owner_email")}
        />
        {error("owner_email")}
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Ustvarjam …" : "Ustvari salon in pošlji vabilo"}
      </button>
    </form>
  );
}
