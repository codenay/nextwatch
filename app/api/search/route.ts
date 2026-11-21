import { searchMovies } from "@/lib/tmdb";
import type { ContentType } from "@/lib/reelspace";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q")?.trim() ?? "";
  const requestedType = searchParams.get("type") ?? "both";
  const contentType: ContentType = requestedType === "movie" || requestedType === "tv" ? requestedType : "both";
  if (query.length < 2 || query.length > 80) return Response.json({ error: "Enter between 2 and 80 characters." }, { status: 400 });
  try { return Response.json({ movies: await searchMovies(query, contentType) }); }
  catch { return Response.json({ error: "Title search is temporarily unavailable. Please try again." }, { status: 503 }); }
}
