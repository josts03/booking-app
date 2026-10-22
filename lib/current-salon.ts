/**
 * The salon for the current request, from the host the visitor asked for (the
 * subdomain, lib/tenant.ts requestHost), the same way proxy.ts reads it.
 * Deliberately not from the x-salon-slug header: if a request ever skipped the
 * proxy, that header would be whatever the client sent. Cached per request, so layout, page and server
 * action share one lookup. Data comes from lib/data.ts only.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { getSalon } from "./data";
import { requestHost, salonSlugFromHost } from "./tenant";
import type { Salon } from "./types";

export const getCurrentSalon = cache(async (): Promise<Salon | null> => {
  return getSalon(salonSlugFromHost(requestHost(await headers())));
});

/** Visitors may book only while the subscription is trial or active. */
export function isBookable(salon: Salon): boolean {
  return salon.subscription_status === "trial" || salon.subscription_status === "active";
}
