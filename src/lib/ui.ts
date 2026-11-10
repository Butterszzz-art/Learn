// Small client-safe display helpers.

// Each interest gets a stable accent hue so cards are recognisable at a
// glance. Chosen to stay legible on both themes at the lightness used.
const HUES = [262, 330, 174, 28, 205, 142, 290, 48, 0, 232];

export function interestHue(interestId: number | null | undefined): number {
  if (interestId === null || interestId === undefined) return HUES[0];
  return HUES[Math.abs(interestId) % HUES.length];
}

/** CSS custom properties for an interest-tinted element. */
export function interestStyle(interestId: number | null | undefined): React.CSSProperties {
  const h = interestHue(interestId);
  return {
    "--ic": `hsl(${h} 70% 55%)`,
    "--ic-soft": `hsl(${h} 70% 55% / 0.14)`,
  } as React.CSSProperties;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(text.trim().split(/\s+/).length / 220));
}

export async function postJson<T = any>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data: res.ok ? data : null, error: res.ok ? null : data?.error ?? "Something went wrong" };
  } catch {
    return { ok: false, status: 0, data: null, error: "You appear to be offline." };
  }
}
