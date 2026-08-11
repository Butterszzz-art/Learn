// Phase 10 — lightweight, dependency-free "extract the main readable text
// from a webpage" helper. Used to build a genuine ~120-200 word
// abstract-style News summary for sources that don't already provide a real
// structured abstract (RSS feeds, web-search-grounded Field News Roundup
// items) — their snippet alone is too thin to summarize well. Phase 11
// reuses the same fetch/extract machinery for Library's url_article input
// format (see fetchArticleWithTitle), which additionally needs the page's
// title (a Library "book" needs a title; a News item already has one from
// its RSS feed/roundup, so fetchArticleText alone never needed it).
//
// No DOM-parser dependency, matching this app's existing minimal-dependency
// pattern (see fetchers/rss.ts's stripHtml) — a full Readability-style
// extractor isn't needed since Claude does the actual reading; this just
// needs to hand it real article text instead of boilerplate.

import { decodeEntities } from "./htmlEntities";

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

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(rawHtml: string): string {
  // Prefer the first <h1> — usually the real headline, without the
  // " | Site Name" suffix a <title> tag commonly carries.
  const h1Match = rawHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? htmlToText(h1Match[1]) : "";
  if (h1Text.length > 3) return h1Text;

  const titleMatch = rawHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? htmlToText(titleMatch[1]) : "";
}

interface FetchedPage {
  title: string;
  text: string;
}

/** Shared fetch + extraction core for both exports below — one network
 * fetch, used to derive either just the body text or {title, text}. */
async function fetchAndExtract(url: string): Promise<FetchedPage | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // A browser-like UA — some publishers block non-browser clients
        // outright. This fetches a single already-public page for
        // personal-use summarization/note-taking, same spirit as the RSS
        // fetching already done elsewhere in this app.
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

    const title = extractTitle(html);
    const stripped = stripBlocks(html, STRIP_BLOCK_TAGS);

    // Prefer the <article> block when present — usually the actual piece,
    // without whatever site chrome survived the strips above.
    const articleMatch = stripped.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    const mainHtml = articleMatch ? articleMatch[1] : (stripped.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? stripped);

    const text = htmlToText(mainHtml).slice(0, MAX_EXTRACTED_CHARS);
    if (text.length < MIN_EXTRACTED_CHARS) return null;
    return { title, text };
  } catch (err) {
    console.error(`[articleFetch] Failed to fetch/extract "${url}":`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches `url` and extracts its main article text, best-effort. Returns
 * null on any failure — non-2xx response, non-HTML content type, timeout,
 * or extracted text too short to plausibly be the real article — so
 * callers can fall back to whatever thin snippet they already have rather
 * than blocking (or degrading) the whole News refresh on one flaky page.
 */
export async function fetchArticleText(url: string): Promise<string | null> {
  const page = await fetchAndExtract(url);
  return page?.text ?? null;
}

/** Same extraction as fetchArticleText, but also returns the page's title
 * — Library's url_article input format needs one (a News item already has
 * its own title from the RSS feed/roundup, so fetchArticleText alone never
 * needed this). Falls back to a generic title if none could be extracted,
 * rather than returning null and discarding a perfectly good body extract. */
export async function fetchArticleWithTitle(url: string): Promise<{ title: string; text: string } | null> {
  const page = await fetchAndExtract(url);
  if (!page) return null;
  return { title: page.title || "Untitled Article", text: page.text };
}
