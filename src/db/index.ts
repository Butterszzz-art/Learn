import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// A module-level singleton avoids re-opening the connection on every
// hot-reload (local dev) or warm-container reuse (serverless deploys).
declare global {
  // eslint-disable-next-line no-var
  var __neuroDigestLibsql: Client | undefined;
}

// NEURON_LOCAL_DB=1 forces the local file even when Turso credentials are in
// .env.local, so development and tests never write to the live database.
const useHosted = !!process.env.TURSO_DATABASE_URL && process.env.NEURON_LOCAL_DB !== "1";

function createDbClient(): Client {
  // Hosted mode (Vercel, or any read-only-filesystem host): point at a
  // Turso (libSQL) database instead of a local file. Same client library,
  // same SQL dialect — this is the only branch that differs.
  if (useHosted) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL as string,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  // Local dev / self-hosted: a plain file on disk.
  const DATA_DIR = path.join(process.cwd(), "data");
  const DB_PATH = process.env.NEURON_DB_FILE
    ? path.resolve(process.env.NEURON_DB_FILE)
    : path.join(DATA_DIR, "neuro-digest.db");
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Windows file: URLs need forward slashes; libsql is picky about the format.
  const fileUrl = `file:${DB_PATH.replace(/\\/g, "/")}`;
  return createClient({ url: fileUrl });
}

const client = globalThis.__neuroDigestLibsql ?? createDbClient();
globalThis.__neuroDigestLibsql = client;

export const db = drizzle(client, { schema });
export { client };
export const usingHostedDb = useHosted;
