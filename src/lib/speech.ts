// Plays spoken segments with the browser's speech synthesis, pausing between
// them. Free, works offline, and runs in the iOS app's web view.
import type { Segment } from "./spoken";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Speaks the segments in order. Returns a cancel function; `onDone` runs only
 * when the last segment finishes (not on cancel).
 */
export function speakSegments(segments: Segment[], onDone: () => void, rate = 1): () => void {
  if (!speechSupported()) return () => {};
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  window.speechSynthesis.cancel();

  const play = (i: number) => {
    if (cancelled) return;
    if (i >= segments.length) {
      onDone();
      return;
    }
    const u = new SpeechSynthesisUtterance(segments[i].text);
    u.rate = rate;
    const next = () => {
      if (cancelled) return;
      timer = setTimeout(() => play(i + 1), segments[i].pauseAfterMs);
    };
    u.onend = next;
    // A failed utterance (e.g. interrupted by the OS) shouldn't stall the mode.
    u.onerror = (e) => {
      if ((e as SpeechSynthesisErrorEvent).error !== "interrupted" && (e as SpeechSynthesisErrorEvent).error !== "canceled") next();
    };
    window.speechSynthesis.speak(u);
  };
  play(0);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    window.speechSynthesis.cancel();
  };
}
