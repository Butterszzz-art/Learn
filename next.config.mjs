/** @type {import('next').NextConfig} */
const nextConfig = {
  // @libsql/client's local-file mode uses a native addon (libsql) — keep it
  // external to the server bundle, same reason better-sqlite3 needed this
  // in Phase 1. On Vercel with TURSO_DATABASE_URL set, the native addon
  // isn't loaded at all (HTTP-based remote client instead), but this is
  // harmless to leave in either way.
  //
  // pdfkit (Phase 11 export) ships its built-in font metrics as separate
  // .afm data files loaded via fs.readFileSync at runtime — webpack bundles
  // the JS that reads them but doesn't know to carry the data files along,
  // so a bundled pdfkit throws ENOENT looking for them under .next/server/.
  // External keeps it a plain node_modules require, where those files are
  // still physically present on disk.
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client", "libsql", "pdfkit"],
  },
};

export default nextConfig;
