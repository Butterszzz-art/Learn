// Phase 11 — EPUB parsing. An EPUB is a zip containing an OPF manifest/spine
// (reading order) and XHTML chapter files, plus an EPUB3 nav document or
// EPUB2 NCX for real chapter titles. Parsed with jszip + fast-xml-parser —
// both already dependencies for other reasons (export's zip, RSS's XML) —
// rather than adding an EPUB-specific package, matching this app's existing
// minimal-dependency pattern (see articleFetch.ts's hand-rolled HTML-to-text
// extractor for the same reasoning). Claude's API reads PDF natively but not
// EPUB, so this hands the chapter-processing pipeline plain extracted text
// instead — see library.ts's processChapterContentFromText.
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { decodeEntities } from "./htmlEntities";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

export interface EpubChapter {
  title: string;
  text: string;
}

export interface ParsedEpub {
  title: string;
  author: string | null;
  chapters: EpubChapter[];
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return obj["#text"];
  }
  return "";
}

function htmlToText(html: string): string {
  // Strip <head> first — its <title> would otherwise duplicate into the
  // extracted text alongside the body's own <h1>, which usually repeats it.
  const withoutHead = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, " ");
  return decodeEntities(withoutHead.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function basename(path: string): string {
  const noFragment = path.split("#")[0];
  const parts = noFragment.split("/");
  return decodeURIComponent(parts[parts.length - 1]);
}

/** Best-effort chapter titles from the EPUB3 nav document (preferred) or
 * EPUB2 NCX (fallback), keyed by filename — matched against the spine by
 * basename rather than full path, since nav/ncx hrefs are relative to
 * their own file's location, which doesn't always match the OPF's. Regex-
 * based rather than a full nested-list parse, same "good enough, no exotic
 * edge cases" bar as this app's other lightweight extractors. */
async function tryGetNavTitles(
  zip: JSZip,
  manifestItems: Record<string, unknown>[],
  opfDir: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const navItem = manifestItems.find((m) => String(m["@_properties"] ?? "").includes("nav"));
  if (navItem) {
    const navPath = opfDir + String(navItem["@_href"] ?? "");
    const navXhtml = await zip
      .file(decodeURIComponent(navPath))
      ?.async("string")
      .catch(() => null);
    if (navXhtml) {
      const linkRegex = /<a[^>]*href=["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(navXhtml)) !== null) {
        const key = basename(m[1]);
        const label = htmlToText(m[2]);
        if (key && label && !map.has(key)) map.set(key, label);
      }
      if (map.size > 0) return map;
    }
  }

  const ncxItem = manifestItems.find((m) => String(m["@_media-type"] ?? "") === "application/x-dtbncx+xml");
  if (ncxItem) {
    const ncxPath = opfDir + String(ncxItem["@_href"] ?? "");
    const ncxXml = await zip
      .file(decodeURIComponent(ncxPath))
      ?.async("string")
      .catch(() => null);
    if (ncxXml) {
      const navPointRegex = /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\s+src=["']([^"'#]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = navPointRegex.exec(ncxXml)) !== null) {
        const label = htmlToText(m[1]);
        const key = basename(m[2]);
        if (key && label && !map.has(key)) map.set(key, label);
      }
    }
  }
  return map;
}

/**
 * Parses an EPUB (base64-encoded) into its title/author and an ordered list
 * of chapters (title + plain text), following the spine's reading order.
 * Spine items shorter than a trivial threshold (cover pages, blank
 * separators) are skipped. Returns null on any structural failure — a
 * corrupt zip, no container.xml/OPF, or no readable spine content — so the
 * caller can set a clear books.error_message rather than silently failing.
 */
export async function parseEpub(base64: string): Promise<ParsedEpub | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const zip = await JSZip.loadAsync(buffer);

    const containerXml = await zip.file("META-INF/container.xml")?.async("string");
    if (!containerXml) return null;
    const container = parser.parse(containerXml);
    const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0];
    const opfPath: string | undefined = rootfile?.["@_full-path"];
    if (!opfPath) return null;

    const opfXml = await zip.file(opfPath)?.async("string");
    if (!opfXml) return null;
    const opf = parser.parse(opfXml);
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

    const metadata = opf?.package?.metadata ?? {};
    const title = textOf(metadata["dc:title"]) || "Untitled";
    const author = textOf(metadata["dc:creator"]) || null;

    const manifestItems = asArray(opf?.package?.manifest?.item) as Record<string, unknown>[];
    const manifestById = new Map<string, { href: string; mediaType: string }>();
    for (const item of manifestItems) {
      const id = String(item["@_id"] ?? "");
      if (!id) continue;
      manifestById.set(id, { href: String(item["@_href"] ?? ""), mediaType: String(item["@_media-type"] ?? "") });
    }

    const spineItems = asArray(opf?.package?.spine?.itemref) as Record<string, unknown>[];
    const spineHrefs: string[] = [];
    for (const s of spineItems) {
      const manifestItem = manifestById.get(String(s["@_idref"] ?? ""));
      if (manifestItem && /html|xhtml/i.test(manifestItem.mediaType)) {
        spineHrefs.push(opfDir + manifestItem.href);
      }
    }
    if (spineHrefs.length === 0) return null;

    const navTitles = await tryGetNavTitles(zip, manifestItems, opfDir);

    const chapters: EpubChapter[] = [];
    for (const href of spineHrefs) {
      const fileXhtml = await zip
        .file(decodeURIComponent(href))
        ?.async("string")
        .catch(() => null);
      if (!fileXhtml) continue;
      const text = htmlToText(fileXhtml);
      if (text.length < 50) continue; // skip near-empty spine items (covers, blank pages)
      const chapterTitle = navTitles.get(basename(href)) ?? `Chapter ${chapters.length + 1}`;
      chapters.push({ title: chapterTitle, text });
    }
    if (chapters.length === 0) return null;

    return { title, author, chapters };
  } catch (err) {
    console.error("[epub] Parse failed:", err);
    return null;
  }
}
