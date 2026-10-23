import Image from "next/image";

/**
 * The platform's logo (Termi grafična podoba, files in public/brand/).
 * `light` is for white and light backgrounds, `inverse` for Dark Azure.
 * Size it with a height class; the width follows (the files are 888 x 212).
 */
export function TermiLogo({
  variant = "light",
  className = "h-7 w-auto",
}: {
  variant?: "light" | "inverse";
  className?: string;
}) {
  return (
    <Image
      src={variant === "light" ? "/brand/termi-logo.svg" : "/brand/termi-logo-inverse.svg"}
      alt="Termi"
      width={888}
      height={212}
      className={className}
    />
  );
}
