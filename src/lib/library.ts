import { getAnthropicClient } from "./claude";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// Very long chapters are split into page windows (PDF) or character windows
// (EPUB/URL article text) and merged, rather than asking Claude to hold an
// enormous span in one pass.
const MAX_PAGES_PER_WINDOW = 40;
// Roughly analogous to MAX_PAGES_PER_WINDOW for plain-text sources — about
// 40 pages' worth of prose at a rough 750 chars/page estimate.
const MAX_CHARS_PER_WINDOW = 30000;
// Per-chapter content caps after merging windows, so a many-window chapter
// doesn't produce an unbounded notebook entry.
const MAX_KEY_CONCEPTS = 12;
const MAX_NOTABLE_ARGUMENTS = 8;
const MAX_QUOTES = 6;

function pdfDocumentBlock(base64Pdf: string) {
  // Anthropic's PDF document support: the model reads both the extracted
  // text layer and page images natively — this is why book content comes
  // from here, not a separate text-extraction library (per spec). Same
  // ephemeral cache_control pattern as prompt caching elsewhere in the
  // Anthropic API — the base64 bytes are identical across every call for
  // one book (structure pass + N chapter passes), so caching keeps the
  // "process a whole book" cost closer to "pay for the PDF once."
  return {
    type: "document" as const,
    source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64Pdf },
    cache_control: { type: "ephemeral" as const },
  };
}

export interface ChapterOutline {
  number: number;
  title: string;
  startPage: number;
  endPage: number;
}

export interface BookStructureResult {
  readable: boolean;
  unreadableReason: string | null;
  title: string | null;
  author: string | null;
  chapters: ChapterOutline[];
}

/**
 * First pass: identifies the book's title/author and chapter/section
 * structure with approximate page ranges. Explicitly asks the model to
 * flag an unreadable (e.g. scanned image-only, no text layer) PDF rather
 * than guessing at a fabricated structure — callers should treat
 * readable=false as a hard stop, not a retry.
 */
export async function identifyBookStructure(base64Pdf: string): Promise<BookStructureResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              readable: {
                type: "boolean",
                description:
                  "False if this PDF has no meaningfully extractable text (e.g. a scanned image-only " +
                  "book with no OCR text layer) — you genuinely cannot read its content, not just that " +
                  "it looks difficult. True otherwise.",
              },
              unreadableReason: {
                type: "string",
                description: "If readable is false, a one-sentence explanation why. Empty string otherwise.",
              },
              title: { type: "string", description: "The book's title. Empty string if readable is false." },
              author: { type: "string", description: "The book's author. Empty string if unknown or unreadable." },
              chapters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    number: { type: "integer" },
                    title: { type: "string" },
                    startPage: { type: "integer", description: "1-based page number this chapter starts on." },
                    endPage: { type: "integer", description: "1-based page number this chapter ends on." },
                  },
                  required: ["number", "title", "startPage", "endPage"],
                  additionalProperties: false,
                },
                description: "Empty array if readable is false.",
              },
            },
            required: ["readable", "unreadableReason", "title", "author", "chapters"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            pdfDocumentBlock(base64Pdf),
            {
              type: "text",
              text:
                "Identify this book's title, author, and its chapter/section structure with approximate " +
                "page ranges for each. If this PDF has no meaningfully extractable text (a scanned " +
                "image-only book with no text layer you can actually read), set readable to false and " +
                "explain why instead of guessing at a structure.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as BookStructureResult;

    if (!parsed.readable) {
      return { ...parsed, title: null, author: null, chapters: [] };
    }
    if (!parsed.chapters?.length) return null;
    return parsed;
  } catch (err) {
    console.error("[library] Book structure identification failed:", err);
    return null;
  }
}

export interface ChapterContentResult {
  summary: string;
  keyConcepts: { term: string; definition: string }[];
  notableArguments: string[];
  quotes: string[];
}

const CHAPTER_CONTENT_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string",
      description:
        "A thorough, multi-paragraph summary in your own words — original synthesis, not close " +
        "paraphrase or reproduction of the source text.",
    },
    keyConcepts: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, definition: { type: "string" } },
        required: ["term", "definition"],
        additionalProperties: false,
      },
      description: "The chapter's key terms/concepts and a short definition of each, in your own words.",
    },
    notableArguments: {
      type: "array",
      items: { type: "string" },
      description:
        "Claims or arguments this chapter makes, stated plainly — grounding material for later " +
        "critical-thinking drills.",
    },
    quotes: {
      type: "array",
      items: { type: "string" },
      description:
        "A handful of SHORT standout lines only, a few words each — never long verbatim passages. Same " +
        "sparing-quotation standard as this app's News pipeline.",
    },
  },
  required: ["summary", "keyConcepts", "notableArguments", "quotes"],
  additionalProperties: false,
};

async function processChapterWindow(
  base64Pdf: string,
  bookTitle: string,
  chapter: ChapterOutline,
  windowStart: number,
  windowEnd: number
): Promise<ChapterContentResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3072,
      output_config: { format: { type: "json_schema", schema: CHAPTER_CONTENT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            pdfDocumentBlock(base64Pdf),
            {
              type: "text",
              text:
                `This is "${bookTitle}". Focus specifically on Chapter ${chapter.number}, "${chapter.title}" ` +
                `— pages ${windowStart}-${windowEnd} of that chapter's overall range (pages ` +
                `${chapter.startPage}-${chapter.endPage}). Write a thorough summary, key concepts, notable ` +
                "arguments/claims, and a few short standout quotes for this portion. Original synthesis in " +
                "your own words — not close paraphrase or reproduction of the source text.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return JSON.parse(textBlock.text) as ChapterContentResult;
  } catch (err) {
    console.error(`[library] Chapter window processing failed for "${bookTitle}" ch.${chapter.number}:`, err);
    return null;
  }
}

/**
 * Generates a chapter's full notebook entry — summary, key concepts,
 * notable arguments, quotes. Splits very long chapters into page windows
 * (each its own Claude call) and merges the results, rather than asking
 * for an enormous span in one pass. Returns null if every window fails.
 */
export async function processChapterContent(
  base64Pdf: string,
  bookTitle: string,
  chapter: ChapterOutline
): Promise<ChapterContentResult | null> {
  const span = Math.max(1, chapter.endPage - chapter.startPage + 1);
  const windowCount = Math.max(1, Math.ceil(span / MAX_PAGES_PER_WINDOW));

  const windows: { start: number; end: number }[] = [];
  const pagesPerWindow = Math.ceil(span / windowCount);
  for (let i = 0; i < windowCount; i++) {
    const start = chapter.startPage + i * pagesPerWindow;
    const end = Math.min(chapter.endPage, start + pagesPerWindow - 1);
    windows.push({ start, end });
  }

  const results = await Promise.all(
    windows.map((w) => processChapterWindow(base64Pdf, bookTitle, chapter, w.start, w.end))
  );
  return mergeChapterContentResults(results);
}

/** Same window-and-merge shape as processChapterWindow, but for a source
 * with no real Claude PDF support (EPUB, a fetched URL article) — the
 * caller already has the chapter's plain text (see epub.ts / articleFetch's
 * fetchArticleText), so this sends it as a text content block instead of a
 * PDF document block. Same output schema either way. */
async function processChapterWindowFromText(
  bookTitle: string,
  chapterTitle: string,
  windowText: string,
  windowLabel: string
): Promise<ChapterContentResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3072,
      output_config: { format: { type: "json_schema", schema: CHAPTER_CONTENT_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `This is "${bookTitle}", chapter "${chapterTitle}"${windowLabel ? ` (${windowLabel})` : ""}. ` +
            "Write a thorough summary, key concepts, notable arguments/claims, and a few short " +
            "standout quotes for this text. Original synthesis in your own words — not close " +
            "paraphrase or reproduction of the source text.\n\n---\n\n" +
            windowText,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return JSON.parse(textBlock.text) as ChapterContentResult;
  } catch (err) {
    console.error(`[library] Text-chapter window processing failed for "${bookTitle}" — "${chapterTitle}":`, err);
    return null;
  }
}

/**
 * Text-source equivalent of processChapterContent — for EPUB chapters and
 * single-"chapter" URL articles, whose full plain text is already known (no
 * PDF document support needed, or possible, from Claude's side). Splits
 * very long text into character-count windows rather than page windows, but
 * shares the exact same merge/output shape.
 */
export async function processChapterContentFromText(
  bookTitle: string,
  chapterTitle: string,
  fullText: string
): Promise<ChapterContentResult | null> {
  const windowCount = Math.max(1, Math.ceil(fullText.length / MAX_CHARS_PER_WINDOW));
  const charsPerWindow = Math.ceil(fullText.length / windowCount);

  const windows: string[] = [];
  for (let i = 0; i < windowCount; i++) {
    windows.push(fullText.slice(i * charsPerWindow, (i + 1) * charsPerWindow));
  }

  const results = await Promise.all(
    windows.map((w, i) =>
      processChapterWindowFromText(bookTitle, chapterTitle, w, windowCount > 1 ? `part ${i + 1} of ${windowCount}` : "")
    )
  );
  return mergeChapterContentResults(results);
}

/** Shared by both the PDF-windowed and text-windowed paths — merges each
 * window's independent result into one chapter entry, deduping and capping
 * so a many-window chapter doesn't produce an unbounded notebook entry.
 * Returns null if every window failed. */
function mergeChapterContentResults(results: (ChapterContentResult | null)[]): ChapterContentResult | null {
  const successful = results.filter((r): r is ChapterContentResult => r !== null);
  if (successful.length === 0) return null;

  return {
    summary: successful.map((r) => r.summary).join("\n\n"),
    keyConcepts: dedupeBy(
      successful.flatMap((r) => r.keyConcepts),
      (c) => c.term.toLowerCase()
    ).slice(0, MAX_KEY_CONCEPTS),
    notableArguments: dedupeBy(
      successful.flatMap((r) => r.notableArguments),
      (a) => a.toLowerCase()
    ).slice(0, MAX_NOTABLE_ARGUMENTS),
    quotes: dedupeBy(
      successful.flatMap((r) => r.quotes),
      (q) => q.toLowerCase()
    ).slice(0, MAX_QUOTES),
  };
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
