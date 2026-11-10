import { ImageResponse } from "next/og";
import type { PublicCard } from "@/lib/publicCard";
import { interestHue } from "@/lib/ui";

// Edge runtime: image generation runs there; the card itself comes from the
// Node-side JSON route, since the database client is Node-only.
export const runtime = "edge";

/**
 * A share image for a card. Default is the 1200x630 link-preview size;
 * ?format=story gives a 1080x1920 vertical image for Instagram/TikTok.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const res = await fetch(new URL(`/api/public/card/${id}`, req.url));
  if (!res.ok) return new Response("Not found", { status: 404 });
  const card = (await res.json()) as PublicCard;
  const story = new URL(req.url).searchParams.get("format") === "story";
  const width = story ? 1080 : 1200;
  const height = story ? 1920 : 630;
  const hue = interestHue(card.interestId);
  const text = card.takeaway ?? card.body;
  const clipped = text.length > (story ? 420 : 200) ? text.slice(0, story ? 420 : 200).replace(/\s+\S*$/, "") + "…" : text;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: story ? 90 : 64,
          background: `linear-gradient(135deg, #120f1e 0%, #1c1830 55%, hsl(${hue} 60% 22%) 100%)`,
          color: "#f3f0ff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: story ? 40 : 28, fontWeight: 700, color: `hsl(${hue} 80% 75%)` }}>
          {card.interestName ?? "Neuron"}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: story ? 84 : 58, fontWeight: 800, lineHeight: 1.12 }}>{card.title.length > 110 ? card.title.slice(0, 110) + "…" : card.title}</div>
          <div style={{ marginTop: story ? 48 : 24, fontSize: story ? 44 : 28, lineHeight: 1.4, color: "#cfc8ea" }}>{clipped}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: story ? 38 : 26, fontWeight: 700 }}>
          <div style={{ display: "flex" }}>🧠 Neuron</div>
          <div style={{ display: "flex", color: "#a89fc9", fontWeight: 400 }}>Scroll less. Know more.</div>
        </div>
      </div>
    ),
    { width, height, headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
