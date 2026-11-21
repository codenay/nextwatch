"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Image from "next/image";
import { ArrowUpRight, Search } from "lucide-react";
import type { ContentType, MovieCard } from "@/lib/reelspace";

// Types example titles into the empty search box, one after another, so people see what to try.
function useTypedSuggestion(suggestions: readonly string[] | undefined, active: boolean) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!suggestions?.length || !active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let word = 0;
    let length = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      const target = suggestions[word % suggestions.length];
      if (!deleting) {
        length += 1;
        setTyped(target.slice(0, length));
        if (length >= target.length) { deleting = true; timer = window.setTimeout(tick, 1700); return; }
        timer = window.setTimeout(tick, 65 + Math.random() * 55);
      } else {
        length -= 1;
        setTyped(target.slice(0, length));
        if (length <= 0) { deleting = false; word += 1; timer = window.setTimeout(tick, 380); return; }
        timer = window.setTimeout(tick, 28);
      }
    };
    timer = window.setTimeout(tick, 900);
    return () => window.clearTimeout(timer);
  }, [suggestions, active]);
  return active && suggestions?.length ? typed : null;
}

export function MovieSearch({ onSelect, contentType = "both", placeholder: customPlaceholder, suggestions, shortcut = false, inputId = "movie-search" }: {
  onSelect: (movie: MovieCard) => void; contentType?: ContentType; placeholder?: string;
  /** Example titles typed into the empty field. */
  suggestions?: readonly string[];
  /** Press "/" anywhere to jump to the search box. */
  shortcut?: boolean;
  /** Unique id for the input (and prefix for its results), so two search boxes can share a page. */
  inputId?: string;
}) {
  const optionsId = `${inputId}-options`;
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [movies, setMovies] = useState<MovieCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  // Keyboard highlight in the results list (-1 = none): ↓/↑ move, Enter opens, Esc closes.
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useTypedSuggestion(suggestions, !focused && !query);
  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&type=${contentType}`, { signal: controller.signal });
        if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Please sign in again to search titles.");
        const data = await response.json() as { error?: string; movies?: MovieCard[] };
        if (!response.ok) throw new Error(data.error ?? "Search is unavailable.");
        if (!controller.signal.aborted) { setMovies(data.movies ?? []); setActive(-1); setLoading(false); }
      } catch (error) {
        if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : "Search is unavailable."); setLoading(false); }
      }
    }, 280);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, contentType]);
  const noun = contentType === "movie" ? "film" : contentType === "tv" ? "series" : "title";
  const pluralNoun = contentType === "movie" ? "films" : contentType === "tv" ? "series" : "titles";
  const basePlaceholder = customPlaceholder ?? (contentType === "movie"
    ? "Type a movie you like—we’ll find very similar films"
    : contentType === "tv"
      ? "Type a series you like—we’ll find very similar shows"
      : "Type a movie or series you like—we’ll find similar picks");
  const placeholder = typed === null ? basePlaceholder : `Search a title, like ${typed}▏`;
  const open = !dismissed && query.trim().length >= 2;
  const choose = (movie: MovieCard) => { setDismissed(true); setActive(-1); onSelect(movie); };
  const moveHighlight = (step: number) => {
    if (!movies.length) return;
    const next = active < 0 ? (step > 0 ? 0 : movies.length - 1) : (active + step + movies.length) % movies.length;
    setActive(next);
    listRef.current?.querySelector<HTMLElement>(`#${optionId(next)}`)?.scrollIntoView({ block: "nearest" });
  };
  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open || !movies.length) return;
      event.preventDefault();
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      if (!open || !movies.length) return;
      event.preventDefault();
      choose(movies[active >= 0 ? active : 0]);
    } else if (event.key === "Escape") {
      setDismissed(true);
      setActive(-1);
    }
  };
  return <div className="inline-film-search" onFocus={() => setDismissed(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDismissed(true); }} onKeyDown={(event) => { if (event.key === "Escape") setDismissed(true); }} onInput={() => setDismissed(false)}>
    <div className="inline-search-field" role="search">
      <Search aria-hidden="true" />
      <label className="sr-only" htmlFor={inputId}>Search movies and series</label>
      <input
        id={inputId} ref={inputRef} type="search" autoComplete="off" maxLength={80} placeholder={placeholder}
        role="combobox" aria-autocomplete="list" aria-expanded={open && movies.length > 0} aria-controls={optionsId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-keyshortcuts={shortcut ? "/" : undefined} value={query}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onInputKeyDown}
        onChange={(event) => { setQuery(event.target.value); setMovies([]); setActive(-1); setError(""); setLoading(event.target.value.trim().length >= 2); }}
      />
      {shortcut && !query && !focused ? <kbd className="search-kbd" aria-hidden="true">/</kbd> : null}
    </div>
      {open && <div className="movie-search-results inline-film-results" aria-busy={loading} ref={listRef}>
        <p role="status">{loading ? `Searching ${pluralNoun}…` : error || (query.trim().length < 2 ? "Type at least two characters to explore." : !movies.length ? `No ${pluralNoun} found. Try another title.` : `Choose a ${noun} to open its map.`)}</p>
        <div id={optionsId} role="listbox" aria-label="Search results" className="search-options">
        {movies.map((movie, index) => <button aria-selected={index === active} className={`search-result ${index === active ? "is-active" : ""}`} id={optionId(index)} key={`${movie.mediaType}-${movie.id}`} onClick={() => choose(movie)} onMouseEnter={() => setActive(index)} role="option" tabIndex={-1} type="button">
          <span className="result-poster" aria-hidden="true" style={{ "--preview-palette": movie.palette } as CSSProperties}>
            {movie.posterUrl ? <Image src={movie.posterUrl.replace("/w780/", "/w185/")} alt="" fill sizes="40px" unoptimized /> : null}
          </span>
          <span className="result-copy"><strong>{movie.title}</strong><small>{[movie.mediaType === "tv" ? "Series" : "Movie", movie.year, ...movie.genres.slice(0, 2)].filter((part) => part && part !== "—").join(" · ")}</small></span>
          <ArrowUpRight className="result-go" aria-hidden="true" />
        </button>)}
        </div>
      </div>}
  </div>;
}
