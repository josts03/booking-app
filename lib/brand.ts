/**
 * Turns a salon's brand_color into the three CSS variables the design system
 * uses (see app/globals.css): --brand, --brand-foreground and --brand-ink.
 * Put the result on the wrapper element of a salon's pages.
 */
import type { CSSProperties } from "react";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** salons.brand_color default in the schema. */
const FALLBACK_COLOR = "#111111";

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of a color against white. */
function contrastWithWhite(rgb: Rgb): number {
  return 1.05 / (luminance(rgb) + 0.05);
}

/** White or near-black, whichever has the better contrast on `hex`. */
function readableOn(hex: string): string {
  const l = luminance(toRgb(hex));
  const againstWhite = 1.05 / (l + 0.05);
  const againstBlack = (l + 0.05) / 0.05;
  return againstWhite >= againstBlack ? "#ffffff" : "#111111";
}

/**
 * The brand color, darkened just enough to be readable as text on white
 * (contrast 4.5:1). A yellow brand color is fine as a button background but
 * unreadable as link text; this is the text version of it.
 */
function inkOnWhite(hex: string): string {
  const base = toRgb(hex);
  for (let t = 0; t <= 1; t += 0.05) {
    const rgb = base.map((c) => Math.round(c * (1 - t))) as Rgb;
    if (contrastWithWhite(rgb) >= 4.5) return toHex(rgb);
  }
  return "#111111";
}

/** Accepts only #rrggbb; anything else (null, junk from the database) falls back. */
export function safeColor(color: string | null | undefined): string {
  return color && HEX_COLOR.test(color) ? color : FALLBACK_COLOR;
}

export function brandStyle(color: string | null | undefined): CSSProperties {
  const brand = safeColor(color);
  return {
    "--brand": brand,
    "--brand-foreground": readableOn(brand),
    "--brand-ink": inkOnWhite(brand),
  } as CSSProperties;
}
