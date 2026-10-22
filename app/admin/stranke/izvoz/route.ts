import { customersCsv } from "@/lib/customer-export";
import { exportCustomers } from "@/lib/data";
import { localDay } from "@/lib/format";
import { csvDownload, exportFailed, exportingOwner } from "../csv-response";

/** The salon's whole customer list as CSV (button on /admin/stranke). Owner only. */
export async function GET() {
  const owner = await exportingOwner();
  if ("refusal" in owner) return owner.refusal;
  const { salon } = owner;
  try {
    const rows = await exportCustomers(salon.id);
    return csvDownload(customersCsv(rows, salon.timezone), `stranke-${salon.slug}-${localDay(new Date(), salon.timezone)}.csv`);
  } catch {
    return exportFailed();
  }
}
