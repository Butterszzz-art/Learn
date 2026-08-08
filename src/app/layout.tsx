import type { Metadata } from "next";
import { ensureDb } from "@/db/bootstrap";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neuro Digest",
  description: "A personal, local neuroscience & psychobiology news digest.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureDb();
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-4xl px-6 py-10 text-center text-xs text-brain-muted">
          Runs entirely on your machine. Nothing here is hosted or emailed.
        </footer>
      </body>
    </html>
  );
}
