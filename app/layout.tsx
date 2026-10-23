import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

// latin-ext is required for Slovenian characters (č, š, ž).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

// Headings only (Termi brand: Poppins 500 and 600). Not a variable font, so the weights are listed.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Termi — spletno naročanje za salone",
  description:
    "Vaše stranke se naročijo same, vi pa strižete. Spletno naročanje, koledar zaposlenih in opomniki za frizerske, kozmetične in druge salone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sl" className={`${inter.variable} ${poppins.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
