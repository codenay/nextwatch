export type MoodSlug =
  | "feel-good"
  | "cozy"
  | "adrenaline"
  | "thought-provoking"
  | "dark"
  | "romantic"
  | "playful"
  | "adventurous"
  | "inspired"
  | "emotional"
  | "on-edge"
  | "dreamy"
  | "unexpected";

export type MediaType = "movie" | "tv";
export type ContentType = MediaType | "both";

export type MovieCard = {
  id: number;
  mediaType: MediaType;
  title: string;
  year: string;
  genres: string[];
  genreIds: number[];
  runtime: number | null;
  rating: number;
  hook: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  palette: string;
  /** Outer-orbit titles: `parent` is the map index of the close match that led here. */
  orbit?: { parent: number; slot: number };
};

export type Provider = {
  id: number;
  name: string;
  logoUrl: string | null;
};

export type MovieDetail = MovieCard & {
  overview: string;
  releaseDate: string;
  originalLanguage: string;
  trailerKey: string | null;
  providers: {
    stream: Provider[];
    free: Provider[];
    rent: Provider[];
    buy: Provider[];
  };
  watchUrl: string | null;
  /** The country the watch options are for (ISO 3166-1, e.g. "GH"). */
  region?: string;
  seasons?: number | null;
  isPreview?: boolean;
};

export const GENRES = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
] as const;

export const MOODS: Array<{
  slug: MoodSlug;
  name: string;
  note: string;
  genreIds: number[];
  minRating: number;
  runtimeMax?: number;
  sortBy: "popularity.desc" | "vote_average.desc";
}> = [
  { slug: "feel-good", name: "Feel-good", note: "Bright, warm, restorative", genreIds: [35, 10751, 10402, 10749], minRating: 6.1, runtimeMax: 135, sortBy: "popularity.desc" },
  { slug: "cozy", name: "Cozy", note: "Gentle, familiar, low-stakes", genreIds: [16, 35, 10751, 10749, 14], minRating: 6, runtimeMax: 125, sortBy: "vote_average.desc" },
  { slug: "adrenaline", name: "Adrenaline", note: "Fast, tense, propulsive", genreIds: [28, 12, 53, 878], minRating: 6, runtimeMax: 155, sortBy: "popularity.desc" },
  { slug: "thought-provoking", name: "Thought-provoking", note: "Layered, curious, lingering", genreIds: [18, 99, 36, 9648, 878], minRating: 6.7, sortBy: "vote_average.desc" },
  { slug: "dark", name: "Dark", note: "Unsettling, moody, intense", genreIds: [80, 27, 9648, 53, 18], minRating: 6.1, sortBy: "popularity.desc" },
  { slug: "romantic", name: "Romantic", note: "Tender, intimate, hopeful", genreIds: [10749, 18, 35], minRating: 6.1, runtimeMax: 145, sortBy: "popularity.desc" },
  { slug: "playful", name: "Playful", note: "Witty, silly, laugh-out-loud", genreIds: [35, 16], minRating: 6, runtimeMax: 115, sortBy: "popularity.desc" },
  { slug: "adventurous", name: "Adventurous", note: "Big journeys, new worlds, discovery", genreIds: [12, 14, 878], minRating: 6.2, runtimeMax: 165, sortBy: "popularity.desc" },
  { slug: "inspired", name: "Inspired", note: "Ambition, resilience, remarkable lives", genreIds: [99, 36, 18, 10402], minRating: 7, runtimeMax: 150, sortBy: "vote_average.desc" },
  { slug: "emotional", name: "Emotional", note: "Moving stories and a good cry", genreIds: [18, 10749], minRating: 6.8, sortBy: "vote_average.desc" },
  { slug: "on-edge", name: "On edge", note: "Suspense, secrets, creeping dread", genreIds: [53, 9648, 27], minRating: 6.3, runtimeMax: 135, sortBy: "popularity.desc" },
  { slug: "dreamy", name: "Dreamy", note: "Wonder, imagination, a little magic", genreIds: [14, 16, 878, 10402], minRating: 6.5, runtimeMax: 140, sortBy: "vote_average.desc" },
  { slug: "unexpected", name: "Unexpected", note: "Strange turns and surprising discoveries", genreIds: [9648, 878, 14, 80], minRating: 6.4, runtimeMax: 150, sortBy: "vote_average.desc" },
];

const PALETTES = [
  "linear-gradient(145deg,#f0c553 0%,#a73f20 42%,#24100c 100%)",
  "linear-gradient(150deg,#9bb3bd 0%,#315366 46%,#091117 100%)",
  "linear-gradient(155deg,#f5dd92 0%,#c2632d 40%,#321314 100%)",
  "linear-gradient(145deg,#ef8aa1 0%,#9d243b 44%,#220c12 100%)",
  "linear-gradient(145deg,#d5e8c2 0%,#4f7d5f 43%,#101d18 100%)",
  "linear-gradient(155deg,#8bb3e0 0%,#3a4f90 45%,#11142d 100%)",
  "linear-gradient(140deg,#d6b0e4 0%,#6e4488 47%,#1f102b 100%)",
  "linear-gradient(150deg,#e6e3dc 0%,#74716f 42%,#151515 100%)",
];

const PREVIEW_TITLES = [
  ["After Midnight", [18, 10749], 118, 7.8, "Two strangers, one sleepless city, and a night that quietly changes everything."],
  ["Solar Tides", [878, 12, 28], 126, 7.5, "A luminous voyage to the edge of a dying star."],
  ["The Distance", [53, 80, 28], 104, 7.2, "A missing hour turns a routine drive into a taut mystery."],
  ["Soft Landing", [35, 10749], 109, 7.4, "A wry, warm reset for anyone starting over."],
  ["Low Season", [18, 9648], 121, 7.7, "An empty coastal town keeps one impossible secret."],
  ["Radio Silence", [53, 878], 113, 7.1, "A late-night broadcast receives a signal from tomorrow."],
  ["Paper Moons", [16, 10751, 14], 96, 8.0, "A handmade universe unfolds above a child’s bedroom."],
  ["North of Here", [12, 18, 37], 132, 7.6, "Four friends trade the map for a story worth keeping."],
  ["Blue Hour", [18, 10402, 36], 116, 7.9, "A final concert plays out across one electric evening."],
  ["Good Company", [35, 18], 102, 7.3, "Old friends discover the best plans are the ones that fail."],
  ["Static Bloom", [878, 18], 128, 7.8, "Memory becomes a place you can visit—but not leave unchanged."],
  ["Second Light", [99, 36, 10752], 91, 8.1, "A patient portrait of people rebuilding after the impossible."],
  ["The Quiet Guest", [27, 9648], 107, 7.0, "A remote house makes room for someone who was never invited."],
  ["Sunday Best", [35, 10751], 98, 7.6, "One family lunch, five secrets, and an alarming amount of cake."],
  ["Velvet Route", [80, 53], 119, 7.4, "A courier takes one last job through the city’s hidden rooms."],
  ["Gravity Club", [12, 35], 111, 7.5, "A mismatched crew attempts the world’s least sensible expedition."],
] as const;

const PREVIEW_SERIES_TITLES = [
  ["Signal Coast", [18, 9648], 52, 8.2, "A coastal radio host hears messages from disappearances that have not happened yet."],
  ["The Long Table", [35, 18], 31, 7.9, "A restaurant staff becomes an unlikely family through one chaotic season."],
  ["Atlas Division", [878, 28, 53], 48, 8.1, "A covert team maps impossible events before they reshape the world."],
  ["House of Small Wonders", [16, 10751, 14], 24, 8.4, "Every room in an old home opens onto a different magical story."],
  ["Cold Harbour", [80, 9648, 18], 56, 8.0, "A patient detective returns to the case that quietly ended her career."],
  ["Sunday League", [35, 18], 28, 7.7, "A hopeless local football club discovers that losing is not their biggest problem."],
  ["Wild Meridian", [99, 12], 44, 8.5, "An intimate journey through the planet’s most remote living landscapes."],
  ["Velvet Hours", [18, 10749, 10402], 46, 7.8, "Three musicians chase one impossible summer across a changing city."],
] as const;

const genreName = (id: number) => GENRES.find((genre) => genre.id === id)?.name ?? "Film";

const PREVIEW_FILMS: MovieDetail[] = PREVIEW_TITLES.map((entry, index) => {
  const [title, genreIds, runtime, rating, hook] = entry;
  const year = String(2024 - (index % 6));
  return {
    id: -(index + 1),
    mediaType: "movie" as const,
    title,
    year,
    genres: genreIds.map(genreName),
    genreIds: [...genreIds],
    runtime,
    rating,
    hook,
    posterUrl: null,
    backdropUrl: null,
    palette: PALETTES[index % PALETTES.length],
    overview: `${hook} This preview title demonstrates the NextWatch experience while live TMDB data is waiting to be connected.`,
    releaseDate: `${year}-09-${String((index % 24) + 1).padStart(2, "0")}`,
    originalLanguage: "English",
    trailerKey: null,
    providers: { stream: [], free: [], rent: [], buy: [] },
    watchUrl: null,
    isPreview: true,
  };
});

const PREVIEW_SERIES: MovieDetail[] = PREVIEW_SERIES_TITLES.map((entry, index) => {
  const [title, genreIds, runtime, rating, hook] = entry;
  const year = String(2025 - (index % 5));
  return {
    id: -(PREVIEW_TITLES.length + index + 1),
    mediaType: "tv" as const,
    title,
    year,
    genres: genreIds.map(genreName),
    genreIds: [...genreIds],
    runtime,
    rating,
    hook,
    posterUrl: null,
    backdropUrl: null,
    palette: PALETTES[(index + 3) % PALETTES.length],
    overview: `${hook} This preview series demonstrates the NextWatch experience while live TMDB data is waiting to be connected.`,
    releaseDate: `${year}-09-${String((index % 24) + 1).padStart(2, "0")}`,
    originalLanguage: "English",
    trailerKey: null,
    providers: { stream: [], free: [], rent: [], buy: [] },
    watchUrl: null,
    seasons: 2 + (index % 4),
    isPreview: true,
  };
});

export const PREVIEW_MOVIES: MovieDetail[] = [...PREVIEW_FILMS, ...PREVIEW_SERIES];

export function previewRecommendations(genres: number[], moods: MoodSlug[], contentType: ContentType = "both") {
  const moodGenres = new Set(
    MOODS.filter((mood) => moods.includes(mood.slug)).flatMap((mood) => mood.genreIds),
  );
  const ranked = PREVIEW_MOVIES
    .filter((title) => contentType === "both" || title.mediaType === contentType)
    .sort((a, b) => {
      const score = (movie: MovieDetail) =>
        movie.genreIds.filter((id) => genres.includes(id)).length * 4 +
        movie.genreIds.filter((id) => moodGenres.has(id)).length * 2 +
        movie.rating / 10;
      return score(b) - score(a);
    });
  const selected = contentType === "both"
    ? Array.from({ length: 8 }, (_, index) => [
        ranked.filter((title) => title.mediaType === "movie")[index],
        ranked.filter((title) => title.mediaType === "tv")[index],
      ]).flat().filter((title): title is MovieDetail => Boolean(title))
    : ranked.slice(0, 16);
  return selected.map((movie) => ({
      id: movie.id,
      mediaType: movie.mediaType,
      title: movie.title,
      year: movie.year,
      genres: movie.genres,
      genreIds: movie.genreIds,
      runtime: movie.runtime,
      rating: movie.rating,
      hook: movie.hook,
      posterUrl: movie.posterUrl,
      backdropUrl: movie.backdropUrl,
      palette: movie.palette,
    }));
}

export function getPreviewMovie(id: number) {
  return PREVIEW_MOVIES.find((movie) => movie.id === id) ?? null;
}

export function isMoodSlug(value: string): value is MoodSlug {
  return MOODS.some((mood) => mood.slug === value);
}
