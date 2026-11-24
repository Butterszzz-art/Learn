// Lists Neuron's recent builds in App Store Connect and explains, in plain
// words, where each one stands (processing, failed, waiting on export
// compliance, ready for TestFlight...). Useful when a build was uploaded but
// doesn't show up in TestFlight.
//
// Usage (CI): node scripts/asc-builds.mjs
// Reads ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID from the environment.
// Never prints secret values.

import crypto from "node:crypto";
import fs from "node:fs";

const BUNDLE_ID = "app.neuron.learn";
const env = (n) => (process.env[n] ?? "").trim();
const lines = [];
const say = (m = "") => {
  console.log(m);
  lines.push(m);
};
function done(code) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  process.exit(code);
}

const body = (process.env.ASC_KEY_P8 ?? "").replace(/\\n/g, "\n").replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, "").replace(/\s+/g, "");
let key;
try {
  key = crypto.createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PRIVATE KEY-----\n`);
} catch {
  say("::error::ASC_KEY_P8 isn't a valid key. Run the iOS → TestFlight workflow for a full setup check.");
  done(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "ES256", kid: env("ASC_KEY_ID"), typ: "JWT" })}.${b64({ iss: env("ASC_ISSUER_ID"), iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
const token = `${unsigned}.${crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;

async function api(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    say(`::error::App Store Connect returned ${res.status} for ${path.split("?")[0]}: ${json.errors?.[0]?.detail ?? "no detail"}`);
    done(1);
  }
  return json;
}

const apps = await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=1`);
const app = apps.data?.[0];
if (!app) {
  say(`::error::No app with bundle ID ${BUNDLE_ID} in App Store Connect for this key's team.`);
  done(1);
}
say(`## Builds of ${app.attributes?.name ?? "the app"} (${BUNDLE_ID})`);
say("");

const builds = await api(
  `/v1/builds?filter[app]=${app.id}` +
    "&filter[processingState]=PROCESSING,FAILED,INVALID,VALID" +
    "&sort=-uploadedDate&limit=10" +
    "&include=preReleaseVersion,buildBetaDetail" +
    "&fields[builds]=version,uploadedDate,processingState,expired,usesNonExemptEncryption,preReleaseVersion,buildBetaDetail" +
    "&fields[preReleaseVersions]=version" +
    "&fields[buildBetaDetails]=internalBuildState,externalBuildState"
);

if (!builds.data?.length) {
  say("**No builds found.** Apple received the upload but didn't keep it, which happens when the build fails Apple's checks right after upload.");
  say("Apple emails the reasons to the Account Holder (subject mentions App Store Connect and usually lists ITMS-9xxxx codes). Check that inbox, including spam.");
  done(0);
}

const included = new Map((builds.included ?? []).map((i) => [`${i.type}/${i.id}`, i]));
const rel = (b, name) => {
  const d = b.relationships?.[name]?.data;
  return d ? included.get(`${d.type}/${d.id}`) : undefined;
};

const PROCESSING = {
  PROCESSING: "Apple is still processing it. This can take up to an hour, sometimes longer.",
  FAILED: "Processing FAILED. Apple emails the reason to the Account Holder; it also may show in App Store Connect → TestFlight on the build.",
  INVALID: "Apple marked it INVALID (failed its checks). Apple emails the reason (ITMS-9xxxx codes) to the Account Holder.",
  VALID: "Processed fine.",
};
const BETA = {
  PROCESSING: "TestFlight is still preparing it.",
  PROCESSING_EXCEPTION: "TestFlight hit a processing error.",
  MISSING_EXPORT_COMPLIANCE: "Waiting for the export compliance answer: open the build in TestFlight and answer the encryption question (No).",
  IN_EXPORT_COMPLIANCE_REVIEW: "Apple is reviewing export compliance.",
  READY_FOR_BETA_TESTING: "Ready: add it to an internal testing group in TestFlight.",
  IN_BETA_TESTING: "Available to testers in TestFlight.",
  EXPIRED: "Expired (TestFlight builds last 90 days).",
};

for (const b of builds.data) {
  const a = b.attributes ?? {};
  const version = rel(b, "preReleaseVersion")?.attributes?.version ?? "?";
  const beta = rel(b, "buildBetaDetail")?.attributes ?? {};
  say(`### Version ${version} (build ${a.version}), uploaded ${a.uploadedDate ?? "?"}`);
  say(`- Processing: \`${a.processingState}\` (${PROCESSING[a.processingState] ?? "unknown state"})`);
  if (beta.internalBuildState) say(`- Internal testing: \`${beta.internalBuildState}\` (${BETA[beta.internalBuildState] ?? "unknown state"})`);
  if (beta.externalBuildState) say(`- External testing: \`${beta.externalBuildState}\``);
  if (a.expired) say("- This build has expired.");
  say("");
}
done(0);
