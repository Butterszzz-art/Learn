// Checks the App Store Connect API key and Apple setup before the iOS build,
// so a signing failure comes with a plain explanation instead of
// "No Account for Team". Also writes the .p8 key in a clean PEM form, which
// repairs keys pasted into GitHub secrets with lost or escaped line breaks.
//
// Usage (CI): node scripts/asc-check.mjs <output-path-for-AuthKey.p8>
// Reads ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID, APPLE_TEAM_ID from the environment.
// Never prints secret values.

import crypto from "node:crypto";
import fs from "node:fs";

const BUNDLE_ID = "app.neuron.learn";
const out = process.argv[2];
const { ASC_KEY_P8 = "", ASC_KEY_ID = "", ASC_ISSUER_ID = "", APPLE_TEAM_ID = "" } = process.env;

const problems = [];
const ok = (m) => console.log(`✓ ${m}`);
const bad = (m) => {
  console.log(`::error::${m}`);
  problems.push(m);
};

// --- 1. The key file -------------------------------------------------------
const body = ASC_KEY_P8.replace(/\\n/g, "\n")
  .replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, "")
  .replace(/\s+/g, "");
const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PRIVATE KEY-----\n`;
let key;
try {
  key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ec") throw new Error("not an EC key");
  ok("ASC_KEY_P8 is a valid App Store Connect key");
} catch {
  bad("ASC_KEY_P8 is not a valid .p8 key. Paste the whole file contents again, including the BEGIN and END lines.");
}
if (out && key) {
  fs.writeFileSync(out, pem, { mode: 0o600 });
}

const trimmed = { ASC_KEY_ID, ASC_ISSUER_ID, APPLE_TEAM_ID };
for (const [name, v] of Object.entries(trimmed)) {
  if (v !== v.trim()) console.log(`::warning::${name} has spaces or a line break around it; the build trims it, but it's worth re-entering.`);
}
if (!/^[A-Z0-9]{10}$/.test(APPLE_TEAM_ID.trim())) bad("APPLE_TEAM_ID should be 10 letters/digits (Membership details on developer.apple.com).");
if (!/^[A-Z0-9]{10}$/.test(ASC_KEY_ID.trim())) bad("ASC_KEY_ID should be 10 letters/digits (the Key ID column in App Store Connect).");
if (!/^[0-9a-f-]{36}$/i.test(ASC_ISSUER_ID.trim())) bad("ASC_ISSUER_ID should look like a UUID (shown above the keys list in App Store Connect).");

if (!key) finish();

// --- 2. Talk to App Store Connect -----------------------------------------
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "ES256", kid: ASC_KEY_ID.trim(), typ: "JWT" })}.${b64({ iss: ASC_ISSUER_ID.trim(), iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
const token = `${unsigned}.${sig}`;

async function api(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const apps = await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=1`);
if (apps.status === 401) {
  bad("Apple rejected the API key (401). ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 must all come from the same key, and the key must not be revoked. Note: use a Team key (Users and Access → Integrations → Team Keys), not an Individual key.");
  finish();
}
if (apps.status === 403) bad("The API key can't read apps (403). Give it the Admin role.");
else if (apps.status === 200 && apps.json.data?.length) ok(`App record for ${BUNDLE_ID} exists in App Store Connect`);
else if (apps.status === 200) bad(`No app in App Store Connect uses bundle ID ${BUNDLE_ID}. Create it under Apps → + → New App.`);

const ids = await api(`/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&limit=5`);
const match = ids.json.data?.find((d) => d.attributes?.identifier === BUNDLE_ID);
if (ids.status === 200 && match) {
  ok(`Bundle ID ${BUNDLE_ID} is registered`);
  const seed = match.attributes?.seedId;
  if (seed && seed !== APPLE_TEAM_ID.trim()) bad("APPLE_TEAM_ID doesn't match the team that owns this API key and bundle ID. Copy the Team ID again from developer.apple.com → Membership details.");
  else if (seed) ok("APPLE_TEAM_ID matches the key's team");
} else if (ids.status === 200) bad(`Bundle ID ${BUNDLE_ID} isn't registered. Add it at developer.apple.com → Identifiers.`);
else if (ids.status === 403) bad("The API key can't manage bundle IDs or profiles (403). It needs the Admin role for automatic signing.");

const certs = await api(`/v1/certificates?limit=1`);
if (certs.status === 403) bad("The API key can't manage certificates (403). Edit the key in App Store Connect and give it the Admin role.");
else if (certs.status === 200) ok("API key can manage certificates");

finish();

function finish() {
  if (problems.length) {
    console.log(`\n${problems.length} problem(s) found. Fix them in GitHub → Settings → Secrets and variables → Actions, or in Apple's portals, then run the workflow again.`);
    process.exit(1);
  }
  console.log("\nApple setup looks right.");
  process.exit(0);
}
