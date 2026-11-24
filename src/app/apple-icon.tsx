import { ImageResponse } from "next/og";
import { LogoMark, MARK_DARK } from "@/components/brand/LogoMark";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#120f1e" }}>
        <LogoMark size={120} colors={MARK_DARK} />
      </div>
    ),
    size
  );
}
