import { GENRES, isMoodSlug, type ContentType } from "@/lib/reelspace";
import { getCategoryRecommendations, getRecommendations } from "@/lib/tmdb";
import { findCategory } from "@/lib/categories";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genreIds = (searchParams.get("genres") ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number)
    .filter((id) => Number.isInteger(id) && GENRES.some((genre) => genre.id === id));
  const moods = (searchParams.get("moods") ?? "").split(",").filter(isMoodSlug);
  const requestedType = searchParams.get("type") ?? "both";
  const contentType: ContentType = requestedType === "movie" || requestedType === "tv" ? requestedType : "both";
  const category = findCategory(searchParams.get("category"));
  if (!genreIds.length && !category) {
    return Response.json({ error: "Choose a genre or category." }, { status: 400 });
  }

  try {
    const data = category
      ? await getCategoryRecommendations(category, [...new Set(moods)], contentType)
      : await getRecommendations([...new Set(genreIds)], [...new Set(moods)], contentType);
    return Response.json(data, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_RESULTS") {
      return Response.json({ error: "Nothing matched that combination yet. Try another mood, or switch between movies and series." }, { status: 404 });
    }
    const message = error instanceof Error && error.message === "TMDB_401"
      ? "The catalogue connection needs attention."
      : "Recommendations are temporarily unavailable.";
    return Response.json({ error: message }, { status: 502 });
  }
}
