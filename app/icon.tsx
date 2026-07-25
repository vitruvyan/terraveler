import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Favicon: the compass emblem on parchment, matching the map's cart-emblem
 *  button — no separate asset to keep in sync with the brand. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f2e6cf",
          borderRadius: "50%",
          fontSize: 22,
        }}
      >
        🧭
      </div>
    ),
    { ...size }
  );
}
