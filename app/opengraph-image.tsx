import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Terraveler — an atlas of geo-history, written in tandem";

/** Default OG/Twitter card for the site and any page without its own. Pure
 *  ImageResponse (no external fonts/images) so it never depends on remote
 *  fetches at build or request time. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f2e6cf",
          fontFamily: "Georgia, serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 28,
            border: "2px solid #2b2117",
            borderRadius: 14,
          }}
        />
        <div
          style={{
            width: 94,
            height: 94,
            borderRadius: "50%",
            border: "3px solid #2b2117",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 46,
            color: "#2b2117",
            fontWeight: 700,
            marginBottom: 18,
          }}
        >
          N
        </div>
        <div style={{ fontSize: 76, color: "#2b2117", letterSpacing: 2, fontWeight: 700 }}>
          TERRAVELER
        </div>
        <div style={{ fontSize: 30, color: "#5a4a34", marginTop: 14, fontStyle: "italic" }}>
          An atlas of geo-history, written in tandem
        </div>
      </div>
    ),
    { ...size }
  );
}
