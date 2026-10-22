import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildFixtures } from "./fixtures";
import {
  cancellationEmail,
  cancelUrl,
  confirmationEmail,
  escapeHtml,
  reminderEmail,
  rescheduleEmail,
  salonInviteEmail,
  sendEmail,
  type BookingEmailData,
  type OutgoingEmail,
  type SendDeps,
} from "./email";

// Wednesday 16. 9. 2026: the first fixture booking is next Monday, 21. 9. 2026 at 10:00.
const NOW = new Date("2026-09-16T08:00:00Z");
const f = buildFixtures(NOW);
const salon = f.salons[0];
const booking = f.bookings[0];

function emailData(overrides: Partial<BookingEmailData> = {}): BookingEmailData {
  return {
    salon,
    booking,
    serviceName: f.services.find((s) => s.id === booking.service_id)!.name,
    staffName: f.staff.find((s) => s.id === booking.staff_id)!.name,
    customerFirstName: f.customers.find((c) => c.id === booking.customer_id)!.first_name,
    ...overrides,
  };
}

const env = process.env as Record<string, string | undefined>;
const savedEnv = { ...env };
beforeEach(() => {
  delete env.ROOT_DOMAIN;
  env.NODE_ENV = "test";
});
afterEach(() => {
  for (const key of Object.keys(env)) if (!(key in savedEnv)) delete env[key];
  Object.assign(env, savedEnv);
});

describe("confirmationEmail", () => {
  test("subject has the salon's name, Reply-To is the salon, sender name is the salon", () => {
    const email = confirmationEmail(emailData(), NOW);
    assert.equal(email.subject, "Potrditev termina – Frizerstvo Test");
    assert.equal(email.replyTo, salon.email);
    assert.equal(email.fromName, "Frizerstvo Test");
  });

  test("date and time in Slovenian, in the salon's time zone", () => {
    const email = confirmationEmail(emailData(), NOW);
    assert.match(email.text, /Termin: ponedeljek, 21\. 9\. 2026 ob 10:00–10:45/);
    assert.match(email.html, /ponedeljek, 21\. 9\. 2026 ob 10:00–10:45/);
    assert.match(email.text, /Cena: 32 €/);
  });

  test("cancel link to the salon's own page, with the deadline", () => {
    const email = confirmationEmail(emailData(), NOW);
    const link = `http://test.localhost:3000/odpoved/${booking.cancel_token}`;
    assert.equal(cancelUrl(salon.slug, booking.cancel_token), link);
    assert.ok(email.text.includes(`Odpoved: ${link}`));
    assert.ok(email.html.includes(`href="${link}"`));
    assert.match(email.text, /Termin lahko odpoveste do 20\. 9\. 2026, 10:00\./);
  });

  test("with ROOT_DOMAIN the link is https on the salon's subdomain", () => {
    env.ROOT_DOMAIN = "domena.si";
    const email = confirmationEmail(emailData(), NOW);
    assert.ok(email.text.includes(`https://test.domena.si/odpoved/${booking.cancel_token}`));
  });

  test("inside the cancel window: no link, the salon's phone instead", () => {
    const late = new Date(Date.parse(booking.starts_at) - 3 * 3_600_000);
    const email = confirmationEmail(emailData(), late);
    assert.ok(!email.text.includes("/odpoved/"));
    assert.ok(!email.html.includes("/odpoved/"));
    assert.match(email.text, /pokličite salon na 01 234 56 78/);
    assert.ok(email.html.includes('href="tel:012345678"'));
  });

  test("a pending booking says the salon still has to confirm it", () => {
    const email = confirmationEmail(emailData({ booking: { ...booking, status: "pending" } }), NOW);
    assert.equal(email.subject, "Prejeli smo vaš zahtevek za termin – Frizerstvo Test");
    assert.match(email.text, /Salon vam bo termin še potrdil/);
  });

  test("a salon without e-mail: no Reply-To and no promise that replies arrive", () => {
    const email = confirmationEmail(emailData({ salon: { ...salon, email: null } }), NOW);
    assert.equal(email.replyTo, null);
    assert.ok(!email.text.includes("lahko odgovorite"));
  });

  test("names cannot put markup into the e-mail or break its headers", () => {
    const email = confirmationEmail(
      emailData({
        customerFirstName: '<a href="https://evil.example">Klikni</a>',
        salon: { ...salon, name: 'Salon "A&B"\r\nBcc: x@evil.example' },
      }),
      NOW,
    );
    assert.ok(!email.html.includes("<a href=\"https://evil.example\""));
    assert.ok(email.html.includes("&lt;a href=&quot;https://evil.example&quot;&gt;Klikni&lt;/a&gt;"));
    assert.ok(email.html.includes("Salon &quot;A&amp;B&quot;"));
    assert.ok(!/[\r\n]/.test(email.subject));
    assert.ok(!/[\r\n]/.test(email.fromName));
  });

  test("the plain-text version has no HTML", () => {
    assert.ok(!/<[a-z]/i.test(confirmationEmail(emailData(), NOW).text));
  });

  test("a junk brand color never reaches the HTML", () => {
    const email = confirmationEmail(emailData({ salon: { ...salon, brand_color: "red;background:url(x)" } }), NOW);
    assert.ok(!email.html.includes("url(x)"));
  });
});

describe("reminderEmail", () => {
  test("subject: when and which salon", () => {
    const email = reminderEmail(emailData(), NOW);
    assert.equal(email.subject, "Opomnik: ponedeljek, 21. 9. 2026 ob 10:00 – Frizerstvo Test");
    assert.equal(email.replyTo, salon.email);
  });

  test("24 hours before, with a 24-hour window: cancelling online is over", () => {
    const dayBefore = new Date(Date.parse(booking.starts_at) - 24 * 3_600_000);
    const email = reminderEmail(emailData(), dayBefore);
    assert.ok(!email.text.includes("/odpoved/"));
    assert.match(email.text, /pokličite salon/);
  });
});

describe("cancellationEmail", () => {
  const cancelled = { ...booking, status: "cancelled" as const };

  test("subject has the salon's name, Reply-To is the salon", () => {
    const email = cancellationEmail(emailData({ booking: cancelled }), NOW);
    assert.equal(email.subject, "Termin je odpovedan – Frizerstvo Test");
    assert.equal(email.replyTo, salon.email);
    assert.match(email.text, /Vaš termin je odpovedan/);
  });

  test("names the cancelled time, offers to book again, no cancel link", () => {
    const email = cancellationEmail(emailData({ booking: cancelled }), NOW);
    assert.match(email.text, /Termin: ponedeljek, 21\. 9\. 2026 ob 10:00–10:45/);
    assert.ok(email.text.includes("Nova rezervacija: http://test.localhost:3000/rezervacija"));
    assert.ok(email.html.includes('href="http://test.localhost:3000/rezervacija"'));
    assert.ok(!email.text.includes("/odpoved/"));
    assert.ok(!email.html.includes("/odpoved/"));
    assert.ok(!email.text.includes("pokličite salon"));
  });
});

describe("salon's own actions", () => {
  test("rescheduleEmail: the new time, the salon's name, still a cancel link", () => {
    const moved = { ...booking, starts_at: "2026-09-22T12:00:00.000Z", ends_at: "2026-09-22T12:30:00.000Z" };
    const email = rescheduleEmail(emailData({ booking: moved, staffName: "Luka Kovač" }), NOW);
    assert.equal(email.subject, "Termin je prestavljen – Frizerstvo Test");
    assert.match(email.text, /Salon je vaš termin prestavil/);
    assert.match(email.text, /Termin: torek, 22\. 9\. 2026 ob 14:00–14:30/);
    assert.match(email.text, /Zaposleni: Luka Kovač/);
    assert.ok(email.text.includes(`/odpoved/${booking.cancel_token}`));
  });

  test("cancellationEmail by the salon: says so and apologises; no thanks for telling us", () => {
    const email = cancellationEmail(emailData({ booking: { ...booking, status: "cancelled" } }), NOW, "salon");
    assert.equal(email.subject, "Termin je odpovedan – Frizerstvo Test");
    assert.match(email.text, /Salon je odpovedal vaš termin/);
    assert.ok(!email.text.includes("Hvala, ker ste nam sporočili"));
    assert.ok(email.text.includes("Nova rezervacija: http://test.localhost:3000/rezervacija"));
  });
});

test("007: the salon's own sentence is in confirmations and reminders, escaped, not in a cancellation", () => {
  const withNote = { ...salon, confirmation_note: "Parkirate lahko za hišo <b>A</b>." };
  const confirmation = confirmationEmail(emailData({ salon: withNote }), NOW);
  assert.ok(confirmation.text.includes("Parkirate lahko za hišo <b>A</b>."));
  assert.ok(confirmation.html.includes("Parkirate lahko za hišo &lt;b&gt;A&lt;/b&gt;."));
  assert.ok(reminderEmail(emailData({ salon: withNote }), NOW).text.includes("Parkirate lahko za hišo"));
  const cancelled = cancellationEmail(emailData({ salon: withNote, booking: { ...booking, status: "cancelled" } }), NOW);
  assert.ok(!cancelled.text.includes("Parkirate"));
});

describe("salonInviteEmail (/super, a new salon's first user)", () => {
  const invite = { salonName: "Studio <b>Lepota</b>", salonSlug: "lepota", ownerEmail: "lastnica@example.com", replyTo: "platforma@example.com" };

  test("a new account: a one-time link to /novo-geslo on the salon's own address", () => {
    const email = salonInviteEmail({ ...invite, setPasswordToken: "abc123_-x" });
    const link = "http://lepota.localhost:3000/novo-geslo?token_hash=abc123_-x&type=recovery";
    assert.equal(email.subject, "Vabilo: spletno naročanje za Studio <b>Lepota</b>");
    assert.ok(email.text.includes(`Nastavite geslo: ${link}`));
    assert.ok(email.html.includes(`href="${link.replace(/&/g, "&amp;")}"`));
    assert.match(email.text, /pozabljeno-geslo in vpišite lastnica@example\.com/);
    assert.equal(email.fromName, "Termin");
    assert.equal(email.replyTo, "platforma@example.com");
  });

  test("an existing account: told to sign in, no token", () => {
    const email = salonInviteEmail({ ...invite, setPasswordToken: null });
    assert.equal(email.subject, "Dostop do salona Studio <b>Lepota</b>");
    assert.ok(email.text.includes("Prijava: http://lepota.localhost:3000/prijava"));
    assert.ok(!email.text.includes("token_hash"));
  });

  test("the salon's name is escaped in HTML; the token is URL-encoded", () => {
    const email = salonInviteEmail({ ...invite, setPasswordToken: "a&b" });
    assert.ok(!email.html.includes("<b>Lepota</b>"));
    assert.ok(email.html.includes("Studio &lt;b&gt;Lepota&lt;/b&gt;"));
    assert.ok(email.text.includes("token_hash=a%26b&type=recovery"));
  });
});

test("escapeHtml", () => {
  assert.equal(escapeHtml(`<b>"Ana" & 'Bor'</b>`), "&lt;b&gt;&quot;Ana&quot; &amp; &#39;Bor&#39;&lt;/b&gt;");
});

describe("sendEmail (Resend API, fake fetch: nothing is sent)", () => {
  const message: OutgoingEmail = {
    ...confirmationEmail(emailData(), NOW),
    to: "stranka@example.com",
    idempotencyKey: `confirmation:${booking.id}`,
  };

  type Call = { url: string; init: RequestInit };
  function fakeDeps(responses: (Response | Error)[]): SendDeps & { calls: Call[]; sleeps: number[] } {
    const calls: Call[] = [];
    const sleeps: number[] = [];
    return {
      calls,
      sleeps,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        const next = responses.shift();
        if (!next || next instanceof Error) throw next ?? new Error("no response");
        return next;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };
  }
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  beforeEach(() => {
    env.RESEND_API_KEY = "re_test_key";
    env.EMAIL_FROM = "Termin <obvestila@domena.si>";
  });

  test("posts the message: salon as sender name, Reply-To, idempotency key", async () => {
    const deps = fakeDeps([json(200, { id: "email_123" })]);
    assert.deepEqual(await sendEmail(message, deps), { ok: true, id: "email_123" });
    assert.equal(deps.calls.length, 1);
    const { url, init } = deps.calls[0];
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_test_key");
    assert.equal(headers["Idempotency-Key"], `confirmation:${booking.id}`);
    assert.ok(init.signal, "has a timeout");
    const body = JSON.parse(String(init.body));
    assert.equal(body.from, "Frizerstvo Test <obvestila@domena.si>");
    assert.deepEqual(body.to, ["stranka@example.com"]);
    assert.equal(body.reply_to, "salon@example.com");
    assert.equal(body.subject, message.subject);
    assert.ok(body.html.length > 0 && body.text.length > 0);
  });

  test("not configured: nothing is sent", async () => {
    delete env.RESEND_API_KEY;
    const deps = fakeDeps([]);
    assert.deepEqual(await sendEmail(message, deps), { ok: false, reason: "not-configured" });
    assert.equal(deps.calls.length, 0);
    env.RESEND_API_KEY = "re_test_key";
    env.EMAIL_FROM = "ni naslov";
    assert.deepEqual(await sendEmail(message, deps), { ok: false, reason: "not-configured" });
  });

  test("a refused message (4xx) is not retried", async () => {
    const deps = fakeDeps([json(422, { name: "validation_error", message: "Invalid `to` field" })]);
    assert.deepEqual(await sendEmail(message, deps), { ok: false, reason: "failed" });
    assert.equal(deps.calls.length, 1);
  });

  test("a server error or network error is retried once, with the same key", async () => {
    const deps = fakeDeps([json(503, { name: "internal_server_error" }), json(200, { id: "email_456" })]);
    assert.deepEqual(await sendEmail(message, deps), { ok: true, id: "email_456" });
    assert.equal(deps.calls.length, 2);
    assert.deepEqual(deps.sleeps, [1_000]);
    const keys = deps.calls.map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"]);
    assert.equal(keys[0], keys[1]);

    const down = fakeDeps([new TypeError("fetch failed"), new TypeError("fetch failed")]);
    assert.deepEqual(await sendEmail(message, down), { ok: false, reason: "failed" });
    assert.equal(down.calls.length, 2);
  });

  test("a sender name with quotes or line breaks is cleaned", async () => {
    const deps = fakeDeps([json(200, { id: "x" })]);
    await sendEmail({ ...message, fromName: 'Salon "A",\r\nBcc: x' }, deps);
    assert.equal(JSON.parse(String(deps.calls[0].init.body)).from, "Salon A Bcc x <obvestila@domena.si>");
  });
});
