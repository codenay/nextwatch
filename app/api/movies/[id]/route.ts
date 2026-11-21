import { getMovieDetail } from "@/lib/tmdb";
import type { MediaType } from "@/lib/reelspace";

// Which country to show watch options for: the viewer's saved choice, else their connection's country
// (set by the host when available), else the region in their browser language, else the US.
function viewerRegion(request: Request, requested: string | null) {
  if (requested && /^[A-Z]{2}$/.test(requested)) return requested;
  const fromHost = request.headers.get("cf-ipcountry")?.toUpperCase();
  if (fromHost && /^[A-Z]{2}$/.test(fromHost) && fromHost !== "XX" && fromHost !== "T1") return fromHost;
  const fromLanguage = request.headers.get("accept-language")?.match(/[a-z]{2,3}-([A-Z]{2})/)?.[1];
  return fromLanguage ?? "US";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid title." }, { status: 400 });
  }
  const searchParams = new URL(request.url).searchParams;
  const mediaType: MediaType = searchParams.get("type") === "tv" ? "tv" : "movie";
  const region = viewerRegion(request, searchParams.get("region")?.toUpperCase() ?? null);
  try {
    const movie = await getMovieDetail(id, mediaType, region);
    if (!movie) return Response.json({ error: "Title details are unavailable." }, { status: 404 });
    return Response.json({ movie }, { headers: { "Cache-Control": "private, max-age=300", Vary: "Accept-Language" } });
  } catch {
    return Response.json({ error: "Title details are temporarily unavailable." }, { status: 502 });
  }
}
