"use client";

import { useState } from "react";
import { shareLink } from "@/lib/native";

/** Shares a short text with a link to the app; falls back to copying it. */
export function ShareTextButton({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = location.origin;
    if (await shareLink({ title, text, url })) return;
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  return (
    <button type="button" className="btn-primary" onClick={share}>
      {copied ? "Copied" : "Share my week"}
    </button>
  );
}
