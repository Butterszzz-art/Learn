import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ClientBoot } from "@/components/ClientBoot";
import "./globals.css";

// Fredoka: rounded display face for headings and the wordmark. Nunito:
// rounded body sans that stays readable at paragraph length.
const fredoka = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-body" });

export const metadata: Metadata = {
  title: { default: "Neuron", template: "%s · Neuron" },
  description: "Swipe through real science, one idea at a time — and actually remember it.",
  applicationName: "Neuron",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Neuron", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8ff" },
    { media: "(prefers-color-scheme: dark)", color: "#120f1e" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const theme = user?.prefs.theme && user.prefs.theme !== "system" ? user.prefs.theme : undefined;
  const scale = user?.prefs.textScale;
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${nunito.variable}`}
      data-theme={theme}
      style={scale ? ({ "--text-scale": String(scale) } as React.CSSProperties) : undefined}
    >
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-neuron-surface focus:px-4 focus:py-2">
          Skip to content
        </a>
        <AppShell signedIn={!!user && user.onboarded} isAdmin={user?.role === "admin"}>
          {children}
        </AppShell>
        <ClientBoot />
      </body>
    </html>
  );
}
