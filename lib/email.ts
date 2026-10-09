/**
 * E-mail to customers: templates (confirmation, reminder, cancellation) and sending
 * through the Resend API with plain fetch (no library).
 *
 * - Subject contains the salon's name, the sender's display name is the salon,
 *   Reply-To is salons.email: a customer's reply goes straight to the salon.
 * - Every value that comes from the database is HTML-escaped, so a customer
 *   cannot put markup into an e-mail (first name "<a href=...>").
 * - Dates in Slovenian, in the salon's time zone (lib/format.ts, date-fns-tz).
 * - The cancel link is built from the salon's slug (lib/tenant.ts salonOrigin),
 *   never from a request header.
 * - Sending never throws and never logs an e-mail address or a name.
 */
import "server-only";
import { brandStyle } from "./brand";
import { canCancel, cancelDeadline } from "./cancel";
import { formatDateTime, formatPrice, formatTime, formatWeekdayDate } from "./format";
import { salonOrigin } from "./tenant";
import type { Booking, Salon } from "./types";

// ---------- templates ----------

export interface BookingEmailData {
  salon: Pick<
    Salon,
    "name" | "slug" | "email" | "phone" | "address" | "timezone" | "brand_color" | "cancel_window_hours"
  >;
  booking: Pick<Booking, "status" | "starts_at" | "ends_at" | "price_cents" | "cancel_token">;
  serviceName: string;
  staffName: string;
  customerFirstName: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Display name of the sender: the salon. */
  fromName: string;
  /** The salon's own address, or null if it has none. */
  replyTo: string | null;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** One line: no line breaks or control characters (they would break e-mail headers). */
function oneLine(value: string, max = 150): string {
  return value.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** "ponedeljek, 21. 9. 2026 ob 14:30" in the salon's time zone. */
function when(iso: string, timeZone: string): string {
  const day = formatWeekdayDate(iso, timeZone);
  return `${day.charAt(0).toLowerCase()}${day.slice(1)} ob ${formatTime(iso, timeZone)}`;
}

/** Only digits and a leading +, for a tel: link. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function cancelUrl(salonSlug: string, cancelToken: string): string {
  return `${salonOrigin(salonSlug)}/odpoved/${encodeURIComponent(cancelToken)}`;
}

interface Layout {
  subject: string;
  heading: string;
  lead: string;
  /**
   * "upcoming": how to cancel (a link until the deadline, then the salon's
   * phone). "cancelled": a link to book again.
   */
  kind: "upcoming" | "cancelled";
}

function render(data: BookingEmailData, layout: Layout, now: Date): RenderedEmail {
  const { salon, booking } = data;
  const tz = salon.timezone;
  const brand = brandStyle(salon.brand_color) as Record<string, string>;
  const color = { brand: brand["--brand"], onBrand: brand["--brand-foreground"], ink: brand["--brand-ink"] };
  const salonName = oneLine(salon.name, 100);
  const firstName = oneLine(data.customerFirstName, 60);

  const rows: [string, string][] = [
    ["Storitev", oneLine(data.serviceName)],
    ["Zaposleni", oneLine(data.staffName)],
    ["Termin", `${when(booking.starts_at, tz)}–${formatTime(booking.ends_at, tz)}`],
    ["Cena", formatPrice(booking.price_cents)],
  ];

  const phone = salon.phone ? oneLine(salon.phone, 40) : null;
  let link: string | null;
  let actionText: string;
  let button: { label: string; textLabel: string };
  if (layout.kind === "cancelled") {
    link = `${salonOrigin(salon.slug)}/rezervacija`;
    actionText = "Nov termin lahko kadar koli rezervirate na spletu.";
    button = { label: "Nova rezervacija", textLabel: "Nova rezervacija" };
  } else {
    link = canCancel(booking, salon.cancel_window_hours, now) ? cancelUrl(salon.slug, booking.cancel_token) : null;
    // "do 20. 9. 2026, 10:00": no weekday, which would need the genitive ("do nedelje").
    const deadline = formatDateTime(cancelDeadline(booking.starts_at, salon.cancel_window_hours).toISOString(), tz);
    actionText = link
      ? `Termin lahko odpoveste do ${deadline}.`
      : phone
        ? `Za odpoved ali spremembo pokličite salon na ${phone}.`
        : "Za odpoved ali spremembo se obrnite na salon.";
    button = { label: "Odpovej termin", textLabel: "Odpoved" };
  }
  const replyNote = salon.email ? " Na to sporočilo lahko odgovorite, odgovor prejme salon." : "";
  const footer = `To sporočilo ste prejeli, ker ste rezervirali termin pri salonu ${salonName}.${replyNote}`;

  // ---- plain text ----
  const text = [
    `Pozdravljeni, ${firstName}!`,
    "",
    layout.lead,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    actionText,
    ...(link ? [`${button.textLabel}: ${link}`] : []),
    "",
    salonName,
    ...(salon.address ? [oneLine(salon.address)] : []),
    ...(phone ? [`Telefon: ${phone}`] : []),
    "",
    footer,
  ].join("\n");

  // ---- HTML (tables and inline styles: what e-mail clients understand) ----
  const e = escapeHtml;
  const cell = "padding:8px 0;border-bottom:1px solid #e7e2db;font-size:15px;";
  const detailRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="${cell}color:#57534e;width:90px;vertical-align:top;">${e(label)}</td>` +
        `<td style="${cell}font-weight:600;">${e(value)}</td></tr>`,
    )
    .join("");
  const buttonHtml = link
    ? `<p style="margin:16px 0 0;"><a href="${e(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;` +
      `background:${color.brand};color:${color.onBrand};font-weight:600;text-decoration:none;">${e(button.label)}</a></p>`
    : "";
  const phoneHtml = phone
    ? `<br><a href="${e(telHref(phone))}" style="color:${color.ink};">${e(phone)}</a>`
    : "";

  const html = `<!doctype html>
<html lang="sl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(layout.subject)}</title></head>
<body style="margin:0;padding:0;background:#faf8f5;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e2db;border-top:6px solid ${color.brand};border-radius:12px;">
<tr><td style="padding:24px 24px 0;">
<p style="margin:0;font-size:14px;font-weight:700;color:${color.ink};">${e(salonName)}</p>
<h1 style="margin:8px 0 16px;font-size:22px;line-height:1.3;">${e(layout.heading)}</h1>
<p style="margin:0 0 8px;font-size:15px;">Pozdravljeni, ${e(firstName)}!</p>
<p style="margin:0 0 16px;font-size:15px;">${e(layout.lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>
<p style="margin:16px 0 0;font-size:15px;">${e(actionText)}</p>
${buttonHtml}
<p style="margin:24px 0;font-size:14px;color:#57534e;"><strong style="color:#1c1917;">${e(salonName)}</strong>${salon.address ? `<br>${e(oneLine(salon.address))}` : ""}${phoneHtml}</p>
</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#57534e;">${e(footer)}</p>
</td></tr></table>
</body>
</html>`;

  return { subject: oneLine(layout.subject, 200), html, text, fromName: salonName, replyTo: salon.email ? oneLine(salon.email, 254) : null };
}

/** Right after booking. A pending booking (salon confirms by hand) says so. */
export function confirmationEmail(data: BookingEmailData, now: Date): RenderedEmail {
  const salonName = oneLine(data.salon.name, 100);
  const pending = data.booking.status === "pending";
  return render(
    data,
    pending
      ? {
          subject: `Prejeli smo vaš zahtevek za termin – ${salonName}`,
          heading: "Zahtevek za termin je oddan",
          lead: "Vaš zahtevek smo prejeli. Salon vam bo termin še potrdil.",
          kind: "upcoming",
        }
      : {
          subject: `Potrditev termina – ${salonName}`,
          heading: "Termin je rezerviran",
          lead: "Vaš termin je potrjen. Veselimo se vašega obiska.",
          kind: "upcoming",
        },
    now,
  );
}

/** Some hours before the appointment (sent by the reminders cron, week 11). */
export function reminderEmail(data: BookingEmailData, now: Date): RenderedEmail {
  const salonName = oneLine(data.salon.name, 100);
  const start = when(data.booking.starts_at, data.salon.timezone);
  return render(
    data,
    {
      subject: `Opomnik: ${start} – ${salonName}`,
      heading: "Opomnik na vaš termin",
      lead: `Spomnimo vas na vaš termin: ${start}.`,
      kind: "upcoming",
    },
    now,
  );
}

/** Right after the customer cancelled online: what was cancelled, and where to book again. */
export function cancellationEmail(data: BookingEmailData, now: Date): RenderedEmail {
  const salonName = oneLine(data.salon.name, 100);
  return render(
    data,
    {
      subject: `Termin je odpovedan – ${salonName}`,
      heading: "Termin je odpovedan",
      lead: "Vaš termin je odpovedan. Hvala, ker ste nam sporočili.",
      kind: "cancelled",
    },
    now,
  );
}

// ---------- sending (Resend) ----------

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  /** Same key = Resend sends at most once (24 h), e.g. "confirmation:<booking id>". */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not-configured" | "failed" };

export interface SendDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
const defaultDeps: SendDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** "Termin <obvestila@domena.si>" or "obvestila@domena.si" -> "obvestila@domena.si" */
function addressOf(from: string): string | null {
  const address = (from.match(/<([^<>\s]+@[^<>\s]+)>\s*$/)?.[1] ?? from).trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address) ? address : null;
}

/** RFC 5322 display name without anything that needs quoting tricks. */
function displayName(name: string): string {
  return oneLine(name, 70).replace(/["\\<>,;:]/g, "").trim();
}

/** Both RESEND_API_KEY and a valid EMAIL_FROM are set. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY) && addressOf(process.env.EMAIL_FROM ?? "") !== null;
}

/**
 * Sends one e-mail. One retry for a network error, a timeout, 429 or 5xx (with
 * the same idempotency key, so the customer never gets it twice). Returns,
 * never throws.
 */
export async function sendEmail(message: OutgoingEmail, deps: SendDeps = defaultDeps): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = addressOf(process.env.EMAIL_FROM ?? "");
  if (!apiKey || !from) {
    console.warn("[email] RESEND_API_KEY or EMAIL_FROM is not set: e-mail not sent");
    return { ok: false, reason: "not-configured" };
  }

  const name = displayName(message.fromName);
  const body = JSON.stringify({
    from: name ? `${name} <${from}>` : from,
    to: [message.to],
    subject: oneLine(message.subject, 200),
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    let status = 0;
    try {
      const response = await deps.fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey.slice(0, 256),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      status = response.status;
      if (response.ok) {
        const json = (await response.json().catch(() => null)) as { id?: unknown } | null;
        if (typeof json?.id === "string") return { ok: true, id: json.id };
        console.error("[email] Resend answered without an id");
        return { ok: false, reason: "failed" };
      }
      // Resend's error name (e.g. "validation_error"), never its message: it can contain the address.
      const json = (await response.json().catch(() => null)) as { name?: unknown } | null;
      console.error(`[email] send failed: ${status} ${typeof json?.name === "string" ? json.name : ""}`);
    } catch (error) {
      console.error(`[email] send failed: ${error instanceof Error ? error.name : "network error"}`);
    }
    const retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || attempt === 2) break;
    await deps.sleep(1_000);
  }
  return { ok: false, reason: "failed" };
}
