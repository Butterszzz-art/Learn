import { ImageResponse } from "next/og";
import { LogoMark, MARK_DARK } from "@/components/brand/LogoMark";

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
          background: "#120f1e",
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <LogoMark size={Math.round(size * (maskable ? 0.5 : 0.66))} colors={MARK_DARK} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=31536000, immutable" } }
  );
}
