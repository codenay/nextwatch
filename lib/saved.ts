"use client";

import { useSyncExternalStore } from "react";
import type { MovieCard } from "@/lib/reelspace";

// "Save for later": a list of titles kept in this browser (no account needed). Every component reads it
// through useSaved(), which stays in sync across the page and other open tabs.

const KEY = "nextwatch:saved";
const CHANGE_EVENT = "nextwatch:saved-change";
const EMPTY: MovieCard[] = [];

let cachedRaw: string | null = null;
let cachedList: MovieCard[] = EMPTY;

function read(): MovieCard[] {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(KEY); } catch { return cachedList; }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) as MovieCard[] : [];
    cachedList = Array.isArray(parsed) ? parsed.filter((item) => typeof item?.id === "number" && (item.mediaType === "movie" || item.mediaType === "tv")) : EMPTY;
  } catch {
    cachedList = EMPTY;
  }
  return cachedList;
}

function write(list: MovieCard[]) {
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) onChange(); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const savedKey = (movie: Pick<MovieCard, "id" | "mediaType">) => `${movie.mediaType}-${movie.id}`;

export function useSaved() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function isSaved(list: MovieCard[], movie: Pick<MovieCard, "id" | "mediaType">) {
  return list.some((item) => savedKey(item) === savedKey(movie));
}

/** Add the title (newest first) or remove it if it's already saved. Returns whether it's now saved. */
export function toggleSaved(movie: MovieCard) {
  const list = read();
  if (isSaved(list, movie)) {
    write(list.filter((item) => savedKey(item) !== savedKey(movie)));
    return false;
  }
  // Keep only what the saved panel and the map need (not the long detail payload).
  const { id, mediaType, title, year, genres, genreIds, runtime, rating, hook, posterUrl, backdropUrl, palette } = movie;
  write([{ id, mediaType, title, year, genres, genreIds, runtime, rating, hook, posterUrl, backdropUrl, palette }, ...list].slice(0, 200));
  return true;
}

// Any component can open the Saved panel; the app listens for this.
export const OPEN_SAVED_EVENT = "nextwatch:open-saved";
export const openSavedPanel = () => window.dispatchEvent(new Event(OPEN_SAVED_EVENT));
