import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "neuro-digest.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// A module-level singleton avoids re-opening the file on every hot-reload /
// serverless invocation within the same process.
declare global {
  // eslint-disable-next-line no-var
  var __neuroDigestLibsql: Client | undefined;
}

// Windows file: URLs need forward slashes; libsql is picky about the format.
const fileUrl = `file:${DB_PATH.replace(/\\/g, "/")}`;

const client = globalThis.__neuroDigestLibsql ?? createClient({ url: fileUrl });

if (process.env.NODE_ENV !== "production") {
  globalThis.__neuroDigestLibsql = client;
}

export const db = drizzle(client, { schema });
export { client };
export const DB_FILE_PATH = DB_PATH;
