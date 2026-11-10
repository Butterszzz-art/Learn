"use client";

import { useState } from "react";
import type { UserPrefs } from "@/db/schema";
import { postJson } from "@/lib/ui";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Appearance, goals and notification preferences. Each change saves immediately. */
export function PrefsForm({ initial, pushAvailable }: { initial: UserPrefs; pushAvailable: boolean }) {
  const [prefs, setPrefs] = useState<UserPrefs>(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function save(patch: Partial<UserPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (patch.theme) {
      if (patch.theme === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = patch.theme;
    }
    if (patch.textScale) document.documentElement.style.setProperty("--text-scale", String(patch.textScale));
    const res = await postJson("/api/settings", patch);
    setStatus(res.ok ? "Saved." : res.error);
  }

  async function setNotifications(hour: number | null) {
    if (hour === null) {
      await save({ notifyHour: null });
      return;
    }
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("This browser doesn't support notifications. On iPhone, add Neuron to your Home Screen first.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Notifications are blocked for this site in your browser settings.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/subscribe").then((r) => r.json());
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey) as BufferSource }));
      const res = await postJson("/api/push/subscribe", sub.toJSON());
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      await save({ notifyHour: hour });
    } catch {
      setStatus("Couldn't turn notifications on.");
    }
  }

  // The stored hour is UTC; the picker shows the reader's local time.
  const offsetHours = Math.round(-new Date().getTimezoneOffset() / 60);
  const toLocal = (utc: number) => (((utc + offsetHours) % 24) + 24) % 24;
  const toUtc = (local: number) => (((local - offsetHours) % 24) + 24) % 24;
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="pref-theme" className="label">Appearance</label>
        <select id="pref-theme" className="field" value={prefs.theme ?? "system"} onChange={(e) => save({ theme: e.target.value as UserPrefs["theme"] })}>
          <option value="system">Match my device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div>
        <label htmlFor="pref-text" className="label">Text size</label>
        <select id="pref-text" className="field" value={String(prefs.textScale ?? 1)} onChange={(e) => save({ textScale: Number(e.target.value) })}>
          <option value="0.9">Smaller</option>
          <option value="1">Standard</option>
          <option value="1.15">Larger</option>
          <option value="1.3">Largest</option>
        </select>
      </div>
      <div>
        <label htmlFor="pref-goal" className="label">Daily goal</label>
        <select id="pref-goal" className="field" value={String(prefs.dailyGoal ?? 0)} onChange={(e) => save({ dailyGoal: Number(e.target.value) })}>
          <option value="0">No goal</option>
          <option value="10">10 cards a day (about 5 minutes)</option>
          <option value="20">20 cards a day</option>
          <option value="40">40 cards a day</option>
        </select>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--n-accent))]" checked={!!prefs.streakOptIn} onChange={(e) => save({ streakOptIn: e.target.checked })} />
        <span>
          <span className="block font-bold">Show a day streak</span>
          <span className="text-sm text-neuron-muted">Off by default. One missed day a week is forgiven, and you'll never be nagged about it.</span>
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--n-accent))]" checked={!!prefs.includeBrainGames} onChange={(e) => save({ includeBrainGames: e.target.checked })} />
        <span>
          <span className="block font-bold">Include brain games</span>
          <span className="text-sm text-neuron-muted">Occasional quick puzzles. A fun break — not a proven way to improve general thinking.</span>
        </span>
      </label>
      {pushAvailable && (
        <div>
          <label htmlFor="pref-notify" className="label">One daily reminder</label>
          <select
            id="pref-notify"
            className="field"
            value={prefs.notifyHour === null || prefs.notifyHour === undefined ? "off" : String(toLocal(prefs.notifyHour))}
            onChange={(e) => setNotifications(e.target.value === "off" ? null : toUtc(Number(e.target.value)))}
          >
            <option value="off">Off</option>
            {[7, 8, 9, 12, 17, 18, 19, 20, 21].map((h) => (
              <option key={h} value={h}>Around {hourLabel(h)}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-neuron-muted">At most one a day, and only when a review is due or something new has arrived.</p>
        </div>
      )}
      <p className="text-sm font-semibold text-neuron-muted" aria-live="polite">{status}</p>
    </div>
  );
}
