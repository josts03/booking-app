/**
 * Phone numbers. In the database customers.phone is always E.164
 * ("+38640123456"); a check constraint enforces it (002_constraints.sql).
 * Without one format, "040 123 456" and "+386 40 123 456" would be two
 * different customers and the unique index on (salon_id, phone) would be useless.
 */

/** Country calling code used for national numbers that start with 0. */
const DEFAULT_COUNTRY_CODE = "386";

const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

/**
 * What a visitor typed -> E.164, or null if it is not a usable number.
 *
 *   "040 123 456"      -> "+38640123456"   (national, Slovenia)
 *   "01 234 56 78"     -> "+38612345678"
 *   "+386 40 123 456"  -> "+38640123456"
 *   "00386 40 123 456" -> "+38640123456"
 *   "+43 664 1234567"  -> "+436641234567"  (foreign numbers keep their code)
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().\/]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;

  let e164: string;
  if (compact.startsWith("+")) {
    e164 = compact;
  } else if (compact.startsWith("00")) {
    e164 = `+${compact.slice(2)}`;
  } else if (compact.startsWith("0")) {
    // Slovenian national numbers: 0 + 8 digits.
    if (compact.length !== 9) return null;
    e164 = `+${DEFAULT_COUNTRY_CODE}${compact.slice(1)}`;
  } else {
    return null;
  }
  return isE164(e164) ? e164 : null;
}

/** For display: "+38640123456" -> "040 123 456"; foreign numbers stay in E.164. */
export function formatPhone(phone: string): string {
  const national = phone.startsWith(`+${DEFAULT_COUNTRY_CODE}`)
    ? phone.slice(DEFAULT_COUNTRY_CODE.length + 1)
    : null;
  if (national && national.length === 8) {
    return `0${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }
  return phone;
}

/**
 * Digit strings to look for when searching customers by phone. The stored
 * number is E.164, so a national query ("040 123") is also tried as "38640123".
 */
export function phoneSearchDigits(query: string): string[] {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const variants = [digits];
  if (digits.startsWith("00")) variants.push(digits.slice(2));
  else if (digits.startsWith("0")) variants.push(`${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`);
  return variants;
}
