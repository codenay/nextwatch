import type { Metadata } from "next";
import ReelspaceApp from "./reelspace-app";
import { getMovieDetail } from "@/lib/tmdb";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

// A shared map link (/?id=603&type=movie) previews as that title — name, synopsis and artwork — in
// messages and social posts. Plain visits keep the site-wide title from the layout.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const id = Number(first(params.id));
  if (!Number.isSafeInteger(id) || id <= 0) return {};
  const mediaType = first(params.type) === "tv" ? "tv" : "movie";
  try {
    const movie = await getMovieDetail(id, mediaType);
    if (!movie) return {};
    const title = `Titles like ${movie.title} — NextWatch`;
    const description = `${movie.title}${movie.year && movie.year !== "—" ? ` (${movie.year})` : ""}: ${movie.overview}`.slice(0, 200);
    const image = movie.backdropUrl ?? movie.posterUrl;
    const images = image ? [{ url: image, alt: movie.title }] : undefined;
    return {
      title,
      description,
      openGraph: { title, description, type: "website", images },
      twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
    };
  } catch {
    return {};
  }
}

export default function Home() {
  return <ReelspaceApp view="home" />;
}
