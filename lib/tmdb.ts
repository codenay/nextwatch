import {
  ContentType,
  GENRES,
  MediaType,
  MOODS,
  MovieCard,
  MovieDetail,
  MoodSlug,
  PREVIEW_MOVIES,
  Provider,
  getPreviewMovie,
  previewRecommendations,
} from "@/lib/reelspace";
import { CATEGORIES, type Category } from "@/lib/categories";

const API_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const CACHE_TTL = 15 * 60 * 1000;
// Trending lists change daily and title maps (recommendations) rarely, so they can be kept far longer.
const TRENDING_TTL = 3 * 60 * 60 * 1000;
const MAP_TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expires: number; value: unknown }>();

type TmdbListMovie = {
  adult?: boolean;
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: "movie" | "tv" | "person";
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  original_language?: string;
};

type TmdbMovie = TmdbListMovie & {
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number;
  genres?: Array<{ id: number; name: string }>;
  videos?: { results?: Array<{ key: string; site: string; type: string; official?: boolean; published_at?: string }> };
  "watch/providers"?: { results?: Record<string, TmdbProviderRegion> };
};

type TmdbProviderRegion = {
  link?: string;
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
};

type TmdbProvider = { provider_id: number; provider_name: string; logo_path?: string | null };

export function tmdbConfigured() {
  return Boolean(
    process.env.TMDB_API_KEY?.trim() || process.env.TMDB_READ_ACCESS_TOKEN?.trim(),
  );
}

async function tmdbFetch<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, attempt = 0): Promise<T> {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (!apiKey && !token) throw new Error("TMDB_NOT_CONFIGURED");
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      headers: {
        ...(apiKey ? {} : { Authorization: `Bearer ${token}` }),
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    // TMDB rate-limits bursts (pages fire many requests at once): wait as asked, then try once more.
    if (response.status === 429 && attempt === 0) {
      const wait = Math.min(Number(response.headers.get("retry-after")) || 1, 3) * 1000;
      clearTimeout(timer);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return tmdbFetch<T>(path, params, attempt + 1);
    }
    if (!response.ok) throw new Error(`TMDB_${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const isCached = (key: string) => (cache.get(key)?.expires ?? 0) > Date.now();

async function cached<T>(key: string, loader: () => Promise<T>, ttlFor?: (value: T) => number): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await loader();
  cache.set(key, { expires: Date.now() + (ttlFor ? ttlFor(value) : CACHE_TTL), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

const paletteFor = (id: number) => {
  const hues = [34, 206, 12, 338, 147, 226, 281, 48];
  const hue = hues[Math.abs(id) % hues.length];
  return `linear-gradient(145deg,hsl(${hue} 68% 65%),hsl(${hue + 12} 55% 34%) 46%,hsl(${hue + 5} 45% 9%))`;
};

const movieImage = (path: string | null | undefined, size: "w780" | "w1280") => path ? `${IMAGE_BASE}/${size}${path}` : null;

const TV_GENRE_NAMES: Record<number, string> = {
  16: "Animation", 18: "Drama", 35: "Comedy", 37: "Western", 80: "Crime",
  99: "Documentary", 9648: "Mystery", 10751: "Family", 10759: "Action & Adventure",
  10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy",
  10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

const TV_GENRE_MAP: Record<number, number[]> = {
  28: [10759], 12: [10759], 16: [16], 35: [35], 80: [80], 99: [99], 18: [18],
  10751: [10751], 14: [10765], 36: [10768], 27: [9648, 10765], 10402: [18],
  9648: [9648], 10749: [18, 35], 878: [10765], 53: [9648, 80], 10752: [10768], 37: [37],
};

const tvGenreIdsFor = (genreIds: number[]) => [...new Set(genreIds.flatMap((id) => TV_GENRE_MAP[id] ?? []))];

const nameForGenre = (id: number, mediaType: MediaType) => mediaType === "tv"
  ? TV_GENRE_NAMES[id] ?? "Series"
  : GENRES.find((genre) => genre.id === id)?.name ?? "Film";

const hookFor = (movie: TmdbListMovie, moods: MoodSlug[]) => {
  const overview = movie.overview?.trim();
  if (overview) {
    const sentence = overview.split(/(?<=[.!?])\s/)[0];
    return sentence.length > 112 ? `${sentence.slice(0, 109).trim()}…` : sentence;
  }
  const moodName = MOODS.find((mood) => moods.includes(mood.slug))?.name.toLowerCase() ?? "cinematic";
  return `A ${moodName} pick selected for this moment.`;
};

function normalizeCard(movie: TmdbMovie, moods: MoodSlug[], mediaType: MediaType): MovieCard {
  const genreIds = movie.genres?.map((genre) => genre.id) ?? movie.genre_ids ?? [];
  return {
    id: movie.id,
    mediaType,
    title: movie.title ?? movie.name ?? (mediaType === "tv" ? "Untitled series" : "Untitled film"),
    year: (mediaType === "tv" ? movie.first_air_date : movie.release_date)?.slice(0, 4) || "—",
    genres: movie.genres?.map((genre) => genre.name) ?? genreIds.map((id) => nameForGenre(id, mediaType)),
    genreIds,
    runtime: mediaType === "tv" ? movie.episode_run_time?.find((runtime) => runtime > 0) ?? null : movie.runtime ?? null,
    rating: Number((movie.vote_average ?? 0).toFixed(1)),
    hook: hookFor(movie, moods),
    posterUrl: movieImage(movie.poster_path, "w780"),
    backdropUrl: movieImage(movie.backdrop_path, "w1280"),
    palette: paletteFor(movie.id),
  };
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// Translate a curated category into TMDB discover parameters for one media type.
function categoryParams(category: Category, mediaType: MediaType, extraGenres: number[] = []) {
  const dateKey = mediaType === "tv" ? "first_air_date" : "primary_release_date";
  // A category's own genres win; mood genres only widen categories that have none.
  const genreIds = category.genres?.length ? category.genres : extraGenres;
  const mapped = mediaType === "tv" ? tvGenreIdsFor(genreIds) : genreIds;
  return {
    include_adult: false,
    language: "en-US",
    ...(mediaType === "movie" ? { include_video: false } : {}),
    sort_by: category.sortBy ?? "popularity.desc",
    with_genres: mapped.length ? mapped.join(category.genres?.length ? "," : "|") : undefined,
    with_keywords: category.keywords?.join("|"),
    with_original_language: category.language,
    with_origin_country: category.country,
    "vote_count.gte": category.minVotes ?? 50,
    "vote_count.lte": category.maxVotes,
    "vote_average.gte": category.minRating,
    [`${dateKey}.gte`]: category.releasedWithinDays ? isoDaysAgo(category.releasedWithinDays) : undefined,
    [`${dateKey}.lte`]: category.releasedWithinDays ? isoDaysAgo(0) : category.releasedBefore ?? (category.minAgeDays ? isoDaysAgo(category.minAgeDays) : undefined),
    "with_runtime.lte": category.maxRuntime,
  };
}

const categoryMediaTypes = (category: Category, contentType: ContentType): MediaType[] =>
  category.media ? [category.media] : contentType === "both" ? ["movie", "tv"] : [contentType];

/** Every tile on the categories page: the genres plus the curated categories. */
export const POSTER_TILE_COUNT = GENRES.length + CATEGORIES.length;

export async function getFolderPosters(contentType: ContentType = "both") {
  if (!tmdbConfigured()) return {};
  return cached(`folder-posters:v3:${contentType}`, async () => {
    const results = await Promise.allSettled(GENRES.map(async (genre, index) => {
      const mediaType: MediaType = contentType === "both" ? (index % 2 ? "tv" : "movie") : contentType;
      const genreIds = mediaType === "tv" ? tvGenreIdsFor([genre.id]) : [genre.id];
      const data = await tmdbFetch<{ results?: TmdbListMovie[] }>(`/discover/${mediaType}`, {
        with_genres: genreIds.join("|"), include_adult: false,
        ...(mediaType === "movie" ? { include_video: false } : {}),
        sort_by: "popularity.desc", "vote_count.gte": 50, language: "en-US",
      });
      // A few spares per genre so the browse page can avoid showing the same poster twice.
      return [genre.id, (data.results ?? []).filter((title) => title.poster_path).slice(0, 8).map((title) => ({
        id: title.id, title: title.title ?? title.name ?? "Title", posterUrl: `${IMAGE_BASE}/w185${title.poster_path}`,
      }))] as const;
    }));
    const categoryResults = await Promise.allSettled(CATEGORIES.map(async (category, index) => {
      const mediaTypes = categoryMediaTypes(category, contentType);
      const mediaType = mediaTypes[index % mediaTypes.length];
      const data = await tmdbFetch<{ results?: TmdbListMovie[] }>(`/discover/${mediaType}`, { ...categoryParams(category, mediaType), sort_by: "popularity.desc" });
      return [category.slug, (data.results ?? []).filter((title) => title.poster_path).slice(0, 8).map((title) => ({
        id: title.id, title: title.title ?? title.name ?? "Title", posterUrl: `${IMAGE_BASE}/w185${title.poster_path}`,
      }))] as const;
    }));
    const entries = [...results, ...categoryResults].flatMap((result) => result.status === "fulfilled" && result.value[1].length ? [result.value] : []);
    if (!entries.length) throw new Error("Poster previews unavailable");
    return Object.fromEntries(entries);
  }, (posters) => Object.keys(posters).length >= POSTER_TILE_COUNT ? CACHE_TTL : 60_000);
}

// Sixteen picks for a curated category. Moods steer the ranking (and add a mood-flavoured query).
export async function getCategoryRecommendations(category: Category, moods: MoodSlug[], contentType: ContentType = "both") {
  if (!tmdbConfigured()) {
    return { configured: false, source: "preview" as const, movies: previewRecommendations(category.genres ?? [], moods, category.media ?? contentType) };
  }
  const key = `category:${category.slug}:${contentType}:${moods.slice().sort().join("-")}`;
  return cached(key, async () => {
    const moodGenres = MOODS.filter((mood) => moods.includes(mood.slug)).flatMap((mood) => mood.genreIds);
    const mediaTypes = categoryMediaTypes(category, contentType);
    const queries = mediaTypes.flatMap((mediaType) => [
      { mediaType, params: categoryParams(category, mediaType) },
      { mediaType, params: { ...categoryParams(category, mediaType), page: 2 } },
      ...(moodGenres.length && !category.genres?.length ? [{ mediaType, params: categoryParams(category, mediaType, moodGenres) }] : []),
    ]);
    const payloads = await Promise.allSettled(queries.map(async ({ mediaType, params }) => ({ mediaType, payload: await tmdbFetch<{ results?: TmdbListMovie[] }>(`/discover/${mediaType}`, params) })));
    const unique = new Map<string, { mediaType: MediaType; title: TmdbListMovie }>();
    payloads.forEach((result) => {
      if (result.status !== "fulfilled") return;
      const { mediaType, payload } = result.value;
      (payload.results ?? []).forEach((title) => {
        const id = `${mediaType}:${title.id}`;
        if (title.poster_path && !title.adult && !unique.has(id)) unique.set(id, { mediaType, title });
      });
    });
    if (!unique.size) throw new Error("NO_RESULTS");
    const scoreFor = ({ mediaType, title }: { mediaType: MediaType; title: TmdbListMovie }) => {
      const wanted = mediaType === "tv" ? tvGenreIdsFor(moodGenres) : moodGenres;
      return (title.genre_ids ?? []).filter((id) => wanted.includes(id)).length * 3 + (title.vote_average ?? 0) * .65 + Math.log10((title.vote_count ?? 0) + 1);
    };
    const ranked = [...unique.values()].sort((a, b) => scoreFor(b) - scoreFor(a));
    const byType = (type: MediaType) => ranked.filter((item) => item.mediaType === type);
    const selected = mediaTypes.length === 2
      ? Array.from({ length: 8 }, (_, index) => [byType("movie")[index], byType("tv")[index]]).flat().filter((item): item is { mediaType: MediaType; title: TmdbListMovie } => Boolean(item))
      : ranked.slice(0, 16);
    // Top up from whichever side has more, so a thin category still fills the canvas.
    const picks = selected.length >= 16 ? selected : [...selected, ...ranked.filter((item) => !selected.includes(item))].slice(0, 16);
    const hydrated = await Promise.all(picks.map(async ({ mediaType, title }) => {
      try { return { mediaType, title: await tmdbFetch<TmdbMovie>(`/${mediaType}/${title.id}`, { language: "en-US" }) }; }
      catch { return { mediaType, title: title as TmdbMovie }; }
    }));
    return { configured: true, source: "tmdb" as const, movies: hydrated.map(({ mediaType, title }) => normalizeCard(title, moods, mediaType)) };
  });
}

export async function getRecommendations(genres: number[], moods: MoodSlug[], contentType: ContentType = "both") {
  if (!tmdbConfigured()) {
    return { configured: false, source: "preview" as const, movies: previewRecommendations(genres, moods, contentType) };
  }

  const key = `recommendations:${contentType}:${genres.slice().sort().join("-")}:${moods.slice().sort().join("-")}`;
  return cached(key, async () => {
    const baseParams = {
      include_adult: false,
      language: "en-US",
      "vote_count.gte": 80,
      page: 1,
    };
    const mediaTypes: MediaType[] = contentType === "both" ? ["movie", "tv"] : [contentType];
    const queries = mediaTypes.flatMap((mediaType) => {
      const mapGenres = (ids: number[]) => mediaType === "tv" ? tvGenreIdsFor(ids) : ids;
      return [
        { mediaType, params: { ...baseParams, ...(mediaType === "movie" ? { include_video: false } : {}), with_genres: mapGenres(genres).join("|"), sort_by: "popularity.desc" } },
        ...moods.map((slug) => {
          const mood = MOODS.find((item) => item.slug === slug)!;
          return { mediaType, params: {
            ...baseParams,
            ...(mediaType === "movie" ? { include_video: false } : {}),
            with_genres: mapGenres(mood.genreIds).join("|"),
            sort_by: mood.sortBy,
            "vote_average.gte": mood.minRating,
            "with_runtime.lte": mood.runtimeMax,
          } };
        }),
      ];
    });
    const payloads = await Promise.all(
      queries.map(async ({ mediaType, params }) => ({ mediaType, payload: await tmdbFetch<{ results?: TmdbListMovie[] }>(`/discover/${mediaType}`, params) })),
    );
    const unique = new Map<string, { mediaType: MediaType; title: TmdbListMovie }>();
    payloads.forEach(({ mediaType, payload }) => (payload.results ?? []).forEach((title) => {
      const date = mediaType === "tv" ? title.first_air_date : title.release_date;
      const key = `${mediaType}:${title.id}`;
      if (title.poster_path && date && !unique.has(key)) unique.set(key, { mediaType, title });
    }));

    const scoreFor = ({ mediaType, title }: { mediaType: MediaType; title: TmdbListMovie }) => {
      const selectedGenres = mediaType === "tv" ? tvGenreIdsFor(genres) : genres;
      const moodGenres = mediaType === "tv"
        ? tvGenreIdsFor(MOODS.filter((mood) => moods.includes(mood.slug)).flatMap((mood) => mood.genreIds))
        : MOODS.filter((mood) => moods.includes(mood.slug)).flatMap((mood) => mood.genreIds);
      const ids = title.genre_ids ?? [];
      return ids.filter((id) => selectedGenres.includes(id)).length * 6 + ids.filter((id) => moodGenres.includes(id)).length * 3 + (title.vote_average ?? 0) * .65 + Math.log10((title.vote_count ?? 0) + 1);
    };
    const ranked = [...unique.values()].sort((a, b) => scoreFor(b) - scoreFor(a));
    const rankedMovies = ranked.filter((item) => item.mediaType === "movie");
    const rankedSeries = ranked.filter((item) => item.mediaType === "tv");
    const selected = contentType === "both"
      ? Array.from({ length: 8 }, (_, index) => [rankedMovies[index], rankedSeries[index]])
          .flat()
          .filter((item): item is { mediaType: MediaType; title: TmdbListMovie } => Boolean(item))
      : ranked.slice(0, 16);

    const hydrated = await Promise.all(
      selected.map(async ({ mediaType, title }) => {
        try {
          return { mediaType, title: await tmdbFetch<TmdbMovie>(`/${mediaType}/${title.id}`, { language: "en-US" }) };
        } catch {
          return { mediaType, title: title as TmdbMovie };
        }
      }),
    );
    return { configured: true, source: "tmdb" as const, movies: hydrated.map(({ mediaType, title }) => normalizeCard(title, moods, mediaType)) };
  });
}

// Provider logos are shown at 24px, so the small w92 size is plenty.
const normalizeProviders = (providers: TmdbProvider[] | undefined): Provider[] => {
  const unique = new Map<number, TmdbProvider>();
  (providers ?? []).forEach((provider) => unique.set(provider.provider_id, provider));
  return [...unique.values()].map((provider) => ({
    id: provider.provider_id,
    name: provider.provider_name,
    logoUrl: provider.logo_path ? `${IMAGE_BASE}/w92${provider.logo_path}` : null,
  }));
};

/** Countries TMDB has watch-provider data for (from JustWatch). Changes rarely, so cached for a day. */
export async function getWatchRegions() {
  return cached("watch-regions", async () => {
    const data = await tmdbFetch<{ results?: Array<{ iso_3166_1: string; english_name: string }> }>("/watch/providers/regions", { language: "en-US" });
    return (data.results ?? [])
      .map((region) => ({ code: region.iso_3166_1, name: region.english_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, () => 24 * 60 * 60 * 1000);
}

export async function searchMovies(query: string, contentType: ContentType = "both") {
  return cached(`search:${contentType}:${query.toLowerCase()}`, async () => {
    const path = contentType === "both" ? "/search/multi" : `/search/${contentType}`;
    const result = await tmdbFetch<{ results: TmdbListMovie[] }>(path, { query, include_adult: false, language: "en-US" });
    return result.results
      .filter((title) => !title.adult && (contentType !== "both" || title.media_type === "movie" || title.media_type === "tv"))
      .slice(0, 8)
      .map((title) => normalizeCard(title, [], contentType === "both" ? title.media_type as MediaType : contentType));
  });
}

const mapKey = (id: number, mediaType: MediaType) => `map:v2:${mediaType}:${id}`;

export async function getMovieMap(id: number, mediaType: MediaType = "movie") {
  return cached(mapKey(id, mediaType), async () => {
    const seed = await tmdbFetch<TmdbMovie>(`/${mediaType}/${id}`, { language: "en-US" });
    if (seed.adult) throw new Error("UNAVAILABLE");
    const responses = await Promise.allSettled([
      tmdbFetch<{ results: TmdbListMovie[] }>(`/${mediaType}/${id}/recommendations`, { language: "en-US" }),
      tmdbFetch<{ results: TmdbListMovie[] }>(`/${mediaType}/${id}/similar`, { language: "en-US" }),
    ]);
    if (responses.every((response) => response.status === "rejected")) throw new Error("UNAVAILABLE");
    const seedGenres = seed.genres?.map((genre) => genre.id) ?? [];
    const candidates = new Map<number, { movie: TmdbListMovie; score: number }>();
    responses.forEach((response, source) => {
      if (response.status !== "fulfilled") return;
      response.value.results.forEach((movie, rank) => {
        if (movie.id === id || movie.adult || !movie.poster_path) return;
        const genres = movie.genre_ids ?? [];
        const overlap = genres.filter((genre) => seedGenres.includes(genre)).length / Math.max(1, new Set([...genres, ...seedGenres]).size);
        const score = (source === 0 ? 2 : 1) / (1 + rank * .08) + overlap;
        const previous = candidates.get(movie.id);
        if (!previous || score > previous.score) candidates.set(movie.id, { movie, score });
      });
    });
    const ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 15);
    // Close matches get full details; in parallel, ask TMDB what fans of each close match
    // watched next. Those become the outer orbit, so the map keeps going as you explore.
    const [movies, outerLists] = await Promise.all([
      Promise.all(ranked.map(async ({ movie }) => {
        try { return normalizeCard(await tmdbFetch<TmdbMovie>(`/${mediaType}/${movie.id}`, { language: "en-US" }), [], mediaType); }
        catch { return normalizeCard(movie, [], mediaType); }
      })),
      Promise.allSettled(ranked.map(({ movie }) => tmdbFetch<{ results: TmdbListMovie[] }>(`/${mediaType}/${movie.id}/recommendations`, { language: "en-US" }))),
    ]);
    const taken = new Set([id, ...ranked.map(({ movie }) => movie.id)]);
    const outer: MovieCard[] = [];
    outerLists.forEach((list, parentOffset) => {
      if (list.status !== "fulfilled") return;
      let slot = 0;
      for (const title of list.value.results) {
        if (slot >= 2) break;
        if (taken.has(title.id) || title.adult || !title.poster_path) continue;
        taken.add(title.id);
        outer.push({ ...normalizeCard(title, [], mediaType), orbit: { parent: parentOffset + 1, slot } });
        slot += 1;
      }
    });
    return { seed: normalizeCard(seed, [], mediaType), movies, outer };
  }, () => MAP_TTL);
}

// The homepage opens on whatever is trending most today, mapped to its closest titles.
// With `shuffle`, it picks a random title from today's top 20 instead (skipping `exclude`).
export async function getTrendingMap(contentType: ContentType = "both", options: { shuffle?: boolean; exclude?: string } = {}) {
  if (!tmdbConfigured()) {
    const eligible = PREVIEW_MOVIES.filter((title) => contentType === "both" || title.mediaType === contentType);
    const [seed, ...rest] = eligible;
    const overlap = (title: MovieCard) => title.genreIds.filter((id) => seed.genreIds.includes(id)).length;
    const movies = rest.sort((a, b) => overlap(b) - overlap(a)).slice(0, 15);
    return { configured: false, rank: 1, seed: seed as MovieCard, movies: movies as MovieCard[] };
  }
  const path = contentType === "both" ? "/trending/all/day" : `/trending/${contentType}/day`;
  const ranked = await cached(`trending:v2:${contentType}`, async () => {
    const result = await tmdbFetch<{ results?: TmdbListMovie[] }>(path, { language: "en-US" });
    return (result.results ?? [])
      .filter((title) => !title.adult && title.poster_path && (contentType !== "both" || title.media_type === "movie" || title.media_type === "tv"))
      .slice(0, 20)
      .map((title, index) => ({ id: title.id, rank: index + 1, mediaType: (contentType === "both" ? title.media_type : contentType) as MediaType }));
  }, () => TRENDING_TTL);
  let candidates = ranked.slice(0, 8);
  if (options.shuffle) {
    const pool = ranked.filter((title) => `${title.mediaType}-${title.id}` !== options.exclude);
    // Fisher–Yates, then try the first few in case a title has no usable neighbours.
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    candidates = pool;
  }
  // Building a map that isn't cached costs ~33 TMDB requests. Hosts cap outgoing requests per request
  // (Cloudflare's free plan: 50), so build at most one fresh map here; fallbacks only use cached maps.
  let freshBuilds = 1;
  for (const candidate of candidates) {
    if (!isCached(mapKey(candidate.id, candidate.mediaType))) {
      if (freshBuilds === 0) continue;
      freshBuilds -= 1;
    }
    try {
      const map = await getMovieMap(candidate.id, candidate.mediaType);
      if (map.movies.length) return { configured: true, rank: candidate.rank, ...map };
    } catch { /* try the next trending title */ }
  }
  throw new Error("TRENDING_UNAVAILABLE");
}

// Where to watch is per country: the raw TMDB answer is cached once, then trimmed to the viewer's country.
export async function getMovieDetail(id: number, mediaType: MediaType = "movie", region = "US"): Promise<MovieDetail | null> {
  if (id < 0) return getPreviewMovie(id);
  if (!tmdbConfigured()) return null;
  const movie = await cached(`detail-raw:${mediaType}:${id}`, () => tmdbFetch<TmdbMovie>(`/${mediaType}/${id}`, {
    language: "en-US",
    append_to_response: "videos,watch/providers",
    include_video_language: "en,null",
  }));
  {
    const card = normalizeCard(movie, [], mediaType);
    const videos = (movie.videos?.results ?? [])
      .filter((video) => video.site === "YouTube" && video.type === "Trailer")
      .sort((a, b) => Number(Boolean(b.official)) - Number(Boolean(a.official)) || (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    const local = movie["watch/providers"]?.results?.[region];
    return {
      ...card,
      overview: movie.overview?.trim() || "No synopsis is available for this title yet.",
      releaseDate: (mediaType === "tv" ? movie.first_air_date : movie.release_date) || "",
      originalLanguage: new Intl.DisplayNames(["en"], { type: "language" }).of(movie.original_language ?? "en") ?? movie.original_language ?? "Unknown",
      trailerKey: videos[0]?.key ?? null,
      providers: {
        stream: normalizeProviders(local?.flatrate),
        free: normalizeProviders([...(local?.free ?? []), ...(local?.ads ?? [])]),
        rent: normalizeProviders(local?.rent),
        buy: normalizeProviders(local?.buy),
      },
      watchUrl: local?.link ?? null,
      region,
      seasons: mediaType === "tv" ? movie.number_of_seasons ?? null : null,
    };
  }
}
