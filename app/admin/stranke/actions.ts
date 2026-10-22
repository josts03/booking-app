"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, NO_ADMIN_ACCESS, OWNER_ONLY } from "@/lib/admin-access";
import { anonymizeCustomer, CUSTOMER_MESSAGES, CUSTOMER_NOTE_MAX, updateCustomerNote } from "@/lib/data";

export type CustomerState = {
  ok?: boolean;
  message?: string;
  values?: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const NoteSchema = z.object({
  id: z.uuid(CUSTOMER_MESSAGES.notFound),
  notes: z.string().max(CUSTOMER_NOTE_MAX, CUSTOMER_MESSAGES.noteTooLong),
});

/** The salon's internal note on the customer's card. Owner and staff. */
export async function saveNoteAction(_previous: CustomerState, formData: FormData): Promise<CustomerState> {
  const values = { id: text(formData, "id"), notes: text(formData, "notes") };
  const parsed = NoteSchema.safeParse(values);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message, values };

  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS, values };

  const result = await updateCustomerNote(access.salon.id, parsed.data.id, parsed.data.notes || null);
  if (!result.ok) return { message: result.error, values };
  revalidatePath("/admin/stranke", "layout");
  return { ok: true, message: "Opomba je shranjena.", values };
}

/** GDPR erasure (specs/security.md), owner only. The form asks "are you sure?" first. */
export async function anonymizeAction(_previous: CustomerState, formData: FormData): Promise<CustomerState> {
  const id = z.uuid().safeParse(text(formData, "id"));
  if (!id.success) return { message: CUSTOMER_MESSAGES.notFound };

  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS };
  if (access.role !== "owner") return { message: OWNER_ONLY };

  const result = await anonymizeCustomer(access.salon.id, id.data);
  if (!result.ok) return { message: result.error };
  // The calendar shows customer names too.
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Osebni podatki stranke so izbrisani. Termini ostanejo v statistiki." };
}
