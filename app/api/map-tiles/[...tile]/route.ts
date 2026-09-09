import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TILE_PATH = /^(\d+)\/(\d+)\/(\d+)\.png$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tile: string[] }> },
) {
  const parts = (await params).tile;
  const tilePath = parts.join("/");
  const match = tilePath.match(TILE_PATH);
  if (!match) return new NextResponse("Invalid tile path", { status: 400 });

  const [, zoom, x, y] = match;
  const upstream = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

  const response = await fetch(upstream, {
    headers: { "User-Agent": "Terraveler/1.0 basemap proxy" },
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    return new NextResponse("Basemap tile unavailable", { status: response.status });
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Type": response.headers.get("content-type") ?? "image/png",
    },
  });
}
