import "server-only";
import { getAdminAccess } from "@/lib/admin-access";
import type { Salon } from "@/lib/types";

/** A plain-text answer for the browser tab (a download link has no page around it). */
function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * The owner's salon for a CSV export (decision 1a), or the answer to give
 * instead. Route handlers get no admin layout, so they check here; lib/data.ts
 * checks again for the data itself.
 */
export async function exportingOwner(): Promise<{ salon: Salon } | { refusal: Response }> {
  const access = await getAdminAccess();
  if (!access.ok) {
    return { refusal: text(access.reason === "no-salon" ? 404 : 403, "Nimate dostopa. Prijavite se kot lastnik salona.") };
  }
  if (access.role !== "owner") return { refusal: text(403, "Izvoz lahko naredi samo lastnik salona.") };
  return { salon: access.salon };
}

export const exportFailed = () => text(500, "Izvoz trenutno ni mogoč. Poskusite znova čez nekaj minut.");
export const exportNotFound = () => text(404, "Stranke ni mogoče najti.");

/** A CSV download. Personal data: never stored by the browser or a proxy. */
export function csvDownload(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
