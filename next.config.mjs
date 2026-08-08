/** @type {import('next').NextConfig} */
const nextConfig = {
  // @libsql/client's local-file mode uses a native addon (libsql) — keep it
  // external to the server bundle, same reason better-sqlite3 needed this
  // in Phase 1. On Vercel with TURSO_DATABASE_URL set, the native addon
  // isn't loaded at all (HTTP-based remote client instead), but this is
  // harmless to leave in either way.
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client", "libsql"],
  },
};

export default nextConfig;
