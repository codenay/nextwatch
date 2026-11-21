import type { MediaType } from "@/lib/reelspace";

// Curated categories beyond the plain genres. Each one is a TMDB discover filter, so results stay live.
// Keyword ids were looked up via TMDB's /search/keyword (exact-name matches).

export type CategoryGroup = "themes" | "world" | "tonight";

export type Category = {
  slug: string;
  name: string;
  group: CategoryGroup;
  /** Shown while its picks load. */
  line: string;
  /** Only makes sense for one kind of title (overrides the Movies / Series toggle). */
  media?: MediaType;
  /** Movie genre ids (mapped to their TV equivalents for series). */
  genres?: number[];
  keywords?: number[];
  language?: string;
  country?: string;
  minVotes?: number;
  maxVotes?: number;
  minRating?: number;
  /** Released within this many days of today. */
  releasedWithinDays?: number;
  /** Released before this date (YYYY-MM-DD). */
  releasedBefore?: string;
  /** Out for at least this many days (keeps brand-new, barely rated titles out). */
  minAgeDays?: number;
  maxRuntime?: number;
  sortBy?: string;
};

export const CATEGORY_GROUPS: Array<{ id: CategoryGroup; name: string }> = [
  { id: "themes", name: "Themes" },
  { id: "world", name: "Around the world" },
  { id: "tonight", name: "Picks for tonight" },
];

export const CATEGORIES: Category[] = [
  { slug: "true-stories", name: "True stories", group: "themes", keywords: [9672], minVotes: 200, line: "Checking the archives…" },
  { slug: "superheroes", name: "Superheroes", group: "themes", keywords: [9715], minVotes: 200, line: "Polishing the capes…" },
  { slug: "time-travel", name: "Time travel", group: "themes", keywords: [4379], minVotes: 100, line: "Syncing the timelines…" },
  { slug: "heists", name: "Heists", group: "themes", keywords: [10051], minVotes: 100, line: "Casing the joint…" },
  { slug: "coming-of-age", name: "Coming of age", group: "themes", keywords: [10683], minVotes: 150, line: "Finding the yearbook…" },
  { slug: "stand-up", name: "Stand-up comedy", group: "themes", keywords: [9716], media: "movie", minVotes: 20, line: "Testing the mic…" },

  { slug: "anime", name: "Anime", group: "world", genres: [16], language: "ja", minVotes: 100, line: "Warming up the studio…" },
  { slug: "k-dramas", name: "K-dramas", group: "world", genres: [18], language: "ko", media: "tv", minVotes: 30, line: "Queueing the next episode…" },
  { slug: "bollywood", name: "Bollywood", group: "world", language: "hi", minVotes: 50, line: "Cueing the dance number…" },
  { slug: "nollywood", name: "Nollywood", group: "world", country: "NG", minVotes: 5, line: "Calling Lagos…" },
  { slug: "spanish-language", name: "Spanish-language", group: "world", language: "es", minVotes: 150, line: "Turning on the subtitles…" },
  { slug: "french-cinema", name: "French cinema", group: "world", language: "fr", minVotes: 200, line: "Finding a café table…" },

  { slug: "new-this-year", name: "New this year", group: "tonight", releasedWithinDays: 240, minVotes: 40, line: "Checking what just landed…" },
  { slug: "critically-loved", name: "Critically loved", group: "tonight", minRating: 8, minVotes: 2000, sortBy: "vote_average.desc", line: "Asking the critics…" },
  { slug: "hidden-gems", name: "Hidden gems", group: "tonight", minRating: 7.3, minVotes: 80, maxVotes: 900, minAgeDays: 365, sortBy: "vote_average.desc", line: "Digging through the vault…" },
  { slug: "classics", name: "Classics", group: "tonight", releasedBefore: "1980-01-01", minVotes: 800, sortBy: "vote_average.desc", line: "Threading the projector…" },
  { slug: "under-100-minutes", name: "Under 100 minutes", group: "tonight", media: "movie", maxRuntime: 100, minRating: 6.8, minVotes: 500, line: "Keeping it snappy…" },
];

export const findCategory = (slug: string | null | undefined) => CATEGORIES.find((category) => category.slug === slug);
