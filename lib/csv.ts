/**
 * CSV files that open correctly in a Slovenian Excel. Pure.
 *
 * - ";" between fields: Slovenian Excel uses "," as the decimal sign and
 *   expects ";" as the list separator.
 * - UTF-8 with a byte order mark, otherwise Excel shows "Ä" instead of "č".
 * - Every field in quotes, quotes doubled, CRLF line ends (RFC 4180).
 * - Formula injection: a name typed into the public booking form, such as
 *   "=HYPERLINK(...)", would run as a formula when the salon opens the file.
 *   A field starting with = + - @ tab or CR gets a leading apostrophe (OWASP),
 *   so Excel treats it as text.
 */

export type CsvValue = string | number | null | undefined;

const BOM = "﻿";
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows to a whole file, BOM included. Rows may differ in length (sections). */
export function toCsv(rows: CsvValue[][]): string {
  return BOM + rows.map((row) => row.map(csvField).join(";")).join("\r\n") + "\r\n";
}
