/**
 * The salon for the current request, from the x-salon-slug header that
 * middleware.ts sets. Cached per request, so layout, page and server action
 * share one lookup. Data comes from lib/data.ts only.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { getSalon } from "./data";
import type { Salon } from "./types";

export const getCurrentSalon = cache(async (): Promise<Salon | null> => {
  const slug = (await headers()).get("x-salon-slug");
  return slug ? getSalon(slug) : null;
});

/** Visitors may book only while the subscription is trial or active. */
export function isBookable(salon: Salon): boolean {
  return salon.subscription_status === "trial" || salon.subscription_status === "active";
}
