import { getMovieMap } from "@/lib/tmdb";
import type { MediaType } from "@/lib/reelspace";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Choose a title from the live catalogue." }, { status: 400 });
  const requestedType = new URL(request.url).searchParams.get("type");
  const mediaType: MediaType = requestedType === "tv" ? "tv" : "movie";
  try { return Response.json(await getMovieMap(id, mediaType)); }
  catch { return Response.json({ error: "This title’s map is temporarily unavailable. Please try again." }, { status: 503 }); }
}
