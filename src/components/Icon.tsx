// Inline SVG icons — a handful, so no icon library in the bundle.
export type IconName =
  | "feed"
  | "explore"
  | "review"
  | "library"
  | "me"
  | "settings"
  | "bookmark"
  | "share"
  | "ask"
  | "listen"
  | "stop"
  | "more"
  | "deeper"
  | "close"
  | "check"
  | "search"
  | "star"
  | "external"
  | "back";

const PATHS: Record<IconName, string> = {
  feed: "M4 5h16v6H4zM4 14h16v5H4z",
  explore: "M12 3a9 9 0 100 18 9 9 0 000-18zm3.5 5.5l-2 5-5 2 2-5z",
  review: "M4 12a8 8 0 0114-5.3V4h2v6h-6V8h2.6A6 6 0 106 12zm8-4v4.4l3 1.8-.9 1.5L11 13.4V8z",
  library: "M5 4h4v16H5zM10.5 4h4v16h-4zM16.2 5.3l3.8-1 3 14.5-3.8 1z",
  me: "M12 12a4 4 0 100-8 4 4 0 000 8zm-8 8a8 8 0 0116 0z",
  settings:
    "M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8.5 3.5l1.8 1.4-1.8 3.2-2.2-.8a7 7 0 01-1.6.9l-.3 2.3h-3.8l-.3-2.3a7 7 0 01-1.6-.9l-2.2.8-1.8-3.2L3.5 12 1.7 10.6l1.8-3.2 2.2.8a7 7 0 011.6-.9L7.6 5h3.8l.3 2.3a7 7 0 011.6.9l2.2-.8 1.8 3.2z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  share: "M16 6l-4-4-4 4h3v8h2V6zM5 12v9h14v-9h-2v7H7v-7z",
  ask: "M4 4h16v12H9l-5 4zM11 7.5h2v4h-2zm0 5h2v2h-2z",
  listen: "M4 9h4l5-4v14l-5-4H4zM16 8a5 5 0 010 8M18.5 5.5a8.5 8.5 0 010 13",
  stop: "M6 6h12v12H6z",
  more: "M5 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z",
  deeper: "M12 4v12m0 0l-5-5m5 5l5-5M5 20h14",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  search: "M10.5 4a6.5 6.5 0 104 11.6l4.4 4.4 1.4-1.4-4.4-4.4A6.5 6.5 0 0010.5 4z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  external: "M14 4h6v6M20 4l-9 9M18 13v7H4V6h7",
  back: "M15 5l-7 7 7 7",
};

const STROKED: IconName[] = ["listen", "deeper", "close", "check", "external", "back"];

export function Icon({ name, className = "h-5 w-5", filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  const stroked = STROKED.includes(name);
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill={stroked ? "none" : "currentColor"}
      fillOpacity={stroked ? undefined : filled ? 1 : 0.85}
      stroke={stroked ? "currentColor" : "none"}
      strokeWidth={stroked ? 2.2 : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
