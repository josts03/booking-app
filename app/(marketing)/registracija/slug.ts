/**
 * Turns "Frizerstvo Ana & Co." into "frizerstvo-ana-co". Shared by the browser
 * (while typing) and the server (before saving), so what the visitor sees is
 * what gets stored. Must stay in step with SLUG_RULE in lib/data.ts.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/č|ć/g, "c")
    .replace(/đ/g, "d")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}
