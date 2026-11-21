import { getWatchRegions } from "@/lib/tmdb";

export async function GET() {
  try {
    return Response.json({ regions: await getWatchRegions() }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    return Response.json({ regions: [] }, { status: 502 });
  }
}
