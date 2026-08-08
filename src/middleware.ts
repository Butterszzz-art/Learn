import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The whole app is single-user with no accounts. Locally that's fine — only
// you can reach localhost. Deployed publicly, anyone with the URL could
// trigger refreshes (spending your Anthropic API budget) or change
// settings, so a SITE_PASSWORD env var gates every route behind one shared
// passphrase. Leaving SITE_PASSWORD unset (the local-dev default) disables
// the gate entirely — nothing to configure to keep developing locally.
const PUBLIC_PATHS = ["/login", "/api/login"];

export function middleware(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const cookie = req.cookies.get("digest_auth")?.value;
  if (cookie === sitePassword) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
