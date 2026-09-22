"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import {
  buttonPrimary,
  errorClass,
  hintClass,
  inputClass,
  labelClass,
  SIGNIN_HREF,
} from "../_components/ui";
import { checkSlug, signUp, type SignupField, type SignupFormState } from "./actions";
import { slugify } from "./slug";

type Availability = "idle" | "checking" | "free" | "taken";

/**
 * The signup form. The address (subdomain) follows the salon name until the
 * visitor edits it by hand, and is checked against the database while typing,
 * so nobody fills in the whole form only to be told the name is taken.
 *
 * `rootDomain` is the host salons live under ("domena.si", or "localhost:3000"
 * in development), used for the address preview.
 */
export function SignupForm({ rootDomain }: { rootDomain: string }) {
  const [state, action, pending] = useActionState<SignupFormState, FormData>(signUp, null);
  const ids = useId();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  /** The last answer from the server, together with the slug it was about. */
  const [checked, setChecked] = useState<{ slug: string; free: boolean } | null>(null);

  // Ask a moment after typing stops, never on every keystroke. The state is
  // only set from the reply, so a stale one cannot overwrite a newer answer.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkSlug(slug).then((free) => {
        if (!cancelled) setChecked({ slug, free });
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  // Derived, not stored: anything the answer does not cover is still "checking".
  const availability: Availability = !slug
    ? "idle"
    : checked?.slug === slug
      ? checked.free
        ? "free"
        : "taken"
      : "checking";

  if (state?.ok && state.slug) {
    const host = `${state.slug}.${rootDomain}`;
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <p className="text-lg font-bold">Salon je ustvarjen.</p>
        <p className="mt-2 text-ink-muted">Stran za naročanje je na naslovu:</p>
        <a
          href={`//${host}`}
          className="mt-3 block break-all font-medium text-brand-ink underline underline-offset-4"
        >
          {host}
        </a>
        <p className="mt-5 rounded-control bg-warning/10 p-3 text-sm text-warning">
          Faza 1: baze še ni, zato salon obstaja samo do ponovnega zagona
          strežnika. Ko bo baza priklopljena, bo vpis trajen.
        </p>
      </div>
    );
  }

  const errors = state?.errors ?? {};
  const previous = state?.values;

  function field(
    key: SignupField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
    hint?: string,
  ) {
    const error = errors[key];
    return (
      <div>
        <label className="block" htmlFor={`${key}-${ids}`}>
          <span className={labelClass}>{label}</span>
        </label>
        <input
          id={`${key}-${ids}`}
          name={key}
          defaultValue={previous?.[key] ?? ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${key}-error-${ids}` : hint ? `${key}-hint-${ids}` : undefined}
          className={`${inputClass} ${error ? "border-danger" : ""}`}
          {...props}
        />
        {error ? (
          <p id={`${key}-error-${ids}`} className={errorClass}>
            {error}
          </p>
        ) : (
          hint && (
            <p id={`${key}-hint-${ids}`} className={hintClass}>
              {hint}
            </p>
          )
        )}
      </div>
    );
  }

  const slugError = errors.slug;
  const slugNote =
    slugError ??
    (availability === "taken"
      ? "Ta naslov je že zaseden."
      : availability === "free"
        ? "Naslov je prost."
        : null);
  const slugNoteClass =
    slugError || availability === "taken"
      ? errorClass
      : availability === "free"
        ? "mt-1.5 text-sm font-medium text-success"
        : hintClass;

  return (
    <form action={action} noValidate className="space-y-5">
      <div>
        <label className="block" htmlFor={`name-${ids}`}>
          <span className={labelClass}>Ime salona</span>
        </label>
        <input
          id={`name-${ids}`}
          name="name"
          type="text"
          autoComplete="organization"
          required
          value={name || (previous?.name ?? "")}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
          aria-invalid={errors.name ? true : undefined}
          className={`${inputClass} ${errors.name ? "border-danger" : ""}`}
        />
        {errors.name && <p className={errorClass}>{errors.name}</p>}
      </div>

      <div>
        <label className="block" htmlFor={`slug-${ids}`}>
          <span className={labelClass}>Spletni naslov</span>
        </label>
        <div
          className={`flex items-center rounded-control border bg-surface ${
            slugError || availability === "taken" ? "border-danger" : "border-line"
          }`}
        >
          <input
            id={`slug-${ids}`}
            name="slug"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(slugify(event.target.value));
            }}
            aria-describedby={`slug-note-${ids}`}
            className="h-12 min-w-0 flex-1 rounded-l-control bg-transparent px-3 text-base"
          />
          <span className="shrink-0 pr-3 text-sm text-ink-muted">.{rootDomain}</span>
        </div>
        <p
          id={`slug-note-${ids}`}
          className={slugNote ? slugNoteClass : hintClass}
          role={availability === "taken" ? "alert" : undefined}
        >
          {slugNote ?? "Tu bodo stranke rezervirale termin."}
        </p>
      </div>

      {field("email", "E-naslov", {
        type: "email",
        autoComplete: "email",
        required: true,
      }, "Sem pošljemo potrditev in obvestila o rezervacijah.")}

      {field("phone", "Telefon (neobvezno)", {
        type: "tel",
        autoComplete: "tel",
      })}

      <button
        type="submit"
        disabled={pending || availability === "taken"}
        className={`${buttonPrimary} w-full`}
      >
        {pending ? "Ustvarjam …" : "Ustvari salon"}
      </button>

      {state?.message && !state.ok && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.message}
        </p>
      )}

      <p className="text-sm text-ink-muted">
        14 dni brezplačno, brez kartice. Že imate salon?{" "}
        <Link href={SIGNIN_HREF} className="font-medium text-brand-ink underline underline-offset-4">
          Prijavite se
        </Link>
        .
      </p>
    </form>
  );
}
