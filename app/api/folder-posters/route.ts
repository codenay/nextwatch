import { getFolderPosters, POSTER_TILE_COUNT } from "@/lib/tmdb";
import type { ContentType } from "@/lib/reelspace";

export async function GET(request: Request) {
  const requestedType = new URL(request.url).searchParams.get("type") ?? "both";
  const contentType: ContentType = requestedType === "movie" || requestedType === "tv" ? requestedType : "both";
  try {
    const posters = await getFolderPosters(contentType);
    // Only let browsers keep a complete set; a partial one should be re-asked for on the next visit.
    const complete = Object.keys(posters).length >= POSTER_TILE_COUNT;
    return Response.json({ genres: posters }, { headers: { "Cache-Control": complete ? "private, max-age=900" : "no-store" } });
  } catch {
    return Response.json({ error: "Poster previews are temporarily unavailable." }, { status: 502 });
  }
}
