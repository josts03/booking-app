/** Small building blocks shared by the sign-in and password forms. */

export const inputClass =
  "h-12 w-full rounded-control border bg-surface px-4 text-base placeholder:text-ink-muted/60";

export function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${name}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Props for an input with an optional error under it. */
export function inputProps(name: string, error: string | undefined) {
  return {
    id: name,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
    className: `${inputClass} ${error ? "border-danger" : "border-line"}`,
  };
}

export function FormMessage({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const color =
    tone === "error" ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-control border p-3 text-sm ${color}`}>
      {children}
    </div>
  );
}
