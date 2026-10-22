import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { csvField, toCsv } from "./csv";
import { customerCsv, customersCsv } from "./customer-export";
import { buildFixtures, FIXTURE_TIMEZONE } from "./fixtures";
import type { CustomerExport } from "./types";

const NOW = new Date("2026-09-16T08:00:00Z");
const f = buildFixtures(NOW);
const BOM = "﻿";

/** The file's lines without the BOM and the last line end. */
function lines(csv: string): string[] {
  assert.ok(csv.startsWith(BOM), "starts with a BOM so Excel reads UTF-8");
  assert.ok(csv.endsWith("\r\n"));
  return csv.slice(1, -2).split("\r\n");
}

describe("csvField / toCsv", () => {
  test("quotes every field, doubles quotes, keeps ; and line breaks inside the quotes", () => {
    assert.equal(csvField('Salon "Lepota"'), '"Salon ""Lepota"""');
    assert.equal(csvField("a;b"), '"a;b"');
    assert.equal(csvField("prva\nvrstica"), '"prva\nvrstica"');
    assert.equal(csvField(null), '""');
    assert.equal(csvField(undefined), '""');
    assert.equal(csvField(12), '"12"');
    assert.equal(csvField("Čebelica Žiga Šuštar"), '"Čebelica Žiga Šuštar"');
  });

  test("text that Excel would run as a formula gets a leading apostrophe", () => {
    for (const evil of ['=HYPERLINK("http://x","klik")', "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      assert.equal(csvField(evil), `"'${evil.replace(/"/g, '""')}"`, evil);
    }
    // Numbers stay numbers; text with = elsewhere is left alone.
    assert.equal(csvField(-5), '"-5"');
    assert.equal(csvField("a=b"), '"a=b"');
  });

  test("semicolons between fields, CRLF between rows, an empty row stays empty", () => {
    assert.deepEqual(lines(toCsv([["a", "b"], [], ["c"]])), ['"a";"b"', "", '"c"']);
  });
});

describe("customersCsv", () => {
  test("one row per customer, in the Slovenian notation", () => {
    const customer = f.customers[0];
    const csv = customersCsv(
      [{ customer, bookings_count: 3, last_visit_at: "2026-09-01T08:30:00Z", next_visit_at: null }],
      FIXTURE_TIMEZONE,
    );
    const [header, row] = lines(csv);
    assert.equal(
      header,
      '"Ime";"Priimek";"Telefon";"E-pošta";"Soglasje za akcije";"Interna opomba";"Termini (brez odpovedanih)";"Zadnji obisk";"Stranka od"',
    );
    const fields = row.split(";");
    assert.equal(fields[0], `"${customer.first_name}"`);
    // Slovenian numbers like on screen ("040 123 456"), not E.164 with a "+" Excel would read as a formula.
    assert.match(fields[2], /^"0\d{2} \d{3} \d{3}"$/);
    assert.equal(fields[4], customer.marketing_consent ? '"da"' : '"ne"');
    assert.equal(fields[6], '"3"');
    assert.equal(fields[7], '"1. 9. 2026"');
  });

  test("a hostile name from the booking form cannot become a formula", () => {
    const customer = { ...f.customers[0], first_name: "=cmd|' /C calc'!A0", last_name: null };
    const [, row] = lines(customersCsv([{ customer, bookings_count: 0, last_visit_at: null, next_visit_at: null }], FIXTURE_TIMEZONE));
    assert.ok(row.startsWith(`"'=cmd|' /C calc'!A0";""`), row);
  });
});

describe("customerCsv", () => {
  const customer = f.customers[0];
  const own = f.bookings.filter((b) => b.customer_id === customer.id);
  const data: CustomerExport = {
    customer: { ...customer, notes: "Raje zjutraj." },
    bookings: own.map((b) => ({ ...b, service_name: "Žensko striženje", staff_name: "Maja Novak" })),
  };

  test("the customer's data, then every booking with names, status and price", () => {
    const rows = lines(customerCsv(data, FIXTURE_TIMEZONE, NOW));
    assert.equal(rows[0], '"Podatki stranke"');
    assert.equal(rows[1], `"Ime";"${customer.first_name}"`);
    assert.ok(rows.includes('"Interna opomba salona";"Raje zjutraj."'));
    assert.ok(rows.includes('"Anonimizirana";"ne"'));
    assert.ok(rows.includes('"Izvoženo";"16. 9. 2026, 10:00"'));
    const header = rows.indexOf(
      '"Datum";"Ura";"Storitev";"Izvajalec";"Status";"Cena (€)";"Opomba stranke";"Interna opomba salona";"E-pošta za termin";"Vir"',
    );
    assert.ok(header > 0);
    assert.equal(rows[header - 2], "", "an empty row between the two parts");
    assert.equal(rows.length - header - 1, own.length);

    const first = rows[header + 1].split(";");
    assert.equal(first[2], '"Žensko striženje"');
    assert.match(first[5], /^"\d+,\d{2}"$/, "price as 25,00 so Excel can add it up");
  });
});
