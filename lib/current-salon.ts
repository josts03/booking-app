/**
 * The salon for the current request, from the Host header (the subdomain,
 * lib/tenant.ts), the same way proxy.ts reads it. Deliberately not from the
 * x-salon-slug header: if a request ever skipped the proxy, that header would
 * be whatever the client sent. Cached per request, so layout, page and server
 * action share one lookup. Data comes from lib/data.ts only.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { getSalon } from "./data";
import { salonSlugFromHost } from "./tenant";
import type { Salon } from "./types";

export const getCurrentSalon = cache(async (): Promise<Salon | null> => {
  const host = (await headers()).get("host");
  return getSalon(salonSlugFromHost(host));
});

/** Visitors may book only while the subscription is trial or active. */
export function isBookable(salon: Salon): boolean {
  return salon.subscription_status === "trial" || salon.subscription_status === "active";
}
