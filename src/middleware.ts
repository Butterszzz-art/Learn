import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// First line of defence only: anyone without a session cookie is sent to
// sign in before a page renders. The cookie's validity is checked against
// the database inside each page and API route (lib/auth.ts) — middleware
// runs at the edge and deliberately does no database work.
const SESSION_COOKIE = "neuron_session";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/welcome",
  "/privacy",
  "/terms",
  "/s/", // public share pages
  "/api/auth/",
  "/api/og/",
  "/api/public/",
  "/api/cron/", // protected by CRON_SECRET instead
  "/api/client-error",
  "/api/health",
  "/offline",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.redirect(new URL(pathname === "/" ? "/welcome" : "/login", req.url));
}

export const config = {
  // Static assets, the service worker, the manifest and icons are public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|icons/).*)"],
};
