import { ImageResponse } from "next/og";

export const runtime = "edge";

// App icons generated on request (and cached hard), so there are no binary
// assets to keep in sync. ?maskable=1 adds the safe-zone padding Android wants.
export async function GET(req: Request, { params }: { params: { size: string } }) {
  const size = [180, 192, 512].includes(Number(params.size)) ? Number(params.size) : 192;
  const maskable = new URL(req.url).searchParams.get("maskable") === "1";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)",
          borderRadius: maskable ? 0 : size * 0.22,
          fontSize: size * (maskable ? 0.42 : 0.56),
        }}
      >
        🧠
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=31536000, immutable" } }
  );
}
