"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** One-click Passion Mode toggle from the feed itself (Settings also has a
 * checkbox for the same field — see InterestPicker.tsx). */
export function FavoriteToggle({ interestId, isFavorite }: { interestId: number; isFavorite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await fetch("/api/interests/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId, isFavorite: !isFavorite }),
      });
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={
        isFavorite
          ? "Favorited — remove from Passion Mode"
          : "Mark as a favorite: more deep dives per cycle, framed a notch deeper, plus Binge and topic-picking"
      }
      className={`text-lg leading-none transition ${
        isFavorite ? "text-amber-400" : "text-neuron-muted hover:text-amber-400"
      } disabled:opacity-50`}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
