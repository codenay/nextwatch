import { GENRES, type ContentType } from "@/lib/reelspace";
import { findCategory } from "@/lib/categories";
import { getBrowseFeedPage } from "@/lib/tmdb";

// GET /api/browse-feed?category=anime&type=both&page=2  (or ?genres=28) — the phone browse feed's pages.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = findCategory(searchParams.get("category"));
  const genres = (searchParams.get("genres") ?? "").split(",").map(Number).filter((id) => GENRES.some((genre) => genre.id === id));
  const requested = searchParams.get("type");
  const contentType: ContentType = requested === "movie" || requested === "tv" ? requested : "both";
  const page = Math.min(20, Math.max(1, Math.floor(Number(searchParams.get("page")) || 1)));
  if (!category && !genres.length) return Response.json({ error: "Choose a genre or category." }, { status: 400 });
  try {
    const data = await getBrowseFeedPage({ category, genres }, contentType, page);
    return Response.json(data, { headers: { "Cache-Control": "public, max-age=1800" } });
  } catch {
    return Response.json({ error: "More titles are unavailable right now.", movies: [], hasMore: false }, { status: 502 });
  }
}
