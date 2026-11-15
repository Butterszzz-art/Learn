"use client";

import { useEffect } from "react";

/** One-time browser setup: service worker registration and error reporting. */
export function ClientBoot() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    let sent = 0;
    const report = (message: string, detail?: string) => {
      if (sent++ >= 5) return; // a broken page shouldn't flood the log
      try {
        navigator.sendBeacon?.(
          "/api/client-error",
          new Blob([JSON.stringify({ message, detail: `${location.pathname}\n${detail ?? ""}` })], { type: "application/json" })
        );
      } catch {}
    };
    const onError = (e: ErrorEvent) => report(e.message || "Script error", e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => report(String(e.reason?.message ?? e.reason ?? "Unhandled rejection"), e.reason?.stack);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
