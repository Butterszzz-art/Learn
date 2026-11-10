"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const TABS: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: "/", label: "Feed", icon: "feed", match: (p) => p === "/" || p.startsWith("/card") },
  { href: "/explore", label: "Explore", icon: "explore", match: (p) => p.startsWith("/explore") || p.startsWith("/deep-dive") },
  { href: "/review", label: "Review", icon: "review", match: (p) => p.startsWith("/review") },
  { href: "/library", label: "Library", icon: "library", match: (p) => p.startsWith("/library") },
  {
    href: "/me",
    label: "Me",
    icon: "me",
    match: (p) => ["/me", "/map", "/saved", "/settings", "/upgrade", "/admin"].some((x) => p.startsWith(x)),
  },
];

// Pages that render without navigation (signed-out and first-run screens).
const BARE = ["/login", "/signup", "/welcome", "/onboarding", "/privacy", "/terms", "/s/", "/offline"];

/**
 * App frame: a bottom tab bar on phones, a left rail on wider screens.
 * The feed gets the full height; other pages get a centred reading column.
 */
export function AppShell({ children, signedIn, isAdmin }: { children: React.ReactNode; signedIn: boolean; isAdmin: boolean }) {
  const pathname = usePathname();
  const bare = !signedIn || BARE.some((p) => pathname === p || pathname.startsWith(p));
  if (bare) {
    return (
      <main id="main" className="mx-auto min-h-[100dvh] max-w-2xl px-5 py-8">
        {children}
      </main>
    );
  }
  const isFeed = pathname === "/";

  return (
    <div className="md:pl-20 lg:pl-56">
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-neuron-border bg-neuron-surface/95 backdrop-blur-md md:inset-y-0 md:left-0 md:right-auto md:w-20 md:border-r md:border-t-0 lg:w-56"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Link href="/" className="hidden items-center gap-2 px-5 py-6 font-display text-xl font-bold md:flex">
          <span aria-hidden className="text-2xl">🧠</span>
          <span className="hidden bg-gradient-to-r from-neuron-accent to-neuron-accent2 bg-clip-text text-transparent lg:inline">Neuron</span>
        </Link>
        <ul className="flex h-16 items-stretch justify-around md:h-auto md:flex-col md:gap-1 md:px-3">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <li key={tab.href} className="flex-1 md:flex-none">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition md:h-12 md:flex-row md:justify-center md:gap-3 md:rounded-2xl md:text-sm lg:justify-start lg:px-4 ${
                    active ? "text-neuron-accent md:bg-neuron-accent/10" : "text-neuron-muted hover:text-neuron-text md:hover:bg-neuron-surface2"
                  }`}
                >
                  <Icon name={tab.icon} className="h-6 w-6" filled={active} />
                  <span className="md:hidden lg:inline">{tab.label}</span>
                </Link>
              </li>
            );
          })}
          {isAdmin && (
            <li className="hidden md:block">
              <Link href="/admin" className="flex h-12 items-center justify-center gap-3 rounded-2xl text-sm font-bold text-neuron-muted hover:bg-neuron-surface2 hover:text-neuron-text lg:justify-start lg:px-4">
                <Icon name="settings" className="h-6 w-6" />
                <span className="hidden lg:inline">Admin</span>
              </Link>
            </li>
          )}
        </ul>
      </nav>

      {isFeed ? (
        <main id="main" className="h-screen-minus-tabbar">
          {children}
        </main>
      ) : (
        <main id="main" className="pb-tabbar mx-auto min-h-[100dvh] max-w-3xl px-5 py-6 md:py-10">
          {children}
        </main>
      )}
    </div>
  );
}
