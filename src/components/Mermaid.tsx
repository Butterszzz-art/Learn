"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a Mermaid flowchart. The library is large, so it is loaded only
 * when a diagram card is actually on screen. If the source fails to parse,
 * the caption alone is shown — a broken diagram never reaches the reader.
 */
export function Mermaid({ source, caption }: { source: string; caption: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark =
          document.documentElement.dataset.theme === "dark" ||
          (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "neutral",
          fontFamily: "inherit",
          flowchart: { htmlLabels: false, curve: "basis" },
        });
        const { svg } = await mermaid.render(`m${id}`, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  return (
    <figure className="w-full">
      {!failed && (
        <div
          ref={ref}
          role="img"
          aria-label={caption}
          className="flex min-h-[140px] w-full items-center justify-center overflow-x-auto rounded-2xl bg-neuron-surface2 p-3 [&_svg]:h-auto [&_svg]:max-w-full"
        />
      )}
      <figcaption className="mt-3 text-base leading-relaxed text-neuron-text">{caption}</figcaption>
    </figure>
  );
}
