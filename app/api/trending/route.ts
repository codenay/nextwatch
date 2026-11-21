import { getTrendingMap } from "@/lib/tmdb";
import type { ContentType } from "@/lib/reelspace";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const requestedType = searchParams.get("type") ?? "both";
  const contentType: ContentType = requestedType === "movie" || requestedType === "tv" ? requestedType : "both";
  const shuffle = searchParams.get("shuffle") === "1";
  const exclude = searchParams.get("exclude")?.slice(0, 40) ?? undefined;
  try {
    const map = await getTrendingMap(contentType, { shuffle, exclude });
    // Never cache shuffles or the offline preview: each request should be fresh.
    return Response.json(map, { headers: { "Cache-Control": map.configured && !shuffle ? "private, max-age=300" : "no-store" } });
  } catch {
    return Response.json({ error: "Today’s trending map is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
