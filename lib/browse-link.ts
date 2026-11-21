import { findCategory } from "@/lib/categories";
import { GENRES } from "@/lib/reelspace";

// Shareable browse links: /browse?category=anime or /browse?genre=53.
// A "pick" is a category slug or a genre id written as a string (the same keys the category pills use).

type Params = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

const read = (params: Params, name: string) => {
  if (typeof (params as { get?: unknown }).get === "function") return (params as { get(name: string): string | null }).get(name);
  const value = (params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
};

export const isGenrePick = (pick: string) => GENRES.some((genre) => String(genre.id) === pick);

/** The valid category or genre a browse URL asks for, or null. */
export function parseBrowsePick(params: Params): string | null {
  const category = read(params, "category");
  if (category && findCategory(category)) return category;
  const genre = read(params, "genre");
  if (genre && isGenrePick(genre)) return genre;
  return null;
}

export const browseHref = (pick: string | null) => !pick ? "/browse" : isGenrePick(pick) ? `/browse?genre=${pick}` : `/browse?category=${encodeURIComponent(pick)}`;

/** Display name of a pick ("Anime", "Thriller"). */
export function browsePickName(pick: string | null) {
  if (!pick) return null;
  return findCategory(pick)?.name ?? GENRES.find((genre) => String(genre.id) === pick)?.name ?? null;
}
