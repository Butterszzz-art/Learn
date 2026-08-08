"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Digest" },
  { href: "/archive", label: "Archive" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <header className="border-b border-brain-border">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-serif text-lg tracking-tight">
          📚 Digest
        </Link>
        <nav className="flex gap-6">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
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
