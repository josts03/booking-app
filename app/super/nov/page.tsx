import Link from "next/link";
import { notFound } from "next/navigation";
import { getSuperAccess } from "@/lib/super-access";
import { backLink, pageTitle } from "../../admin/_components/ui";
import { NewSalonForm } from "../super-forms";

/** A new salon with its first user (specs/mvp.md). */
export default async function NewSalonPage() {
  const access = await getSuperAccess();
  if (!access.ok) notFound(); // the layout handles signed-out

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/super" className={backLink}>
        <span aria-hidden="true">←</span> Vsi saloni
      </Link>
      <div>
        <h1 className={pageTitle}>Nov salon</h1>
        <p className="mt-1 text-ink-muted">
          Salon začne v 14-dnevnem preizkusu. Lastnik dobi e-pošto s povezavo za nastavitev gesla, nato v adminu doda
          zaposlene, storitve in urnik.
        </p>
      </div>
      <NewSalonForm domain={process.env.ROOT_DOMAIN || "localhost:3000"} />
    </div>
  );
}
