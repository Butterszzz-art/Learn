import type { Metadata } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { ensureDb } from "@/db/bootstrap";
import { Nav } from "@/components/Nav";
import "./globals.css";

// Fredoka: bubbly, rounded display face for headings/logo. Nunito: rounded
// body sans that stays readable at paragraph length — the pairing behind
// the "bubbly, modern" redesign (formerly a serif/system-sans pairing).
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Neuron",
  description:
    "A personal, local knowledge feed — real current material and thorough, level-matched explainers across whatever fields you choose.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureDb();
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable}`}>
      <body>
        <Nav />
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-4xl px-6 py-10 text-center text-xs text-neuron-muted">
          Runs entirely on your machine. Nothing here is hosted or emailed.
        </footer>
      </body>
    </html>
  );
}
