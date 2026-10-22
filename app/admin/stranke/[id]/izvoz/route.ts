import { customerCsv } from "@/lib/customer-export";
import { exportCustomer } from "@/lib/data";
import { localDay } from "@/lib/format";
import { csvDownload, exportFailed, exportingOwner, exportNotFound } from "../../csv-response";

/** One customer and every booking as CSV (a GDPR access request, button on the card). Owner only. */
export async function GET(_request: Request, ctx: RouteContext<"/admin/stranke/[id]/izvoz">) {
  const { id } = await ctx.params;
  const owner = await exportingOwner();
  if ("refusal" in owner) return owner.refusal;
  const { salon } = owner;
  try {
    const data = await exportCustomer(salon.id, id);
    if (!data) return exportNotFound();
    const now = new Date();
    return csvDownload(customerCsv(data, salon.timezone, now), `stranka-${localDay(now, salon.timezone)}.csv`);
  } catch {
    return exportFailed();
  }
}
