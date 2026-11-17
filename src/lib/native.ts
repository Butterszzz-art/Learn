"use client";

/**
 * Thin layer over the Capacitor native shell (iOS app). Every function is a
 * no-op or falls back to the web API when the page runs in a normal browser,
 * so callers never need to check the platform themselves.
 *
 * The iOS app loads the deployed site (server.url in capacitor.config.json);
 * the native bridge is injected into that page, which is what makes
 * Capacitor.isNativePlatform() true there.
 */
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** A light tap, e.g. on swipe or save. */
export function tap(): void {
  if (isNativeApp()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  else navigator.vibrate?.(10);
}

/** Success / error feedback, e.g. for quiz answers. */
export function feedback(ok: boolean): void {
  if (isNativeApp()) Haptics.notification({ type: ok ? NotificationType.Success : NotificationType.Error }).catch(() => {});
  else navigator.vibrate?.(ok ? 12 : [20, 40, 20]);
}

/**
 * Opens the share sheet. Resolves true if a sheet was shown (whether or not
 * the reader went through with it), false if there is no share sheet and the
 * caller should fall back to copying.
 */
export async function shareLink(data: { title: string; text?: string; url: string }): Promise<boolean> {
  if (isNativeApp()) {
    try {
      await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title });
    } catch {
      // dismissed
    }
    return true;
  }
  if (navigator.share) {
    try {
      await navigator.share(data);
    } catch {
      // dismissed
    }
    return true;
  }
  return false;
}

let started = false;

/**
 * One-time native setup: status bar, splash screen, and opening links to
 * other sites in an in-app Safari sheet instead of navigating the app away.
 */
export function startNative(): void {
  if (started || !isNativeApp()) return;
  started = true;
  document.documentElement.dataset.native = "ios";

  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches || document.documentElement.dataset.theme === "dark";
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  SplashScreen.hide().catch(() => {});

  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return; // mailto:, tel: etc. go to iOS
      if (url.origin === location.origin) return;
      e.preventDefault();
      Browser.open({ url: url.toString(), presentationStyle: "popover" }).catch(() => {
        window.open(url.toString(), "_blank");
      });
    },
    true
  );
}
