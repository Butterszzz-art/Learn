// Shared HTML entity decoder used by both the RSS fetcher (fetchers/rss.ts)
// and the article-text extractor (articleFetch.ts). Handles the common named
// entities plus numeric character references generically.

/**
 * Decodes HTML entities in `input`: a handful of common named entities, plus
 * numeric character references (&#8220; and &#x2018; forms) generically via
 * String.fromCodePoint. Real-world sites (WordPress in particular) lean on
 * numeric refs heavily for curly quotes/ampersands/dashes rather than named
 * entities, so a fixed list alone leaves a lot of `&#8220;`-style junk in
 * the output.
 */
export function decodeEntities(input: string): string {
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
