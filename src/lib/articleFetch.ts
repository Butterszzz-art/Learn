// Phase 10 — lightweight, dependency-free "extract the main readable text
// from a webpage" helper. Used to build a genuine ~120-200 word
// abstract-style News summary for sources that don't already provide a real
// structured abstract (RSS feeds, web-search-grounded Field News Roundup
// items) — their snippet alone is too thin to summarize well.
//
// No DOM-parser dependency, matching this app's existing minimal-dependency
// pattern (see fetchers/rss.ts's stripHtml) — a full Readability-style
// extractor isn't needed since Claude does the actual reading; this just
// needs to hand it real article text instead of boilerplate.

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_CHARS = 500_000; // safety cap before regex processing
const MAX_EXTRACTED_CHARS = 6000;
// Below this, extraction probably failed (paywall stub, JS-app shell with
// no server-rendered content, etc.) — better to fall back to the thin
// snippet than feed Claude a near-empty "article".
const MIN_EXTRACTED_CHARS = 200;

const STRIP_BLOCK_TAGS = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe"];

function stripBlocks(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  return out;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&hellip;/g, "…")
    // Numeric character references (&#8220; and &#x2018; forms) — real-world
    // sites (WordPress in particular) lean on these heavily for curly
    // quotes/ampersands/dashes rather than named entities, so a fixed list
    // alone leaves a lot of `&#8220;`-style junk in the extracted text.
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    // &amp;/&lt;/&gt; last — decoding &amp; earlier would turn a literal
    // "&amp;lt;" into "&lt;" and then wrongly decode it to "<" on a second
    // pass; there is no second pass here, but keeping this order is the
    // standard safe convention (browsers decode &amp; last too).
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches `url` and extracts its main article text, best-effort. Returns
 * null on any failure — non-2xx response, non-HTML content type, timeout,
 * or extracted text too short to plausibly be the real article — so
 * callers can fall back to whatever thin snippet they already have rather
 * than blocking (or degrading) the whole News refresh on one flaky page.
 */
export async function fetchArticleText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // A browser-like UA — some publishers block non-browser clients
        // outright. This fetches a single already-public article page per
        // News item for personal-use summarization, same spirit as the
        // RSS fetching already done elsewhere in this app.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) return null;

    let html = await res.text();
    if (html.length > MAX_HTML_CHARS) html = html.slice(0, MAX_HTML_CHARS);

    html = stripBlocks(html, STRIP_BLOCK_TAGS);

    // Prefer the <article> block when present — usually the actual piece,
    // without whatever site chrome survived the strips above.
    const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    const mainHtml = articleMatch ? articleMatch[1] : (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html);

    const text = htmlToText(mainHtml).slice(0, MAX_EXTRACTED_CHARS);
    if (text.length < MIN_EXTRACTED_CHARS) return null;
    return text;
  } catch (err) {
    console.error(`[articleFetch] Failed to fetch/extract "${url}":`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
