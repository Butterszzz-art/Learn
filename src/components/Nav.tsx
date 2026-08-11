"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchOverlay } from "./SearchOverlay";

// Home is the logo/wordmark itself — no separate "Home" nav item duplicating it.
const LINKS = [
  { href: "/drills", label: "Drills" },
  { href: "/library", label: "Library" },
  { href: "/archive", label: "Archive" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <header className="sticky top-0 z-10 border-b border-neuron-border/60 bg-neuron-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-neuron-accent to-neuron-accent2 bg-clip-text text-transparent">
            🧠 Neuron
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <SearchOverlay />
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} className={active ? "nav-link-active" : "nav-link"}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
