import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// latin-ext is required for Slovenian characters (č, š, ž).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Termin — spletno naročanje za salone",
  description:
    "Vaše stranke se naročijo same, vi pa strižete. Spletno naročanje, koledar zaposlenih in opomniki za frizerske, kozmetične in druge salone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sl" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
