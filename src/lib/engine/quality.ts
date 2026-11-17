// Quality pass for a deep dive before it is served to anyone: checks that
// its sources are reachable, and has a second, cheap model read the entry
// against the fetched source text looking for claims the sources don't
// support. A low score flags the entry, which keeps it out of the feed
// until an admin looks at it.
import { client } from "@/db";
import { generateJson, routeForCurrentCall } from "../ai";
import { fetchArticleText } from "../articleFetch";

export interface QualityResult {
  score: number; // 1 (unusable) – 5 (well supported)
  notes: string;
  flagged: boolean;
}

const FLAG_BELOW = 3;
const MAX_SOURCES_READ = 3;
const SOURCE_CHARS = 6000;

async function linkIsAlive(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    // GET, not HEAD: many publishers reject HEAD outright.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; NeuronLinkCheck/1.0)" },
    });
    clearTimeout(timer);
    // 401/403/429 mean "exists but won't talk to a bot" — treat as alive.
    return res.ok || [401, 403, 429].includes(res.status);
  } catch {
    return false;
  }
}

interface Review {
  score: number;
  unsupportedClaims: string[];
  summary: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description:
        "5 = every checkable claim is supported by the sources or is standard textbook knowledge; " +
        "4 = minor imprecision; 3 = some claims can't be verified from these sources but nothing looks wrong; " +
        "2 = at least one claim contradicts the sources, or is a specific number, study or quote you believe is " +
        "wrong or invented; 1 = largely unsupported. The excerpts are partial: a claim that is merely absent " +
        "from them, and that you have no reason to think is false (e.g. a real, well-known study), is a 3 at worst, never a 2.",
    },
    unsupportedClaims: {
      type: "array",
      items: { type: "string" },
      description: "Up to 5 specific claims from the entry that the sources contradict or that look invented. Empty if none.",
    },
    summary: { type: "string", description: "One sentence on the entry's reliability." },
  },
  required: ["score", "unsupportedClaims", "summary"],
  additionalProperties: false,
} as const;

export async function checkDeepDiveQuality(
  topic: string,
  content: string,
  sources: { title: string; url: string }[]
): Promise<QualityResult> {
  if (sources.length === 0) {
    // Without web search (OpenRouter free models) entries are written from
    // the model's own knowledge, so review them for invented specifics
    // instead of flagging every one for having no sources.
    if ((await routeForCurrentCall()) === "openrouter") return reviewUnsourced(topic, content);
    return { score: 2, notes: "No sources were cited.", flagged: true };
  }

  const alive = await Promise.all(sources.map((s) => linkIsAlive(s.url)));
  const liveSources = sources.filter((_, i) => alive[i]);
  const deadCount = sources.length - liveSources.length;
  if (liveSources.length === 0) {
    return { score: 1, notes: `All ${sources.length} cited links failed to load.`, flagged: true };
  }

  const texts = await Promise.all(
    liveSources.slice(0, MAX_SOURCES_READ).map(async (s) => {
      const text = await fetchArticleText(s.url).catch(() => null);
      return text ? `### ${s.title} (${s.url})\n${text.slice(0, SOURCE_CHARS)}` : null;
    })
  );
  const sourceText = texts.filter(Boolean).join("\n\n");

  const review = await generateJson<Review>({
    tier: "fast",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2000,
    system:
      "You are a careful fact-checker for an educational app. You compare an explainer against excerpts " +
      "of the sources it cites. Standard, uncontroversial textbook knowledge needs no citation; specific " +
      "numbers, named studies, dates and quotes do.",
    prompt:
      `Explainer topic: "${topic}"\n\n--- EXPLAINER ---\n${content}\n--- END ---\n\n` +
      (sourceText
        ? `--- SOURCE EXCERPTS ---\n${sourceText}\n--- END ---\n\n`
        : "(The source pages could not be read, only their titles: " + liveSources.map((s) => s.title).join("; ") + ")\n\n") +
      "Rate how well supported the explainer is.",
  }).catch(() => null);

  if (!review) {
    // The check itself failed; don't block the entry on that, but say so.
    return { score: 3, notes: `Automated review unavailable. ${deadCount} of ${sources.length} links dead.`, flagged: false };
  }

  let score = Math.max(1, Math.min(5, Math.round(review.score)));
  if (deadCount > sources.length / 2) score = Math.min(score, 3);
  const claims = (review.unsupportedClaims ?? []).slice(0, 5);
  const notes =
    review.summary +
    (claims.length ? ` Unsupported: ${claims.join(" | ")}` : "") +
    (deadCount ? ` (${deadCount} of ${sources.length} links dead)` : "");
  return { score, notes, flagged: score < FLAG_BELOW };
}

async function reviewUnsourced(topic: string, content: string): Promise<QualityResult> {
  const review = await generateJson<Review>({
    tier: "fast",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2000,
    system:
      "You are a careful fact-checker for an educational app. The explainer below was written without " +
      "web search and cites no sources. Standard, uncontroversial textbook knowledge is fine; flag specific " +
      "numbers, named studies, dates and quotes that look invented or wrong.",
    prompt: `Explainer topic: "${topic}"

--- EXPLAINER ---
${content}
--- END ---

Rate how trustworthy the explainer is.`,
  }).catch(() => null);
  if (!review) return { score: 3, notes: "Written without web search; automated review unavailable.", flagged: false };
  const score = Math.max(1, Math.min(5, Math.round(review.score)));
  const claims = (review.unsupportedClaims ?? []).slice(0, 5);
  const notes = "Written without web search. " + review.summary + (claims.length ? ` Doubtful: ${claims.join(" | ")}` : "");
  return { score, notes, flagged: score < FLAG_BELOW };
}

/** Stores a quality result and hides the entry's cards if it was flagged. */
export async function applyQualityResult(deepDiveId: number, q: QualityResult): Promise<void> {
  await client.execute({
    sql: "UPDATE deep_dives SET quality_score = ?, quality_notes = ?, status = ? WHERE id = ?",
    args: [q.score, q.notes, q.flagged ? "flagged" : "published", deepDiveId],
  });
  if (q.flagged) {
    await client.execute({ sql: "UPDATE cards SET status = 'flagged' WHERE deep_dive_id = ?", args: [deepDiveId] });
  }
}
