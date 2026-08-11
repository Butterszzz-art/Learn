import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { db } from "@/db";
import { deepDives, interests, bookChapters, books } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { LEVEL_LABELS } from "@/db/schema";
import type { DeepDiveDetail, ChapterDetail, ExplainBackEntry } from "./digest";

// ---------------------------------------------------------------------------
// Filenames — "Neuroscience/2026-08-11-synaptic-pruning-rewrites-old-
// assumptions.md" per the spec's own example.
// ---------------------------------------------------------------------------

// Same codepoint-range check as dedupe.ts's stripDiacritics — avoids a
// regex character class containing literal combining-diacritic characters,
// which don't survive some text pipelines intact.
const COMBINING_DIACRITICS_START = 0x0300;
const COMBINING_DIACRITICS_END = 0x036f;

function stripDiacritics(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= COMBINING_DIACRITICS_START && code <= COMBINING_DIACRITICS_END) continue;
    out += ch;
  }
  return out;
}

export function slugify(text: string): string {
  const slug = stripDiacritics(text.toLowerCase().normalize("NFKD"))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

function datePart(dateIso: string): string {
  const d = new Date(dateIso);
  return isNaN(d.getTime()) ? "undated" : d.toISOString().slice(0, 10);
}

export function exportFilename(dateIso: string, title: string): string {
  return `${datePart(dateIso)}-${slugify(title)}.md`;
}

/** The wiki-link target (Obsidian convention: the note's basename, no
 * extension, no folder). */
export function exportBasename(dateIso: string, title: string): string {
  return exportFilename(dateIso, title).replace(/\.md$/, "");
}

// ---------------------------------------------------------------------------
// Markdown builders — one per exportable content type.
// ---------------------------------------------------------------------------

function explainBacksSection(entries: ExplainBackEntry[]): string {
  if (entries.length === 0) return "";
  const blocks = entries
    .slice()
    .reverse() // oldest first, reading order
    .map((e) => {
      const date = datePart(e.createdAt);
      return `### ${date}\n\n**My explanation:**\n${e.userExplanation}\n\n**Feedback:**\n${e.feedback}`;
    });
  return `\n\n## Explain It Back\n\n${blocks.join("\n\n")}`;
}

function relatedSection(relatedLinks: string[]): string {
  if (relatedLinks.length === 0) return "";
  return `\n\n## Related\n\n${relatedLinks.map((f) => `- [[${f}]]`).join("\n")}`;
}

export function buildDeepDiveMarkdown(detail: DeepDiveDetail, relatedLinks: string[] = []): string {
  const parts: string[] = [];
  parts.push(`# ${detail.topic}`);
  parts.push(
    `**Interest:** ${detail.interestName} · **Level:** ${LEVEL_LABELS[detail.level]} · **Date:** ${datePart(detail.createdAt)}`
  );
  parts.push(detail.content);
  if (detail.appliedInsight) {
    parts.push(`## Applied Insight\n\n${detail.appliedInsight}`);
  }
  if (detail.sources.length > 0) {
    parts.push(`## Sources\n\n${detail.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}`);
  }
  let body = parts.join("\n\n");
  body += explainBacksSection(detail.explainBacks);
  body += relatedSection(relatedLinks);
  return body + "\n";
}

export function buildChapterMarkdown(detail: ChapterDetail, relatedLinks: string[] = []): string {
  const parts: string[] = [];
  parts.push(`# ${detail.title}`);
  parts.push(`**Book:** ${detail.bookTitle} · **Chapter:** ${detail.chapterNumber}`);
  if (detail.summary) parts.push(detail.summary);
  if (detail.keyConcepts.length > 0) {
    parts.push(
      `## Key Concepts\n\n${detail.keyConcepts.map((c) => `- **${c.term}** — ${c.definition}`).join("\n")}`
    );
  }
  if (detail.notableArguments.length > 0) {
    parts.push(`## Notable Arguments\n\n${detail.notableArguments.map((a) => `- ${a}`).join("\n")}`);
  }
  if (detail.quotes.length > 0) {
    parts.push(`## Quotes\n\n${detail.quotes.map((q) => `> ${q}`).join("\n\n")}`);
  }
  let body = parts.join("\n\n");
  body += explainBacksSection(detail.explainBacks);
  body += relatedSection(relatedLinks);
  return body + "\n";
}

export function buildExplainBackMarkdown(entry: ExplainBackEntry, parentTitle: string): string {
  return (
    `# Explain It Back — ${parentTitle}\n\n` +
    `**Date:** ${datePart(entry.createdAt)}\n\n` +
    `## My explanation\n\n${entry.userExplanation}\n\n` +
    `## Feedback\n\n${entry.feedback}\n`
  );
}

// ---------------------------------------------------------------------------
// Markdown -> PDF. Pure-JS (pdfkit — no native deps, no headless-browser
// dependency), matching this app's existing minimal-dependency pattern. A
// deliberately simple line-based renderer — headings, **bold** inline
// segments, bullet lists, block quotes, horizontal rules, and paragraphs —
// not a full CommonMark implementation, which this export doesn't need.
// ---------------------------------------------------------------------------

function renderInline(doc: PDFKit.PDFDocument, text: string, size: number, opts: PDFKit.Mixins.TextOptions = {}) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s.length > 0);
  if (segments.length === 0) {
    doc.font("Helvetica").fontSize(size).text("", opts);
    return;
  }
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    const isBold = seg.startsWith("**") && seg.endsWith("**");
    doc
      .font(isBold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .text(isBold ? seg.slice(2, -2) : seg, { ...opts, continued: !isLast });
  });
}

export function markdownToPdf(markdown: string, docTitle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, info: { Title: docTitle } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const raw of markdown.split("\n")) {
      const line = raw.trimEnd();
      if (line.startsWith("### ")) {
        doc.moveDown(0.6);
        doc.font("Helvetica-Bold").fontSize(13).text(line.slice(4));
      } else if (line.startsWith("## ")) {
        doc.moveDown(0.8);
        doc.font("Helvetica-Bold").fontSize(15).text(line.slice(3));
      } else if (line.startsWith("# ")) {
        doc.font("Helvetica-Bold").fontSize(20).text(line.slice(2));
        doc.moveDown(0.3);
      } else if (/^[-*]\s+/.test(line)) {
        doc.moveDown(0.15);
        renderInline(doc, line.replace(/^[-*]\s+/, ""), 11, { indent: 14 });
      } else if (/^>\s?/.test(line)) {
        doc.moveDown(0.15);
        doc.font("Helvetica-Oblique").fontSize(11).text(line.replace(/^>\s?/, ""), { indent: 14 });
      } else if (/^-{3,}$/.test(line)) {
        doc.moveDown(0.3);
        const y = doc.y;
        doc
          .moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y)
          .strokeColor("#999999")
          .stroke();
        doc.moveDown(0.3);
      } else if (line.trim() === "") {
        doc.moveDown(0.5);
      } else {
        doc.moveDown(0.15);
        renderInline(doc, line, 11);
      }
    }
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Bulk export — one zip of markdown files, folder-per-interest/book, with
// [[wiki-links]] between files that share a covered topic/key concept.
// ---------------------------------------------------------------------------

interface ExportableFile {
  contentType: "deep_dive" | "chapter";
  folder: string;
  basename: string;
  keywords: string[]; // lowercased topic/key-concept strings, for wiki-linking
}

/** Builds the exportable-file index once (folder + basename + the topic
 * keywords it should link on), used both to render each file's own
 * metadata and to find what else to [[link]] from it. Exact (case-
 * insensitive) topic-string matches only — "where practical" per the spec;
 * this app doesn't have a real concept graph to do fuzzier matching from. */
async function buildExportableFileIndex(): Promise<{
  dives: (typeof deepDives.$inferSelect & { interestName: string })[];
  chapters: (typeof bookChapters.$inferSelect & { bookTitle: string })[];
  files: ExportableFile[];
  keywordMap: Map<string, ExportableFile[]>;
}> {
  const [diveRows, interestRows, chapterRows, bookRows] = await Promise.all([
    db.select().from(deepDives),
    db.select().from(interests),
    db.select().from(bookChapters).where(isNotNull(bookChapters.summary)),
    db.select().from(books),
  ]);
  const interestNameById = new Map(interestRows.map((i) => [i.id, i.name]));
  const bookTitleById = new Map(bookRows.map((b) => [b.id, b.title]));

  const dives = diveRows.map((d) => ({ ...d, interestName: interestNameById.get(d.interestId) ?? "Unknown" }));
  const chapters = chapterRows.map((c) => ({ ...c, bookTitle: bookTitleById.get(c.bookId) ?? "book" }));

  const files: ExportableFile[] = [];
  for (const d of dives) {
    files.push({
      contentType: "deep_dive",
      folder: d.interestName,
      basename: exportBasename(d.createdAt, d.topic),
      keywords: [d.topic.toLowerCase()],
    });
  }
  for (const c of chapters) {
    let keyConcepts: { term: string }[] = [];
    try {
      keyConcepts = JSON.parse(c.keyConcepts);
    } catch {
      keyConcepts = [];
    }
    files.push({
      contentType: "chapter",
      folder: `Library - ${c.bookTitle}`,
      basename: exportBasename(new Date().toISOString(), `${c.chapterNumber}-${c.title}`),
      keywords: [c.title.toLowerCase(), ...keyConcepts.map((k) => k.term.toLowerCase())],
    });
  }

  const keywordMap = new Map<string, ExportableFile[]>();
  for (const f of files) {
    for (const kw of f.keywords) {
      if (!keywordMap.has(kw)) keywordMap.set(kw, []);
      keywordMap.get(kw)!.push(f);
    }
  }

  return { dives, chapters, files, keywordMap };
}

function relatedLinksFor(file: ExportableFile, keywordMap: Map<string, ExportableFile[]>): string[] {
  const related = new Set<string>();
  for (const kw of file.keywords) {
    for (const match of keywordMap.get(kw) ?? []) {
      if (match.basename !== file.basename) related.add(match.basename);
    }
  }
  return [...related];
}

/**
 * Every Deep Dive and every Library chapter with generated content, as
 * markdown files in a zip, organized `<Interest or Library - Book>/<date>-
 * <slug>.md` — droppable directly into a tool like Obsidian as a folder of
 * notes. Wiki-links are inserted between files that share an (exact,
 * case-insensitive) topic/key-concept string.
 */
export async function generateFullExportZip(): Promise<Buffer> {
  const { dives, chapters, files, keywordMap } = await buildExportableFileIndex();
  const zip = new JSZip();

  const diveFileByIndex = files.filter((f) => f.contentType === "deep_dive");
  dives.forEach((d, i) => {
    const file = diveFileByIndex[i];
    const related = relatedLinksFor(file, keywordMap);
    const detail: DeepDiveDetail = {
      id: d.id,
      interestId: d.interestId,
      topic: d.topic,
      content: d.content,
      sources: safeParseArray(d.sources),
      level: d.level,
      interestName: d.interestName,
      interestSlug: "",
      createdAt: d.createdAt,
      appliedInsight: null,
      followUpTopics: [],
      selfCheckQuestions: [],
      essayPrompt: null,
      explainBacks: [],
    };
    const md = buildDeepDiveMarkdown(detail, related);
    zip.file(`${file.folder}/${file.basename}.md`, md);
  });

  const chapterFileByIndex = files.filter((f) => f.contentType === "chapter");
  chapters.forEach((c, i) => {
    const file = chapterFileByIndex[i];
    const related = relatedLinksFor(file, keywordMap);
    const detail: ChapterDetail = {
      id: c.id,
      bookId: c.bookId,
      bookTitle: c.bookTitle,
      chapterNumber: c.chapterNumber,
      title: c.title,
      summary: c.summary,
      keyConcepts: safeParseArray(c.keyConcepts),
      notableArguments: safeParseArray(c.notableArguments),
      quotes: safeParseArray(c.quotes),
      explainBacks: [],
    };
    const md = buildChapterMarkdown(detail, related);
    zip.file(`${file.folder}/${file.basename}.md`, md);
  });

  return zip.generateAsync({ type: "nodebuffer" });
}

function safeParseArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
