"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { ArrowUpRight, Bookmark, BookmarkCheck, Brain, Heart, Info, LayoutGrid, LocateFixed, Move, Orbit, Play, RotateCw, Shuffle, Sparkles, Star, TrendingUp, X, Zap } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GENRES, MOODS, PREVIEW_MOVIES, type ContentType, type MediaType, type MovieCard, type MovieDetail, type MoodSlug } from "@/lib/reelspace";
import { MovieSearch } from "@/app/movie-search";
import { CATEGORIES, CATEGORY_GROUPS, findCategory, type CategoryGroup } from "@/lib/categories";
import { useSessionPref } from "@/lib/session-pref";
import { browseHref, browsePickName, isGenrePick, parseBrowsePick } from "@/lib/browse-link";
import { OPEN_SAVED_EVENT, isSaved, openSavedPanel, savedKey, toggleSaved, useSaved } from "@/lib/saved";

const TILE_WIDTH = 1520;
const TILE_HEIGHT = 2000;
const TILE_OFFSETS = [0, 1, 2];

const CARD_POSITIONS = Array.from({ length: 16 }, (_, index) => ({
  x: 100 + (index % 4) * 380,
  y: 100 + Math.floor(index / 4) * 500,
  width: 220,
  rotate: 0,
}));

const MOOD_PATHS = [
  { id: "feel-good", title: "Feel good", note: "Warm, funny and restorative", base: "feel-good", Icon: Heart },
  { id: "excited", title: "Get excited", note: "Fast, bold and full of momentum", base: "adrenaline", Icon: Zap },
  { id: "thoughtful", title: "Think deeply", note: "Ideas that stay with you", base: "thought-provoking", Icon: Brain },
  { id: "emotional", title: "Feel something", note: "Moving, intimate and human", base: "emotional", Icon: Sparkles },
  { id: "escape", title: "Escape reality", note: "Wonder, discovery and new worlds", base: "dreamy", Icon: Play },
  { id: "surprise", title: "Be surprised", note: "Unexpected turns and discoveries", base: "unexpected", Icon: Shuffle },
] satisfies Array<{ id: string; title: string; note: string; base: MoodSlug; Icon: typeof Heart }>;

type Phase = "setup" | "canvas";
type View = "home" | "browse";
type MapPayload = { seed: MovieCard; movies: MovieCard[]; outer?: MovieCard[]; configured?: boolean; rank?: number; error?: string };

const titleKey = (movie: Pick<MovieCard, "id" | "mediaType">) => `${movie.mediaType}-${movie.id}`;
const mapHref = (movie: Pick<MovieCard, "id" | "mediaType">) => `/?id=${movie.id}&type=${movie.mediaType}`;

// TMDB serves posters at fixed widths. Cards show them at 128–220px, so w342 (w500 for the larger
// category cards) stays sharp on retina screens at ~¼ the weight of w780; the details panel keeps w780.
type PosterSize = "w342" | "w500" | "w780";
const posterSrc = (url: string, size: PosterSize) => url.replace(/\/w\d+\//, `/${size}/`);
const cardPosterSize = (cardWidth: number): PosterSize => cardWidth > 200 ? "w500" : "w342";

// Fetch and decode posters before results are revealed, so cards turn over with their artwork already
// there. Never waits longer than `maxWait`, so a slow connection can't stall the page.
function preloadPosters(movies: MovieCard[], size: PosterSize, limit = 12, maxWait = 2000) {
  const loads = movies.slice(0, limit).flatMap((movie) => movie.posterUrl ? [posterSrc(movie.posterUrl, size)] : []).map((src) => {
    const image = new window.Image();
    image.src = src;
    return image.decode().catch(() => undefined);
  });
  return Promise.race([Promise.all(loads), new Promise((resolve) => window.setTimeout(resolve, maxWait))]);
}

// How long the blank cards take to deal out; results never arrive before this.
const DEAL_MS = 1050;

// A light tap on phones. Android exposes vibrate(); iOS 18+ Safari has no vibrate(), but
// toggling a native switch control gives the same system haptic tick.
function haptic() {
  if (typeof navigator === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
  if (typeof navigator.vibrate === "function") { navigator.vibrate(10); return; }
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  document.body.appendChild(label);
  label.click();
  label.remove();
}

type CardOrigin = { left: number; top: number; width: number; height: number };
type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition: (update: () => void) => ViewTransitionLike;
};

// The browser may skip a view transition (e.g. while the window is in the background). The DOM update
// still happens, so treat every outcome as "done" and never leave a rejected promise unhandled.
function transitionDone(transition: ViewTransitionLike) {
  transition.ready.catch(() => undefined);
  return transition.finished.catch(() => undefined);
}

function formatRuntime(title: MovieCard) {
  if (!title.runtime) return title.mediaType === "tv" ? "Episode length TBA" : "Runtime TBA";
  if (title.mediaType === "tv") return `${title.runtime}m episodes`;
  const hours = Math.floor(title.runtime / 60);
  const minutes = title.runtime % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// The mark: a play button with the next title queued behind it — "up next". Monochrome, drawn in
// currentColor so it sits on any surface.
function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M9 9.5L25.5 20L9 30.5Z" fill="currentColor" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path className="brand-queued" d="M29.5 14.5L35 20L29.5 25.5Z" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

function Brand() {
  return (
    <span className="brand" role="img" aria-label="NextWatch">
      <BrandMark className="brand-mark" />
      <span className="brand-wordmark" aria-hidden="true">nextwatch</span>
    </span>
  );
}

// The logo always links to the homepage. On the homepage itself `onHome` takes over (back to today's
// trending map, in place); modified clicks (new tab / window) still follow the real link.
function HomeLogo({ onHome }: { onHome?: () => void }) {
  return (
    <Link
      aria-label="NextWatch home"
      className="brand-link"
      href="/"
      onClick={(event) => {
        if (!onHome || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onHome();
      }}
    >
      <Brand />
    </Link>
  );
}

// Opens the "Saved" panel; shows how many titles are saved.
function SavedButton() {
  const count = useSaved().length;
  return (
    <button aria-label={count ? `Saved titles (${count})` : "Saved titles"} className="header-link saved-link" onClick={openSavedPanel} type="button">
      <Bookmark aria-hidden="true" /> Saved{count ? <span className="saved-count" aria-hidden="true">{count}</span> : null}
    </button>
  );
}

// The Saved panel: posters of everything you've saved. Pick one to open its map, or remove it.
function SavedDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (movie: MovieCard) => void }) {
  const saved = useSaved();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="credits-dialog saved-dialog">
        <DialogHeader>
          <DialogTitle>Saved for later</DialogTitle>
          <DialogDescription>{saved.length ? `${saved.length} ${saved.length === 1 ? "title" : "titles"}, kept in this browser.` : "Nothing saved yet. Open any title and tap Save to keep it here."}</DialogDescription>
        </DialogHeader>
        {saved.length ? (
          <ul className="saved-grid">
            {saved.map((movie) => (
              <li key={savedKey(movie)}>
                <button className="saved-item" onClick={() => onPick(movie)} type="button">
                  <span className="saved-poster" style={{ "--preview-palette": movie.palette } as CSSProperties}>
                    {movie.posterUrl ? <Image alt="" fill sizes="140px" src={posterSrc(movie.posterUrl, "w342")} unoptimized /> : null}
                  </span>
                  <span className="saved-title">{movie.title}</span>
                  <span className="saved-meta">{movie.mediaType === "tv" ? "Series" : "Movie"} · {movie.year}</span>
                </button>
                <button aria-label={`Remove ${movie.title} from saved`} className="saved-remove" onClick={() => toggleSaved(movie)} type="button"><X aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// One top bar for every page: logo left, search centre, the other page on the right.
function SiteHeader({ onSearchSelect, link, onHome }: {
  onSearchSelect: (movie: MovieCard) => void;
  link: { href: string; label: string; icon: typeof LayoutGrid };
  /** On the homepage: what the logo does instead of navigating. */
  onHome?: () => void;
}) {
  const LinkIcon = link.icon;
  return (
    <header className="canvas-header has-search site-header">
      <HomeLogo onHome={onHome} />
      <div className="home-search">
        <MovieSearch contentType="both" onSelect={onSearchSelect} placeholder="Search any movie or series…" shortcut suggestions={SEARCH_SUGGESTIONS} />
      </div>
      <div className="header-actions">
        <SavedButton />
        <Link className="header-link" href={link.href} aria-label={link.label}><LinkIcon aria-hidden="true" /> {link.label}</Link>
      </div>
    </header>
  );
}

// The homepage had nothing to show (today's map, or the title in a shared link, failed to load).
// Instead of a loader that never ends, a calm full screen with a way forward.
function MapUnavailable({ sharedTitle, detail, onRetry, onTrending, onSearchSelect }: {
  sharedTitle: boolean; detail: string; onRetry: () => void; onTrending: () => void; onSearchSelect: (movie: MovieCard) => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { retryRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <main className="canvas-screen map-unavailable">
      <SiteHeader link={{ href: "/browse", label: "Browse categories", icon: LayoutGrid }} onHome={onTrending} onSearchSelect={onSearchSelect} />
      <section className="unavailable-body" role="alert">
        <div className="unavailable-reel" aria-hidden="true"><span /><span /><span /><Orbit /></div>
        <h1>{sharedTitle ? "We couldn’t open this map" : "The projector jammed"}</h1>
        <p>{sharedTitle
          ? "The link may be old, or the title isn’t on TMDB any more. Search for it above, or start from today’s trending map."
          : "Today’s trending map didn’t load. It’s usually a short hiccup, so give it another go, or browse by category in the meantime."}</p>
        <div className="unavailable-actions">
          <button className="unavailable-primary" onClick={onRetry} ref={retryRef} type="button"><RotateCw aria-hidden="true" /> Try again</button>
          {sharedTitle
            ? <button className="unavailable-secondary" onClick={onTrending} type="button"><TrendingUp aria-hidden="true" /> Today’s trending</button>
            : <Link className="unavailable-secondary" href="/browse"><LayoutGrid aria-hidden="true" /> Browse categories</Link>}
        </div>
        <small>{detail}</small>
      </section>
    </main>
  );
}

function PosterArt({ movie, priority = false, eager = false, size = "w780", placeholderSize }: { movie: MovieCard; priority?: boolean; eager?: boolean; size?: PosterSize; placeholderSize?: PosterSize }) {
  return (
    <div className="poster-art" style={{ "--poster-palette": movie.palette } as CSSProperties}>
      {/* The card's already-downloaded poster shows instantly underneath while the sharp one loads. */}
      {movie.posterUrl && placeholderSize ? <Image src={posterSrc(movie.posterUrl, placeholderSize)} alt="" aria-hidden="true" fill sizes="280px" unoptimized /> : null}
      {movie.posterUrl ? (
        <Image
          src={posterSrc(movie.posterUrl, size)}
          alt={`${movie.title} poster`}
          fill
          sizes="(max-width: 700px) 180px, 280px"
          priority={priority}
          loading={priority ? undefined : eager ? "eager" : "lazy"}
          unoptimized
        />
      ) : (
        <div className="fallback-poster" aria-hidden="true">
          <span className="fallback-mark">{String(Math.abs(movie.id)).padStart(2, "0")}</span>
          <strong>{movie.title}</strong>
          <small>AN ORIGINAL PREVIEW</small>
        </div>
      )}
      <span className="poster-sheen" />
    </div>
  );
}

function TasteSetup({
  contentType,
  setContentType,
  selectedGenres,
  selectedMoods,
  setSelectedMoods,
  onSelectGenre,
  selectedCategory,
  onSelectCategory,
  onSearch,
  error,
}: {
  contentType: ContentType;
  setContentType: (value: ContentType) => void;
  selectedGenres: number[];
  selectedMoods: MoodSlug[];
  setSelectedMoods: (value: MoodSlug[]) => void;
  onSelectGenre: (genreId: number, trigger: HTMLButtonElement) => void;
  selectedCategory: string | null;
  onSelectCategory: (slug: string, trigger: HTMLButtonElement) => void;
  onSearch: (movie: MovieCard) => void;
  error: string | null;
}) {
  // Posters for the tiles, tagged with the content type they were fetched for (a set for another type is ignored).
  const [loadedPosters, setLoadedPosters] = useState<{ type: ContentType; genres: Record<string, Array<{ id: number; title: string; posterUrl: string }>> } | null>(null);
  const folderPosters = loadedPosters?.type === contentType ? loadedPosters.genres : {};
  useEffect(() => {
    const controller = new AbortController();
    // The version changes whenever the set of tiles does, so browsers never reuse a poster list cached before it.
    fetch(`/api/folder-posters?type=${contentType}&v=${POSTER_VERSION}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) return; const data = await response.json() as { genres?: Record<string, Array<{ id: number; title: string; posterUrl: string }>> }; if (!controller.signal.aborted) setLoadedPosters({ type: contentType, genres: data.genres ?? {} }); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [contentType]);
  // Every tile on the page — the plain genres, then the curated categories — in display order.
  const tiles: Array<{ key: string; name: string; group: "genres" | CategoryGroup; previewGenre: number; media?: MediaType; selected: boolean; pick: (trigger: HTMLButtonElement) => void }> = [
    ...GENRES.map((genre) => ({ key: String(genre.id), name: genre.name, group: "genres" as const, previewGenre: genre.id, selected: !selectedCategory && selectedGenres.includes(genre.id), pick: (trigger: HTMLButtonElement) => onSelectGenre(genre.id, trigger) })),
    ...CATEGORIES.map((category) => ({ key: category.slug, name: category.name, group: category.group, previewGenre: category.genres?.[0] ?? 18, media: category.media, selected: selectedCategory === category.slug, pick: (trigger: HTMLButtonElement) => onSelectCategory(category.slug, trigger) })),
  ];
  const sections = [{ id: "genres" as const, name: "Genres" }, ...CATEGORY_GROUPS];
  // Give each tile three posters no earlier tile is already showing.
  const tilePosters = (() => {
    const used = new Set<number>();
    return Object.fromEntries(tiles.map((tile) => {
      const options = folderPosters[tile.key] ?? [];
      const picks = options.filter((poster) => !used.has(poster.id)).slice(0, 3);
      const filled = picks.length === 3 ? picks : [...picks, ...options.filter((poster) => !picks.includes(poster))].slice(0, 3);
      filled.forEach((poster) => used.add(poster.id));
      return [tile.key, filled];
    }));
  })();
  const toggleMood = (base: MoodSlug) => setSelectedMoods(selectedMoods[0] === base ? [] : [base]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let target = window.scrollY;
    let lastTime = 0;
    const stop = () => { cancelAnimationFrame(frame); frame = 0; lastTime = 0; };
    const tick = (time: number) => {
      const ease = 1 - Math.exp(-Math.min(lastTime ? time - lastTime : 16.67, 50) / 90);
      lastTime = time;
      const next = window.scrollY + (target - window.scrollY) * ease;
      window.scrollTo({ top: next, behavior: "instant" });
      if (Math.abs(target - window.scrollY) > 1) frame = requestAnimationFrame(tick);
      else { window.scrollTo({ top: target, behavior: "instant" }); stop(); }
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[role="dialog"], .inline-film-results')) return;
      if (motion.matches || event.ctrlKey || event.shiftKey || !event.cancelable) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      event.preventDefault();
      if (!frame) target = window.scrollY;
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? window.innerHeight : 1;
      target = Math.max(0, Math.min(max, target + event.deltaY * unit));
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
    motion.addEventListener("change", stop);
    return () => {
      stop();
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      motion.removeEventListener("change", stop);
    };
  }, []);

  const previewsFor = (genreId: number) => {
    const eligible = PREVIEW_MOVIES.filter((title) => contentType === "both" || title.mediaType === contentType);
    const matches = eligible.filter((title) => title.genreIds.includes(genreId));
    return [...matches, ...eligible.filter((title) => !title.genreIds.includes(genreId))].slice(0, 3);
  };

  return (
    <main className="taste-preview setup-screen browse-screen">
      <SiteHeader link={{ href: "/", label: "Similarity map", icon: Orbit }} onSearchSelect={onSearch} />

      <section className="browse-panel">
        <div className="browse-hero">
          <h1>What are we watching tonight?</h1>
          <p>Pick a mood, then a genre. We’ll deal you sixteen.</p>
        </div>

        <div className="browse-controls">
          <div className="mood-chips" role="group" aria-label="Mood">
            <button aria-pressed={!selectedMoods.length} className={!selectedMoods.length ? "active" : ""} onClick={() => setSelectedMoods([])} type="button"><Shuffle aria-hidden="true" /> Any mood</button>
            {MOOD_PATHS.map(({ id, title, note, base, Icon }) => (
              <button aria-pressed={selectedMoods[0] === base} className={selectedMoods[0] === base ? "active" : ""} key={id} onClick={() => toggleMood(base)} title={note} type="button">
                <Icon aria-hidden="true" /> {title}
              </button>
            ))}
          </div>
          <div className="content-type-filter" aria-label="Choose what to recommend" role="group">
            {([
              ["both", "Both"],
              ["movie", "Movies"],
              ["tv", "Series"],
            ] as Array<[ContentType, string]>).map(([value, label]) => (
              <button aria-pressed={contentType === value} className={contentType === value ? "active" : ""} key={value} onClick={() => setContentType(value)} type="button">{label}</button>
            ))}
          </div>
        </div>

        {sections.map((section) => (
          <section className="browse-section" key={section.id} aria-labelledby={`browse-${section.id}`}>
            <h2 id={`browse-${section.id}`}>{section.name}</h2>
            <div className="genre-grid">
              {tiles.filter((tile) => tile.group === section.id).map((tile, tileIndex) => {
                const kind = (tile.media ?? contentType) === "movie" ? "movies" : (tile.media ?? contentType) === "tv" ? "series" : "movies and series";
                return (
                  <button
                    aria-label={`Deal ${tile.name} ${kind}`}
                    className={`genre-tile ${tile.selected ? "is-selected" : ""}`}
                    key={tile.key}
                    onClick={(event) => { haptic(); tile.pick(event.currentTarget); }}
                    style={{ "--tile-index": Math.min(tileIndex, 12) } as CSSProperties}
                    type="button"
                  >
                    <span className="genre-art" aria-hidden="true">
                      {previewsFor(tile.previewGenre).map((movie, index) => (
                        <span className="genre-art-cell" key={movie.id} style={{ "--preview-palette": movie.palette } as CSSProperties}>
                          {tilePosters[tile.key]?.[index] ? <Image src={tilePosters[tile.key][index].posterUrl} alt="" fill sizes="(max-width: 650px) 60px, 120px" unoptimized onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /> : null}
                        </span>
                      ))}
                    </span>
                    <span className="genre-label"><strong>{tile.name}</strong><span className="genre-go"><ArrowUpRight aria-hidden="true" /></span></span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {error ? <p className="setup-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}

// A wink per genre while its picks load.
const GENRE_LOADING_LINES: Record<number, string> = {
  28: "Revving the engines…", 12: "Packing the compass…", 16: "Inking the frames…", 35: "Warming up the laugh track…",
  80: "Dusting for prints…", 99: "Fact-checking the facts…", 18: "Cueing the swelling strings…", 10751: "Making the popcorn…",
  14: "Unrolling the old maps…", 36: "Blowing dust off the archives…", 27: "Checking under the bed…", 10402: "Tuning up…",
  9648: "Following the clues…", 10749: "Lighting the candles…", 878: "Calibrating the warp drive…", 53: "Following a lead…",
  10752: "Plotting the campaign…", 37: "Saddling up…",
};

const POSTER_VERSION = `${GENRES.length}-${CATEGORIES.map((category) => category.slug).join(".").length}`;
const SEARCH_SUGGESTIONS = ["Arrival", "Severance", "Spirited Away", "The Bear", "Parasite", "Past Lives", "Dark", "Mad Max: Fury Road"] as const;
const MAP_TILE = 4400;
const MAP_ZOOM = .72;
// Phones start further out so the whole first ring of matches fits on screen (pinch to get closer).
const PHONE_MAP_ZOOM = .4;
const startZoom = () => window.matchMedia("(max-width: 650px)").matches ? PHONE_MAP_ZOOM : MAP_ZOOM;

function useInfiniteCanvas(mapMode = false) {
  const tileWidth = mapMode ? MAP_TILE : TILE_WIDTH;
  const tileHeight = mapMode ? MAP_TILE : TILE_HEIGHT;
  const layerRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef<HTMLDivElement>(null);
  const zoom = useRef(mapMode ? MAP_ZOOM : 1);
  const camera = useRef({ x: -680, y: -430 });
  const pointer = useRef({ id: -1, x: 0, y: 0, time: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const wheelTarget = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const reducedMotion = useRef(false);
  const [dragging, setDragging] = useState(false);

  const paint = useCallback(() => {
    if (!layerRef.current) return;
    // Wrap into [-2 tiles, -1 tile) so the middle tile — the real, focusable one — fills the
    // screen at rest; its copies only scroll in to cover the edges while you pan.
    const x = ((camera.current.x % tileWidth) + tileWidth) % tileWidth - tileWidth * 2;
    const y = ((camera.current.y % tileHeight) + tileHeight) % tileHeight - tileHeight * 2;
    layerRef.current.style.transform = `translate3d(${x * zoom.current}px, ${y * zoom.current}px, 0) scale(${zoom.current})`;
    // Only lay out the copies of the map that are on (or near) the screen — at most 4 of the 9, usually
    // 1–2 — so phones aren't rendering ~400 posters. Toggled only when a copy crosses the edge.
    const margin = 300;
    const z = zoom.current;
    Array.from(layerRef.current.children).forEach((child, index) => {
      const tile = child as HTMLElement;
      const left = (x + (index % 3) * tileWidth) * z;
      const top = (y + Math.floor(index / 3) * tileHeight) * z;
      const near = left < window.innerWidth + margin && left + tileWidth * z > -margin && top < window.innerHeight + margin && top + tileHeight * z > -margin;
      const display = near ? "" : "none";
      if (tile.style.display !== display) tile.style.display = display;
    });
    // Two dot fields drift slower than the posters, so the canvas reads as deep space rather than a flat sheet.
    if (depthRef.current) {
      const far = { x: camera.current.x * zoom.current * .12, y: camera.current.y * zoom.current * .12 };
      const near = { x: camera.current.x * zoom.current * .3, y: camera.current.y * zoom.current * .3 };
      depthRef.current.style.backgroundPosition = `${far.x}px ${far.y}px, ${near.x}px ${near.y}px`;
    }
  }, [tileWidth, tileHeight]);

  const stopFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    wheelTarget.current = null;
  }, []);

  const coast = useCallback(() => {
    stopFrame();
    if (reducedMotion.current) return;
    const tick = () => {
      velocity.current.x *= .92;
      velocity.current.y *= .92;
      camera.current.x += velocity.current.x;
      camera.current.y += velocity.current.y;
      paint();
      if (Math.abs(velocity.current.x) + Math.abs(velocity.current.y) > .4) frame.current = requestAnimationFrame(tick);
      else frame.current = null;
    };
    frame.current = requestAnimationFrame(tick);
  }, [paint, stopFrame]);

  const centerCamera = useCallback(() => {
    camera.current = { x: window.innerWidth / (2 * zoom.current) - tileWidth / 2, y: (window.innerHeight / 2 + 30) / zoom.current - tileHeight / 2 };
  }, [tileWidth, tileHeight]);

  // Zoom toward a point on screen, keeping whatever is under that point in place.
  const zoomAt = useCallback((screenX: number, screenY: number, nextZoom: number) => {
    const clamped = Math.max(.35, Math.min(1.25, nextZoom));
    camera.current = {
      x: screenX / clamped - (screenX / zoom.current - camera.current.x),
      y: screenY / clamped - (screenY / zoom.current - camera.current.y),
    };
    zoom.current = clamped;
    paint();
  }, [paint]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotion.current = preference.matches; if (preference.matches) stopFrame(); };
    update();
    preference.addEventListener("change", update);
    if (mapMode) { zoom.current = startZoom(); centerCamera(); }
    paint();
    return () => { stopFrame(); preference.removeEventListener("change", update); };
  }, [paint, stopFrame, mapMode, centerCamera]);

  // Wheel / trackpad: scroll pans the canvas; pinch (ctrl+wheel) zooms the map around the cursor.
  // Registered natively as non-passive — React's wheel listeners are passive, so they can't cancel
  // the browser's own scroll or zoom (and log an error every time they try).
  useEffect(() => {
    const stage = layerRef.current?.parentElement;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        if (!mapMode) return;
        event.preventDefault();
        stopFrame();
        zoomAt(event.clientX, event.clientY, zoom.current * Math.exp(-event.deltaY * .01));
        return;
      }
      event.preventDefault();
      const target = { ...(wheelTarget.current ?? camera.current) };
      const factor = (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? window.innerHeight : 1) / zoom.current;
      target.x -= (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * factor;
      target.y -= (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * factor;
      if (reducedMotion.current) {
        stopFrame();
        camera.current = target;
        paint();
        return;
      }
      if (wheelTarget.current) { wheelTarget.current = target; return; }
      stopFrame();
      wheelTarget.current = target;
      let lastTime = performance.now();
      const tick = (now: number) => {
        const destination = wheelTarget.current;
        if (!destination) return;
        const ease = 1 - Math.exp(-Math.min(now - lastTime, 50) / 90);
        lastTime = now;
        camera.current.x += (destination.x - camera.current.x) * ease;
        camera.current.y += (destination.y - camera.current.y) * ease;
        paint();
        if (Math.hypot(destination.x - camera.current.x, destination.y - camera.current.y) > .2) frame.current = requestAnimationFrame(tick);
        else { camera.current = destination; paint(); frame.current = null; wheelTarget.current = null; }
      };
      frame.current = requestAnimationFrame(tick);
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [mapMode, paint, stopFrame, zoomAt]);

  // Two fingers on a touch screen pinch-zoom the map around the point between them.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const touchSpread = () => {
    const [a, b] = [...touches.current.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (mapMode && touches.current.size === 2) {
        stopFrame();
        pinch.current = { distance: Math.max(1, touchSpread().distance), zoom: zoom.current };
        pointer.current.id = -1;
        moved.current = true;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
        return;
      }
    }
    const startedOnControl = Boolean((event.target as HTMLElement).closest("button,a"));
    if (!startedOnControl) event.preventDefault();
    stopFrame();
    moved.current = false;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    velocity.current = { x: 0, y: 0 };
    if (!startedOnControl) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      setDragging(true);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && touches.current.size >= 2) {
      const spread = touchSpread();
      zoomAt(spread.x, spread.y, pinch.current.zoom * spread.distance / pinch.current.distance);
      return;
    }
    if (pointer.current.id !== event.pointerId) return;
    const now = performance.now();
    const dx = (event.clientX - pointer.current.x) / zoom.current;
    const dy = (event.clientY - pointer.current.y) / zoom.current;
    const dt = Math.max(8, now - pointer.current.time);
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      moved.current = true;
      try { if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      setDragging(true);
    }
    camera.current.x += dx;
    camera.current.y += dy;
    velocity.current = { x: (dx / dt) * 16, y: (dy / dt) * 16 };
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: now };
    paint();
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) { pinch.current = null; setDragging(false); }
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      return;
    }
    if (pointer.current.id !== event.pointerId) return;
    pointer.current.id = -1;
    setDragging(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
    coast();
  };

  // Smoothly move the camera by an offset (in canvas units), e.g. to bring a focused poster into view.
  const glideBy = (x: number, y: number) => {
    stopFrame();
    const destination = { x: camera.current.x + x, y: camera.current.y + y };
    if (reducedMotion.current) { camera.current = destination; paint(); return; }
    let lastTime = performance.now();
    const tick = (now: number) => {
      const ease = 1 - Math.exp(-Math.min(now - lastTime, 50) / 110);
      lastTime = now;
      camera.current.x += (destination.x - camera.current.x) * ease;
      camera.current.y += (destination.y - camera.current.y) * ease;
      paint();
      if (Math.hypot(destination.x - camera.current.x, destination.y - camera.current.y) > .3) frame.current = requestAnimationFrame(tick);
      else { camera.current = destination; paint(); frame.current = null; }
    };
    frame.current = requestAnimationFrame(tick);
  };
  const currentZoom = () => zoom.current;

  const nudge = (x: number, y: number) => {
    stopFrame();
    camera.current.x += x;
    camera.current.y += y;
    paint();
  };

  const wasDragged = useCallback(() => moved.current, []);
  // +/− zoom around the middle of the screen so you keep your place; "Center map" resets.
  const changeZoom = (delta: number) => {
    stopFrame();
    if (delta) { zoomAt(window.innerWidth / 2, window.innerHeight / 2, zoom.current + delta); return; }
    zoom.current = startZoom();
    centerCamera();
    paint();
  };

  return { layerRef, depthRef, wasDragged, dragging, onPointerDown, onPointerMove, onPointerUp: finishPointer, onPointerCancel: finishPointer, nudge, changeZoom, glideBy, currentZoom };
}

// One shared frame loop: measure the camera once, then animate cards from their
// resting positions so their own transforms never feed back into the distance.
function usePosterProximity(layerRef: { current: HTMLDivElement | null }, contentKey: string) {
  useEffect(() => {
    const layer = layerRef.current;
    const stage = layer?.parentElement;
    if (!layer || !stage) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cursor = { x: 0, y: 0, active: false };
    let frame = 0;
    let previousTime = 0;
    const cards = Array.from(layer.querySelectorAll<HTMLButtonElement>("button.movie-card")).map((element) => ({
      element, left: 0, top: 0, width: 0, height: 0,
      x: 0, y: 0, strength: 0,
    }));
    const measure = () => {
      if (!layer.isConnected) return;
      cards.forEach((card) => {
        const tile = card.element.offsetParent as HTMLElement | null;
        if (!tile) return;
        card.width = card.element.offsetWidth;
        card.height = card.element.offsetHeight;
        card.left = tile.offsetLeft + card.element.offsetLeft + card.width / 2;
        card.top = tile.offsetTop + card.element.offsetTop + card.height / 2;
      });
    };
    const tick = (time: number) => {
      frame = 0;
      const dt = Math.min(50, previousTime ? time - previousTime : 16.67);
      previousTime = time;
      const ease = 1 - Math.exp(-dt / 115);
      const bounds = layer.getBoundingClientRect();
      const scale = bounds.width / layer.offsetWidth;
      let unsettled = false;
      // Measure before writing; all remaining geometry is cached layout data.
      cards.forEach((card) => {
        const dx = cursor.x - (bounds.left + card.left * scale);
        const dy = cursor.y - (bounds.top + card.top * scale);
        const distance = Math.hypot(dx, dy);
        const radius = Math.max(360, card.width * 1.8);
        const falloff = Math.max(0, 1 - distance / radius);
        const strength = cursor.active && !motion.matches ? falloff * falloff * (3 - 2 * falloff) : 0;
        if (!strength && !card.x && !card.y && !card.strength) return;
        const targetX = dx * strength * .16;
        const targetY = dy * strength * .16;
        card.x += (targetX - card.x) * ease;
        card.y += (targetY - card.y) * ease;
        card.strength += (strength - card.strength) * ease;
        const moving = Math.abs(card.x - targetX) + Math.abs(card.y - targetY) + Math.abs(card.strength - strength) > .015;
        unsettled ||= moving;
        if (!moving && !strength) { card.x = 0; card.y = 0; card.strength = 0; }
        card.element.style.setProperty("--near-x", `${card.x.toFixed(3)}px`);
        card.element.style.setProperty("--near-y", `${card.y.toFixed(3)}px`);
        card.element.style.setProperty("--near-scale", `${(1 + card.strength * .045).toFixed(4)}`);
        card.element.style.setProperty("--tilt-x", `${(-card.y * .14).toFixed(3)}deg`);
        card.element.style.setProperty("--tilt-y", `${(card.x * .18).toFixed(3)}deg`);
      });
      // Keep tracking while present so wheel panning and momentum also update proximity.
      if ((cursor.active && !motion.matches) || unsettled) frame = requestAnimationFrame(tick);
      else previousTime = 0;
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(tick); };
    const leave = () => { cursor.active = false; start(); };
    const move = (event: PointerEvent) => {
      cursor.x = event.clientX;
      cursor.y = event.clientY;
      cursor.active = event.pointerType !== "touch" && !event.buttons && !motion.matches;
      start();
    };
    const resetMotion = () => {
      if (motion.matches) {
        cards.forEach((card) => {
          card.x = 0; card.y = 0; card.strength = 0;
          ["--near-x", "--near-y", "--near-scale", "--tilt-x", "--tilt-y"].forEach((property) => card.element.style.removeProperty(property));
        });
        leave();
      }
    };
    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    cards.forEach((card) => resize.observe(card.element));
    measure();
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("pointerdown", leave);
    stage.addEventListener("pointercancel", leave);
    window.addEventListener("blur", leave);
    motion.addEventListener("change", resetMotion);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("pointerdown", leave);
      stage.removeEventListener("pointercancel", leave);
      window.removeEventListener("blur", leave);
      motion.removeEventListener("change", resetMotion);
    };
  }, [layerRef, contentKey]);
}

function MovieCardButton({
  movie,
  position,
  clone,
  onOpen,
  wasDragged,
  entryHero,
  onHighlight,
  enter,
  flipDelay,
  eagerPoster = false,
  saved = false,
  className = "",
}: {
  movie: MovieCard;
  position: (typeof CARD_POSITIONS)[number];
  clone: boolean;
  onOpen: (movie: MovieCard, origin: CardOrigin, trigger: HTMLButtonElement) => void;
  wasDragged: () => boolean;
  entryHero?: boolean;
  onHighlight?: (card: HTMLElement, active: boolean) => void;
  /** Fly in from the map centre: offset back to the centre and a stagger delay. */
  enter?: { x: number; y: number; delay: number };
  /** Turn face-up after this many milliseconds (genre results). */
  flipDelay?: number;
  /** Load the poster straight away (it was preloaded, so it's ready for the flip). */
  eagerPoster?: boolean;
  /** Marked with a small bookmark when it's in the Saved list. */
  saved?: boolean;
  className?: string;
}) {
  const runtime = movie.runtime ? formatRuntime(movie) : null;
  return (
    <button
      onPointerEnter={onHighlight ? (event) => onHighlight(event.currentTarget, true) : undefined}
      onPointerLeave={onHighlight ? (event) => onHighlight(event.currentTarget, false) : undefined}
      onFocus={onHighlight ? (event) => onHighlight(event.currentTarget, true) : undefined}
      onBlur={onHighlight ? (event) => onHighlight(event.currentTarget, false) : undefined}
      aria-label={`Open ${movie.title}, ${movie.mediaType === "tv" ? "series" : "movie"}, ${movie.year}${runtime ? `, ${runtime}` : ""}`}
      className={`movie-card ${enter ? "is-entering" : ""} ${flipDelay !== undefined ? "is-flipping" : ""} ${saved ? "is-saved" : ""} ${className}`}
      onClick={(event) => {
        if (wasDragged()) return;
        const poster = event.currentTarget.querySelector<HTMLElement>(".poster-art");
        const bounds = (poster ?? event.currentTarget).getBoundingClientRect();
        onOpen(movie, { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }, event.currentTarget);
      }}
      style={{ left: position.x, top: position.y, width: position.width, "--card-rotate": `${position.rotate}deg`, viewTransitionName: entryHero ? "genre-selection" : undefined, ...(enter ? { "--from-x": `${enter.x}px`, "--from-y": `${enter.y}px`, "--enter-delay": `${enter.delay}ms` } : {}), ...(flipDelay !== undefined ? { "--flip-delay": `${flipDelay}ms` } : {}) } as CSSProperties}
      tabIndex={clone ? -1 : 0}
      type="button"
    >
      <PosterArt eager={eagerPoster} movie={movie} size={cardPosterSize(position.width)} />
      <span className="movie-card-copy">
        <strong>{movie.title}<small className="media-kind">{movie.mediaType === "tv" ? "Series" : "Movie"}</small></strong>
        <span>{movie.genres.slice(0, 2).join(" · ")}{runtime ? ` · ${runtime}` : ""}</span>
        <span>{movie.year} · <Star aria-hidden="true" /> {movie.rating || "New"}</span>
        <em>{movie.hook}</em>
      </span>
    </button>
  );
}

function MovieCardSkeleton({
  position,
  entryHero,
  enter,
}: {
  position: (typeof CARD_POSITIONS)[number];
  entryHero?: boolean;
  /** Dealt out from a point on the canvas: offset back to it and a stagger delay. */
  enter?: { x: number; y: number; delay: number };
}) {
  return (
    <div
      aria-hidden="true"
      className={`movie-card movie-card-skeleton ${enter ? "is-entering is-dealt" : ""}`}
      style={{ left: position.x, top: position.y, width: position.width, "--card-rotate": `${position.rotate}deg`, viewTransitionName: entryHero ? "genre-selection" : undefined, ...(enter ? { "--from-x": `${enter.x}px`, "--from-y": `${enter.y}px`, "--enter-delay": `${enter.delay}ms` } : {}) } as CSSProperties}
    >
      <span className="skeleton-poster" />
      <span className="skeleton-copy"><i /><i /><i /></span>
    </div>
  );
}

// The viewer's chosen country for "where to watch" (kept in this browser only).
const REGION_KEY = "nextwatch:region";
function savedRegion() {
  try { return window.localStorage.getItem(REGION_KEY); } catch { return null; }
}
let regionList: Promise<Array<{ code: string; name: string }>> | null = null;
function loadRegions() {
  regionList ??= fetch("/api/regions").then((response) => response.json() as Promise<{ regions?: Array<{ code: string; name: string }> }>).then((data) => data.regions ?? []).catch(() => { regionList = null; return []; });
  return regionList;
}
const countryName = (code: string) => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
};

function WatchRegionPicker({ region, onChange }: { region: string; onChange: (code: string) => void }) {
  const [regions, setRegions] = useState<Array<{ code: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    void loadRegions().then((list) => { if (alive) setRegions(list); });
    return () => { alive = false; };
  }, []);
  const options = regions.some((option) => option.code === region) ? regions : [{ code: region, name: countryName(region) }, ...regions];
  return (
    <label className="region-picker">
      <span className="sr-only">Country</span>
      <select onChange={(event) => onChange(event.target.value)} value={region}>
        {options.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
      </select>
    </label>
  );
}

function ProviderRow({ label, providers }: { label: string; providers: MovieDetail["providers"]["stream"] }) {
  if (!providers.length) return null;
  return (
    <div className="provider-row">
      <span>{label}</span>
      <div>{providers.map((provider) => (
        <span className="provider-pill" key={`${label}-${provider.id}`}>
          {provider.logoUrl ? <Image alt="" height={24} src={provider.logoUrl} unoptimized width={24} /> : null}
          {provider.name}
        </span>
      ))}</div>
    </div>
  );
}

function MovieExpansion({
  selected,
  detail,
  loading,
  error,
  origin,
  onClose,
  onFindSimilar,
  onRegionChange,
  regionLoading,
}: {
  selected: MovieCard;
  detail: MovieDetail | null;
  loading: boolean;
  error: string | null;
  origin: CardOrigin;
  onClose: () => void;
  onFindSimilar: (movie: MovieCard) => void;
  onRegionChange: (region: string) => void;
  regionLoading: boolean;
}) {
  const movie = detail ?? selected;
  const hasProviders = detail ? Object.values(detail.providers).some((group) => group.length) : false;
  const layerRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const posterAnimation = useRef<Animation | null>(null);
  const [visible, setVisible] = useState(false);
  const saved = isSaved(useSaved(), movie);
  // Trailer state lives here, not in the app, so toggling it re-renders only this panel — not the whole map.
  const [showTrailer, setShowTrailer] = useState(false);
  // Mount the YouTube player only once the panel has finished expanding, so loading it can't stutter the motion.
  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => {
    if (!showTrailer) return;
    const timer = window.setTimeout(() => setVideoReady(true), 760);
    return () => { window.clearTimeout(timer); setVideoReady(false); };
  }, [showTrailer]);
  // Switch between details and trailer with a view transition: the browser snapshots both layouts and morphs
  // between them on the GPU instead of re-laying out the panel every frame.
  const toggleTrailer = () => {
    const next = !showTrailer;
    const transitionDocument = document as ViewTransitionDocument;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof transitionDocument.startViewTransition !== "function") {
      setShowTrailer(next);
      return;
    }
    const root = document.documentElement;
    root.classList.add("trailer-transition");
    const transition = transitionDocument.startViewTransition(() => flushSync(() => setShowTrailer(next)));
    void transitionDone(transition).then(() => root.classList.remove("trailer-transition"));
  };

  const originTransform = useCallback(() => {
    const poster = posterRef.current;
    if (!poster) return "none";
    const target = poster.getBoundingClientRect();
    const scaleX = origin.width / target.width;
    const scaleY = origin.height / target.height;
    return `translate3d(${origin.left - target.left}px, ${origin.top - target.top}px, 0) scale(${scaleX}, ${scaleY})`;
  }, [origin]);

  const finishClose = useCallback(() => {
    posterAnimation.current?.cancel();
    onClose();
    afterClose.current?.();
    afterClose.current = null;
  }, [onClose]);

  const beginClose = useCallback((next?: () => void) => {
    afterClose.current = next ?? null;
    setVisible(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const poster = posterRef.current;
    if (!poster || reduced) { finishClose(); return; }
    posterAnimation.current?.cancel();
    const currentTransform = getComputedStyle(poster).transform;
    const animation = poster.animate([
      { transform: currentTransform === "none" ? "translate3d(0,0,0) scale(1)" : currentTransform, borderRadius: "0px" },
      { transform: originTransform(), borderRadius: "12px" },
    ], { duration: 540, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
    posterAnimation.current = animation;
    void animation.finished.then(finishClose, finishClose);
  }, [finishClose, originTransform]);

  useLayoutEffect(() => {
    const poster = posterRef.current;
    if (!poster) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setVisible(true);
    if (!reduced) {
      posterAnimation.current = poster.animate([
        { transform: originTransform(), borderRadius: "12px" },
        { transform: "translate3d(0,0,0) scale(1)", borderRadius: "0px" },
      ], { duration: 720, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
    }
    const frame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      posterAnimation.current?.cancel();
    };
  }, [originTransform]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        beginClose();
        return;
      }
      if (event.key !== "Tab" || !layerRef.current) return;
      const focusable = Array.from(layerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],iframe,[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [beginClose]);

  return (
    <div
      className={`movie-focus-layer ${visible ? "is-visible" : ""}`}
      onPointerDown={(event) => { if (event.target === event.currentTarget) beginClose(); }}
      ref={layerRef}
    >
      <section aria-label={`${movie.title} details`} aria-modal="true" className={`movie-focus-card ${showTrailer && detail?.trailerKey ? "is-playing" : ""}`} role="dialog">
        <button aria-label="Close title details" className="movie-focus-close" onClick={() => beginClose()} ref={closeRef} type="button"><X aria-hidden="true" /></button>
        <div className="movie-focus-visual" ref={posterRef}>
              {showTrailer && detail?.trailerKey && !videoReady ? (
                <div className="trailer-standby" aria-hidden="true"><Play /></div>
              ) : showTrailer && detail?.trailerKey ? (
                <iframe
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  aria-label={`${movie.title} trailer`}
                  src={`https://www.youtube-nocookie.com/embed/${detail.trailerKey}?autoplay=1&rel=0`}
                  title={`${movie.title} trailer`}
                />
              ) : (
                <>
                  <PosterArt movie={movie} placeholderSize="w342" priority />
                  {detail?.trailerKey ? (
                    <button aria-label={`Watch trailer: ${movie.title}`} className="poster-trailer" onClick={toggleTrailer} type="button">
                      <Play aria-hidden="true" /> Trailer
                    </button>
                  ) : null}
                </>
              )}
        </div>
        <div className="movie-focus-details">
              <p className="eyebrow"><span>Selected {movie.mediaType === "tv" ? "series" : "movie"}</span>{movie.year}</p>
              <h2>{movie.title}</h2>
              {movie.id > 0 ? (
                <div className="focus-actions">
                  <button className="similar-button" type="button" onClick={() => beginClose(() => onFindSimilar(movie))}>Find similar {movie.mediaType === "tv" ? "series" : "films"} <ArrowUpRight aria-hidden="true" /></button>
                  <button aria-pressed={saved} className={`save-button ${saved ? "is-saved" : ""}`} onClick={() => { haptic(); toggleSaved(movie); }} type="button">
                    {saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />} {saved ? "Saved" : "Save"}
                  </button>
                </div>
              ) : null}
              <div className="detail-meta">
                <span>{movie.genres.join(" · ")}</span>
                <span>{formatRuntime(movie)}</span>
                <span><Star aria-hidden="true" /> {movie.rating || "New"}</span>
              </div>
              {loading ? <div className="detail-loading"><span /><span /><span /></div> : null}
              {error ? <p className="detail-error" role="alert">{error}</p> : null}
              {detail ? (
                <>
                  <p className="overview">{detail.overview}</p>
                  <dl className="detail-facts">
                    <div><dt>{detail.mediaType === "tv" ? "First aired" : "Release"}</dt><dd>{detail.releaseDate || "TBA"}</dd></div>
                    {detail.mediaType === "tv" ? <div><dt>Seasons</dt><dd>{detail.seasons ?? "TBA"}</dd></div> : null}
                    <div><dt>Language</dt><dd>{detail.originalLanguage}</dd></div>
                  </dl>
                  <div className="dialog-actions">
                    <button disabled={!detail.trailerKey} onClick={toggleTrailer} type="button">
                      <Play aria-hidden="true" /> {detail.trailerKey ? (showTrailer ? "Back to details" : "Watch trailer") : "Trailer unavailable"}
                    </button>
                    {detail.watchUrl ? <a href={detail.watchUrl} rel="noreferrer" target="_blank">Watching options <ArrowUpRight aria-hidden="true" /></a> : null}
                  </div>
                  <section className={`providers ${regionLoading ? "is-updating" : ""}`} aria-label="Where to watch" aria-busy={regionLoading}>
                    <div className="providers-heading">
                      <span>Where to watch in{detail.region ? <WatchRegionPicker onChange={onRegionChange} region={detail.region} /> : " your country"}</span>
                      <small>Powered by JustWatch</small>
                    </div>
                    {hasProviders ? (
                      <>
                        <ProviderRow label="Stream" providers={detail.providers.stream} />
                        <ProviderRow label="Free" providers={detail.providers.free} />
                        <ProviderRow label="Rent" providers={detail.providers.rent} />
                        <ProviderRow label="Buy" providers={detail.providers.buy} />
                      </>
                    ) : <p className="no-providers">No streaming, rental or purchase options are listed in {detail.region ? countryName(detail.region) : "your country"} yet. Try another country above.</p>}
                  </section>
                </>
              ) : null}
        </div>
      </section>
    </div>
  );
}

function CreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="credits-dialog">
        <DialogHeader>
          <DialogTitle>Credits & data</DialogTitle>
          <DialogDescription>How NextWatch sources movie and series information.</DialogDescription>
        </DialogHeader>
        <Image alt="The Movie Database" className="tmdb-logo" height={32} src="/tmdb.svg" width={220} />
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p>Regional streaming availability is supplied by JustWatch through TMDB. Availability can change and should be confirmed with the provider.</p>
        <a href="https://www.themoviedb.org" rel="noreferrer" target="_blank">Visit TMDB <ArrowUpRight aria-hidden="true" /></a>
      </DialogContent>
    </Dialog>
  );
}

// Draws a line from the title in focus to each similar title. Lines fade with each ring outward
// (weaker matches); outer-orbit titles link back to the close match that led to them.
// Hovering a poster reveals why it is on the map.
function SimilarityLinks({ movies, position, width, height, layer }: {
  movies: MovieCard[];
  position: (index: number) => (typeof CARD_POSITIONS)[number];
  width: number;
  height: number;
  layer: "lines" | "labels";
}) {
  const posterCenter = (index: number) => {
    const card = position(index);
    return { x: card.x + card.width / 2, y: card.y + card.width * .75 };
  };
  const seed = movies[0];
  let outerCount = 0;
  return (
    <svg aria-hidden="true" className={layer === "lines" ? "similarity-links" : "similarity-labels"} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {movies.map((movie, index) => {
        if (!index) return null;
        const parent = movie.orbit ? movies[movie.orbit.parent] : seed;
        if (!parent) return null;
        const from = posterCenter(movie.orbit ? movie.orbit.parent : 0);
        const to = posterCenter(index);
        const key = `${movie.mediaType}-${movie.id}`;
        const ring = movie.orbit ? "outer" : Math.min(2, Math.floor((index - 1) / 5));
        const delay = movie.orbit ? 950 + (outerCount++) * 22 : 380 + (index - 1) * 45;
        if (layer === "lines") {
          return (
            <g className={`similarity-link ring-${ring}`} data-link={index} key={key} style={{ "--link-delay": `${delay}ms` } as CSSProperties}>
              <line pathLength={1} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            </g>
          );
        }
        // Centre the label on the stretch of line left visible between the two posters.
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const startGap = movie.orbit ? 120 : 185;
        const t = Math.min(.7, Math.max(.3, (startGap + distance - 110) / 2 / distance));
        const shared = movie.genres.filter((genre) => seed.genres.includes(genre)).slice(0, 2);
        const reason = movie.orbit ? `Liked by fans of ${parent.title}` : shared.length ? `Shares ${shared.join(" · ")}` : "Recommended to fans";
        return (
          <text className="similarity-label" data-link={index} dominantBaseline="middle" key={key} textAnchor="middle" x={from.x + (to.x - from.x) * t} y={from.y + (to.y - from.y) * t}>{reason}</text>
        );
      })}
    </svg>
  );
}

// While a map loads: the chosen poster waits in the centre, sonar rings pulse outward and
// placeholder posters circle it. When results land, real posters fly out from the centre.
function MapLoadingOrbit({ center }: { center: { x: number; y: number } }) {
  return (
    <div aria-hidden="true" className="loading-orbit" style={{ left: center.x, top: center.y }}>
      <span className="radar-ping" /><span className="radar-ping" /><span className="radar-ping" />
      <div className="orbit-track">
        {Array.from({ length: 7 }, (_, slot) => <span className="orbit-slot" key={slot} style={{ "--slot": slot } as CSSProperties}><i /></span>)}
      </div>
    </div>
  );
}

function LoadingCaption({ title, lines: customLines }: { title?: string; lines?: string[] }) {
  const lines = customLines ?? (title
    ? [`Asking ${title} fans what they watched next…`, "Measuring genre gravity…", "Plotting the constellation…", "Dusting off the posters…"]
    : ["Checking what everyone’s watching today…", "Measuring genre gravity…", "Plotting the constellation…", "Dusting off the posters…"]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => current + 1), 1700);
    return () => window.clearInterval(timer);
  }, []);
  const line = lines[step % lines.length];
  return (
    <div className="loading-caption" role="status">
      <span className="caption-orbit" aria-hidden="true"><i /><i /><i /></span>
      <span className="caption-line" key={line}>{line}</span>
    </div>
  );
}

// A scrollable row of every category, shown above genre/category results so you can hop between
// them without going back. Lives outside the canvas, so it keeps its scroll position while results change.
const CATEGORY_TABS: Array<{ key: string; name: string; group: string }> = [
  ...GENRES.map((genre) => ({ key: String(genre.id), name: genre.name, group: "genres" })),
  ...CATEGORIES.map((category) => ({ key: category.slug, name: category.name, group: category.group })),
];

function CategoryTabs({ activeKey, onPick }: { activeKey: string; onPick: (key: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Keep the active pill in view (centred) whenever it changes.
  useEffect(() => {
    const active = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [activeKey]);
  // A plain mouse wheel scrolls the row sideways (trackpads already do).
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    };
    row.addEventListener("wheel", wheel, { passive: false });
    return () => row.removeEventListener("wheel", wheel);
  }, []);
  return (
    <nav aria-label="Categories" className="category-tabs">
      <div className="category-tabs-row" ref={rowRef}>
        {CATEGORY_TABS.map((tab, index) => (
          <Fragment key={tab.key}>
            {index > 0 && CATEGORY_TABS[index - 1].group !== tab.group ? <span aria-hidden="true" className="category-tabs-divider" /> : null}
            <button aria-pressed={tab.key === activeKey} className={tab.key === activeKey ? "active" : ""} onClick={() => { if (tab.key !== activeKey) { haptic(); onPick(tab.key); } }} type="button">{tab.name}</button>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

function CanvasScreen({
  movies,
  selectedContentType,
  selectedGenres,
  selectedMoods,
  onChangeTaste,
  onOpenMovie,
  onOpenCredits,
  mapSeed,
  mapMode,
  entryTransition,
  loading,
  onSearchSelect,
  onHome,
  category,
  controls,
}: {
  movies: MovieCard[];
  selectedContentType: ContentType;
  selectedGenres: number[];
  selectedMoods: MoodSlug[];
  onChangeTaste: () => void;
  onOpenMovie: (movie: MovieCard, origin: CardOrigin, trigger: HTMLButtonElement) => void;
  onOpenCredits: () => void;
  mapSeed: MovieCard | null;
  mapMode: boolean;
  entryTransition: boolean;
  loading: boolean;
  onSearchSelect?: (movie: MovieCard) => void;
  onHome?: () => void;
  category?: { name: string; line: string } | null;
  controls?: ReactNode;
}) {
  const {
    layerRef,
    depthRef,
    wasDragged,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    nudge,
    changeZoom,
    glideBy,
    currentZoom,
  } = useInfiniteCanvas(mapMode);
  const savedList = useSaved();
  const savedKeys = new Set(savedList.map(savedKey));
  // Keyboard focus on a poster that's off-screen glides the map to bring it into view.
  const revealFocused = (target: EventTarget) => {
    const card = (target as HTMLElement).closest?.<HTMLElement>("button.movie-card");
    if (!card || !card.matches(":focus-visible")) return;
    const rect = card.getBoundingClientRect();
    const safe = { top: 150, bottom: window.innerHeight - 160, left: 32, right: window.innerWidth - 32 };
    if (rect.top >= safe.top && rect.bottom <= safe.bottom && rect.left >= safe.left && rect.right <= safe.right) return;
    const zoomLevel = currentZoom();
    glideBy((window.innerWidth / 2 - (rect.left + rect.width / 2)) / zoomLevel, (window.innerHeight / 2 - (rect.top + rect.height / 2)) / zoomLevel);
  };
  // The "how to move" hint only shows on the first few visits, and fades once you start exploring.
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    let seen = 0;
    try { seen = Number(window.localStorage.getItem("nextwatch:hint-seen") ?? 0); } catch { /* storage blocked */ }
    if (seen >= 3) return;
    const show = window.setTimeout(() => setShowHint(true), 0);
    const hide = window.setTimeout(() => setShowHint(false), 7000);
    try { window.localStorage.setItem("nextwatch:hint-seen", String(seen + 1)); } catch { /* storage blocked */ }
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const hide = window.setTimeout(() => setShowHint(false), 0);
    return () => window.clearTimeout(hide);
  }, [dragging]);
  usePosterProximity(layerRef, loading ? "loading" : movies.map((movie) => `${movie.mediaType}-${movie.id}`).join(","));
  const tileWidth = mapMode ? MAP_TILE : TILE_WIDTH;
  const tileHeight = mapMode ? MAP_TILE : TILE_HEIGHT;
  const center = { x: MAP_TILE / 2, y: MAP_TILE / 2 };
  // Close matches sit on three rings of five; each outer-orbit title fans out beyond the close match that led to it.
  const ringAngle = (index: number) => {
    const ring = Math.floor((index - 1) / 5);
    return ((index - 1) % 5) * Math.PI * 2 / 5 - Math.PI / 2 + ring * .52;
  };
  const mapPosition = (index: number) => {
    if (!index) return { x: center.x - 100, y: center.y - 180, width: 200, rotate: 0 };
    const orbit = movies[index]?.orbit;
    if (orbit) {
      const angle = ringAngle(orbit.parent) + (orbit.slot ? .1 : -.1);
      const radius = orbit.slot ? 1700 : 1480;
      return { x: center.x + Math.cos(angle) * radius - 64, y: center.y + Math.sin(angle) * radius - 126, width: 128, rotate: Math.cos(angle) * 2 };
    }
    const angle = ringAngle(index);
    const radius = [440, 760, 1080][Math.floor((index - 1) / 5)] ?? 1080;
    return { x: center.x + Math.cos(angle) * radius - 75, y: center.y + Math.sin(angle) * radius - 150, width: 150, rotate: Math.cos(angle) * 3 };
  };
  // Genre results are dealt from the middle of the screen. The genre canvas opens with the
  // camera at (-680, -430) and zoom 1, so the screen centre sits at this point on the tile.
  const dealFrom = (index: number) => {
    const card = CARD_POSITIONS[index % CARD_POSITIONS.length];
    const origin = typeof window === "undefined" ? { x: 1320, y: 830 } : { x: window.innerWidth / 2 + 680, y: window.innerHeight / 2 + 430 };
    return { x: origin.x - (card.x + card.width / 2), y: origin.y - (card.y + card.width * .75), delay: index * 25 };
  };
  const genreName = category?.name ?? GENRES.find((genre) => genre.id === selectedGenres[0])?.name;
  const genreLines = category
    ? [category.line, "Shuffling the deck…", "Dealing sixteen picks…"]
    : genreName ? [GENRE_LOADING_LINES[selectedGenres[0]] ?? `Rounding up ${genreName.toLowerCase()}…`, "Shuffling the deck…", "Dealing sixteen picks…"] : undefined;
  // Offset from a card back to the map centre, for the fly-out entrance.
  const burstFrom = (index: number) => {
    const card = mapPosition(index);
    const seed = mapPosition(0);
    const outerIndex = movies[index]?.orbit ? index - movies.findIndex((movie) => movie.orbit) : -1;
    return {
      x: seed.x + seed.width / 2 - (card.x + card.width / 2),
      y: seed.y + seed.width * .75 - (card.y + card.width * .75),
      delay: outerIndex >= 0 ? 520 + outerIndex * 18 : 60 + (index - 1) * 40,
    };
  };
  // Light up the hovered title's line straight in the DOM so hovering never re-renders the canvas.
  // Hovering the centre title lights every line at once.
  const highlightLink = (card: HTMLElement, index: number, active: boolean) => {
    const tile = card.parentElement;
    if (!tile) return;
    if (index === 0) tile.querySelector(".similarity-links")?.classList.toggle("show-all", active);
    else tile.querySelectorAll(`[data-link="${index}"]`).forEach((element) => element.classList.toggle("is-active", active));
  };
  const genreSummary = selectedGenres.map((id) => GENRES.find((genre) => genre.id === id)?.name).filter(Boolean).slice(0, 2).join(" + ");
  const moodSummary = selectedMoods.length ? selectedMoods.map((slug) => MOODS.find((mood) => mood.slug === slug)?.name).filter(Boolean).slice(0, 2).join(" + ") : "Open to anything";

  return (
    <main className={`canvas-screen ${mapMode ? "similarity-map" : ""}`}>
      <h1 className="sr-only">{mapSeed ? `Movies and series similar to ${mapSeed.title}` : category?.name ? `${category.name} picks` : genreName ? `${genreName} picks` : "NextWatch"}</h1>
      {onSearchSelect ? (
        <SiteHeader link={{ href: "/browse", label: "Browse categories", icon: LayoutGrid }} onHome={onHome} onSearchSelect={onSearchSelect} />
      ) : (
        <header className="canvas-header">
          <HomeLogo />
          <div className="taste-summary">{mapSeed ? <span>THE WORLD AROUND {mapSeed.title}</span> : <><span>{category?.name ?? genreSummary}</span><i /> <span>{moodSummary}</span><i /> <span>{selectedContentType === "movie" ? "Movies" : selectedContentType === "tv" ? "Series" : "Movies + Series"}</span></>}</div>
          <div className="header-actions">
            <SavedButton />
            <button onClick={onChangeTaste} type="button"><LayoutGrid aria-hidden="true" /> All categories</button>
          </div>
        </header>
      )}
      {/* On phones this row holds the bottom pills and a round "center map" button side by side;
          on wider screens it's invisible (display: contents) and the zoom bar has its own corner. */}
      <div className="map-controls-row">
        {controls}
        {mapSeed ? <button aria-label="Center map" className="center-map-phone" onClick={() => changeZoom(0)} title="Center map" type="button"><LocateFixed aria-hidden="true" /></button> : null}
      </div>
      <div
        aria-label="Infinite movie and series recommendation canvas. Drag or use arrow keys to explore."
        className={`canvas-stage ${dragging ? "is-dragging" : ""}`}
        onFocusCapture={(event) => revealFocused(event.target)}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest("button,a,input")) return;
          const step = event.shiftKey ? 180 : 80;
          if (["ArrowLeft", "a", "A"].includes(event.key)) nudge(step, 0);
          else if (["ArrowRight", "d", "D"].includes(event.key)) nudge(-step, 0);
          else if (["ArrowUp", "w", "W"].includes(event.key)) nudge(0, step);
          else if (["ArrowDown", "s", "S"].includes(event.key)) nudge(0, -step);
          else return;
          event.preventDefault();
        }}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="region"
        tabIndex={0}
      >
        <div aria-hidden="true" className="canvas-depth" ref={depthRef} />
        <div className="canvas-layer" ref={layerRef} style={{ width: tileWidth * 3, height: tileHeight * 3 }}>
          {TILE_OFFSETS.flatMap((tileY) => TILE_OFFSETS.map((tileX) => {
            const tileIndex = tileY * 3 + tileX;
            return (
              <div
                aria-hidden={tileIndex !== 4 || undefined}
                className="canvas-tile"
                key={`${tileX}-${tileY}`}
                style={{ left: tileX * tileWidth, top: tileY * tileHeight, width: tileWidth, height: tileHeight }}
              >
                {mapMode ? <div className={`map-orbits ${loading ? "is-scanning" : ""}`} aria-hidden="true"><span /><span /><span /><span /><span /></div> : null}
                {loading && mapMode ? <>
                  {tileIndex === 4 ? <MapLoadingOrbit center={center} /> : null}
                  {movies[0] ? (
                    <MovieCardButton clone={tileIndex !== 4} className="is-pending-seed" key={`${tileIndex}-${movies[0].mediaType}-${movies[0].id}`} movie={movies[0]} onOpen={onOpenMovie} position={mapPosition(0)} wasDragged={wasDragged} />
                  ) : <MovieCardSkeleton key={`${tileIndex}-skeleton-seed`} position={mapPosition(0)} />}
                </> : loading ? CARD_POSITIONS.map((position, index) => (
                  <MovieCardSkeleton
                    enter={tileIndex === 4 && !(entryTransition && index === 0) ? dealFrom(index) : undefined}
                    entryHero={entryTransition && tileIndex === 4 && index === 0}
                    key={`${tileIndex}-skeleton-${index}`}
                    position={position}
                  />
                )) : <>
                  {mapSeed ? <SimilarityLinks layer="lines" movies={movies} position={mapPosition} width={tileWidth} height={tileHeight} /> : null}
                  {movies.map((movie, index) => (
                    <MovieCardButton
                      className={movie.orbit ? "is-outer" : ""}
                      clone={tileIndex !== 4}
                      enter={mapMode && index && tileIndex === 4 ? burstFrom(index) : undefined}
                      entryHero={entryTransition && tileIndex === 4 && index === 0}
                      eagerPoster={!mapMode && tileIndex === 4}
                      saved={savedKeys.has(titleKey(movie))}
                      flipDelay={!mapMode && tileIndex === 4 ? index * 55 : undefined}
                      key={`${tileIndex}-${movie.mediaType}-${movie.id}`}
                      movie={movie}
                      onOpen={onOpenMovie}
                      onHighlight={mapSeed ? (card, active) => highlightLink(card, index, active) : undefined}
                      position={mapMode ? mapPosition(index) : CARD_POSITIONS[index % CARD_POSITIONS.length]}
                      wasDragged={wasDragged}
                    />
                  ))}
                  {mapSeed ? <SimilarityLinks layer="labels" movies={movies} position={mapPosition} width={tileWidth} height={tileHeight} /> : null}
                </>}
              </div>
            );
          }))}
        </div>
      </div>

      {mapSeed ? <div className="map-view-tools" aria-label="Map view controls"><button type="button" aria-label="Zoom out" onClick={() => changeZoom(-.15)}>−</button><button type="button" onClick={() => changeZoom(0)}>Center map</button><button type="button" aria-label="Zoom in" onClick={() => changeZoom(.15)}>+</button></div> : null}
      {loading ? <LoadingCaption lines={mapMode ? undefined : genreLines} title={movies[0]?.title} /> : null}
      <div aria-hidden={!showHint} className={`move-hint ${showHint ? "is-shown" : ""}`}><Move aria-hidden="true" /><span className="hint-touch">{mapMode ? "Drag to explore · pinch to zoom" : "Drag to explore"}</span><span className="hint-pointer">{mapMode ? "Drag or scroll to explore · pinch to zoom" : "Drag or scroll to explore"}</span></div>
      <button aria-label="Open credits" className="credits-button" onClick={onOpenCredits} type="button"><Info aria-hidden="true" /> Credits</button>
    </main>
  );
}

const NO_MOODS: MoodSlug[] = [];
const parseMoods = (value: unknown): MoodSlug[] => Array.isArray(value)
  ? value.filter((slug): slug is MoodSlug => MOODS.some((mood) => mood.slug === slug)).slice(0, 2)
  : NO_MOODS;
const parseContentType = (value: unknown): ContentType => value === "movie" || value === "tv" ? value : "both";

export default function ReelspaceApp({ view = "home", initialPick = null }: {
  view?: View;
  /** Browse page: the category or genre in the shared link (/browse?category=anime), opened straight away. */
  initialPick?: string | null;
}) {
  const startPick = view === "browse" ? initialPick : null;
  const [phase, setPhase] = useState<Phase>(view === "home" || startPick ? "canvas" : "setup");
  // Today's trending rank of every trending title we've mapped (#1 is the default homepage).
  const [trendingRanks, setTrendingRanks] = useState<Record<string, number>>({});
  // A map on its way: the canvas shows the loading constellation (with this poster at the centre, when known).
  const [pending, setPending] = useState<{ seed: MovieCard | null } | null>(null);
  // Mood and "movies / series" stick for this tab (a refresh or a trip to the map keeps them).
  const [contentType, setContentType] = useSessionPref<ContentType>("nextwatch:content-type", parseContentType, "both");
  const [selectedGenres, setSelectedGenres] = useState<number[]>(startPick && isGenrePick(startPick) ? [Number(startPick)] : [53]);
  const [selectedMoods, setSelectedMoods] = useSessionPref<MoodSlug[]>("nextwatch:moods", parseMoods, NO_MOODS);
  // A curated category (Anime, Hidden gems…) when one is picked instead of a plain genre.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(startPick && !isGenrePick(startPick) ? startPick : null);
  const [movies, setMovies] = useState<MovieCard[]>([]);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<MovieCard | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<CardOrigin | null>(null);
  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  useEffect(() => {
    const open = () => setSavedOpen(true);
    window.addEventListener(OPEN_SAVED_EVENT, open);
    return () => window.removeEventListener(OPEN_SAVED_EVENT, open);
  }, []);
  const [mapSeed, setMapSeed] = useState<MovieCard | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(Boolean(startPick));
  const [canvasEntry, setCanvasEntry] = useState(false);
  const mapRequest = useRef<AbortController | null>(null);
  const movieTrigger = useRef<HTMLButtonElement | null>(null);
  const [mapHistory, setMapHistory] = useState<Array<{ seed: MovieCard | null; movies: MovieCard[]; configured: boolean; phase: Phase }>>([]);

  useEffect(() => () => mapRequest.current?.abort(), []);

  // Keep the address bar pointing at the title in focus so a refresh or shared link reopens it.
  // Each map you move to gets its own browser-history entry (numbered `nwIndex`), so the browser's Back
  // button and the phone's swipe-back step through maps instead of leaving the site. The framework's
  // own history state is copied along so its router keeps working.
  const historyIndex = useRef(0);
  const historyBase = useRef(0);
  const syncMapUrl = useCallback((seed: MovieCard | null, trending: boolean, push = false) => {
    if (view !== "home") return;
    const url = !seed || trending || seed.id < 0 ? "/" : mapHref(seed);
    if (push) {
      historyIndex.current += 1;
      window.history.pushState({ ...window.history.state, nwIndex: historyIndex.current }, "", url);
    } else {
      window.history.replaceState({ ...window.history.state, nwIndex: historyIndex.current }, "", url);
    }
  }, [view]);

  const showMap = useCallback(async (url: string, label: string, options: { record: boolean; trending?: boolean; seed?: MovieCard; fromHistory?: boolean }) => {
    mapRequest.current?.abort();
    const controller = new AbortController();
    mapRequest.current = controller;
    setMapBusy(options.record);
    setPending({ seed: options.seed ?? null });
    setMapError(null);
    setSelectedMovie(null);
    setSelectedOrigin(null);
    setDetail(null);
    try {
      // A short floor keeps the hand-off readable when the answer is already cached.
      const [response] = await Promise.all([
        fetch(url, { signal: controller.signal }),
        new Promise((resolve) => window.setTimeout(resolve, options.seed ? 650 : 0)),
      ]);
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Please sign in again to explore title maps.");
      const data = await response.json() as MapPayload;
      if (!response.ok) throw new Error(data.error ?? "This map is unavailable.");
      if (!data.movies?.length) throw new Error(`No related titles are available for ${label} yet. Try another pick.`);
      if (controller.signal.aborted) return;
      if (options.record) setMapHistory((history) => [...history, { seed: mapSeed, movies, configured, phase }].slice(-20));
      if (options.trending) setTrendingRanks((ranks) => ({ ...ranks, [titleKey(data.seed)]: data.rank ?? 1 }));
      setMapSeed(data.seed);
      setMovies([data.seed, ...data.movies, ...(data.outer ?? [])]);
      setPending(null);
      setConfigured(data.configured ?? true);
      setRecommendationsLoading(false);
      setPhase("canvas");
      syncMapUrl(data.seed, Boolean(options.trending) && (data.rank ?? 1) === 1, options.record && !options.fromHistory);
    } catch (error) {
      if (!controller.signal.aborted) {
        setPending(null);
        setMapError(error instanceof Error ? error.message : "Unable to open this map. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) setMapBusy(false);
    }
  }, [configured, mapSeed, movies, phase, syncMapUrl]);

  const showTrending = useCallback((record: boolean) => showMap("/api/trending", "today’s top title", { record, trending: true }), [showMap]);
  // The logo on the homepage: back to today's #1 trending map (Back still returns to where you were).
  const goHome = () => {
    if (pending || mapBusy) return;
    if (mapSeed && trendingRanks[titleKey(mapSeed)] === 1) return;
    haptic();
    void showTrending(Boolean(mapSeed));
  };
  // Jump to a random title from today's top 20 trending (never the one on screen).
  const shuffleTrending = () => {
    haptic();
    const exclude = mapSeed ? `&exclude=${encodeURIComponent(titleKey(mapSeed))}` : "";
    void showMap(`/api/trending?shuffle=1${exclude}`, "another trending title", { record: true, trending: true });
  };

  // The similarity map lives on the homepage; from the browse page, searching takes you there.
  const exploreMap = (movie: MovieCard) => {
    haptic();
    if (view === "browse") { window.location.assign(mapHref(movie)); return; }
    void showMap(`/api/movies/${movie.id}/map?type=${movie.mediaType}`, movie.title, { record: true, seed: movie });
  };

  // Open the homepage on a shared title link, or on today's #1 trending title.
  const showMapRef = useRef(showMap);
  useEffect(() => { showMapRef.current = showMap; }, [showMap]);
  useEffect(() => {
    if (view !== "home") return;
    const startIndex = typeof window.history.state?.nwIndex === "number" ? window.history.state.nwIndex as number : 0;
    historyIndex.current = startIndex;
    historyBase.current = startIndex;
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id"));
    const type = params.get("type") === "tv" ? "tv" : "movie";
    if (Number.isSafeInteger(id) && id > 0) void showMapRef.current(`/api/movies/${id}/map?type=${type}`, "this title", { record: false });
    else void showMapRef.current("/api/trending", "today’s top title", { record: false, trending: true });
    return () => mapRequest.current?.abort();
  }, [view]);

  // Restore the map you were on at history position `index` (instant: it's still in memory).
  const restoreMapAt = (index: number) => {
    const entry = mapHistory[index - historyBase.current];
    if (!entry) return false;
    mapRequest.current?.abort();
    setPending(null); setMapBusy(false);
    setMapSeed(entry.seed); setMovies(entry.movies); setConfigured(entry.configured); setPhase(entry.phase);
    setMapHistory((history) => history.slice(0, index - historyBase.current)); setMapError(null);
    return true;
  };
  const backMap = () => {
    if (historyIndex.current > historyBase.current) window.history.back();
    else if (mapHistory.length) restoreMapAt(historyBase.current + mapHistory.length - 1);
  };
  // Browser Back / Forward (and swipe-back on phones).
  const onHistoryRef = useRef<(event: PopStateEvent) => void>(() => undefined);
  useEffect(() => {
    onHistoryRef.current = (event: PopStateEvent) => {
      if (view !== "home") return;
      const target = typeof event.state?.nwIndex === "number" ? event.state.nwIndex as number : 0;
      const goingBack = target < historyIndex.current;
      historyIndex.current = target;
      if (goingBack && restoreMapAt(target)) return;
      // Not in memory (Forward, or history from before a reload): load the map the address points to.
      const params = new URLSearchParams(window.location.search);
      const id = Number(params.get("id"));
      const type = params.get("type") === "tv" ? "tv" : "movie";
      if (goingBack) setMapHistory((history) => history.slice(0, Math.max(0, target - historyBase.current)));
      const options = { record: !goingBack, fromHistory: true };
      if (Number.isSafeInteger(id) && id > 0) void showMap(`/api/movies/${id}/map?type=${type}`, "this title", options);
      else void showMap("/api/trending", "today’s top title", { ...options, trending: true });
    };
  });
  useEffect(() => {
    const listener = (event: PopStateEvent) => onHistoryRef.current(event);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  // Nothing on the homepage yet and the load failed: show the full-screen error instead of the loader.
  const homeFailed = view === "home" && !mapSeed && !pending && Boolean(mapError);
  const sharedHomeTitle = homeFailed && Number(new URLSearchParams(window.location.search).get("id")) > 0;
  const retryHome = () => {
    setMapError(null);
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id"));
    if (Number.isSafeInteger(id) && id > 0) void showMap(`/api/movies/${id}/map?type=${params.get("type") === "tv" ? "tv" : "movie"}`, "this title", { record: false });
    else void showTrending(false);
  };
  const trendingRank = mapSeed ? trendingRanks[titleKey(mapSeed)] : undefined;
  const isTrending = trendingRank === 1;

  // Only the latest category pick may update the canvas (quick pill taps can finish out of order).
  const recommendationRequest = useRef(0);
  const loadRecommendations = useCallback(async (preferences?: { genres?: number[]; category?: string | null; moods: MoodSlug[]; contentType?: ContentType }, trigger?: HTMLButtonElement) => {
    const genres = preferences?.genres ?? selectedGenres;
    const category = preferences?.category ?? null;
    const requestId = ++recommendationRequest.current;
    const moods = preferences?.moods ?? selectedMoods;
    const recommendationType = preferences?.contentType ?? contentType;
    setError(null);
    const openCanvas = () => {
      setMovies([]);
      setMapSeed(null);
      setMapHistory([]);
      setCanvasEntry(Boolean(trigger));
      setRecommendationsLoading(true);
      setPhase("canvas");
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDocument = document as ViewTransitionDocument;
    if (trigger && !reducedMotion && typeof transitionDocument.startViewTransition === "function") {
      trigger.style.viewTransitionName = "genre-selection";
      const transition = transitionDocument.startViewTransition(() => flushSync(openCanvas));
      void transitionDone(transition).then(() => {
        trigger.style.removeProperty("view-transition-name");
        setCanvasEntry(false);
      });
    } else {
      openCanvas();
      window.setTimeout(() => setCanvasEntry(false), reducedMotion ? 0 : 700);
    }
    try {
      const params = new URLSearchParams(category
        ? { category, moods: moods.join(","), type: recommendationType }
        : { genres: genres.join(","), moods: moods.join(","), type: recommendationType });
      // Same sequence every time: the full deal plays, posters load, then the cards turn over —
      // whether the answer was cached (fast) or fetched fresh (slower).
      const dealDone = new Promise((resolve) => window.setTimeout(resolve, DEAL_MS));
      const response = await fetch(`/api/recommendations?${params}`);
      const data = await response.json() as { error?: string; movies?: MovieCard[]; configured?: boolean };
      if (requestId !== recommendationRequest.current) return { count: 0, source: "superseded" };
      if (!response.ok || !data.movies?.length) throw new Error(data.error ?? "No titles matched this combination. Try widening your taste.");
      await Promise.all([dealDone, preloadPosters(data.movies, cardPosterSize(CARD_POSITIONS[0].width))]);
      if (requestId !== recommendationRequest.current) return { count: 0, source: "superseded" };
      setMovies(data.movies);
      setConfigured(Boolean(data.configured));
      setRecommendationsLoading(false);
      return { count: data.movies.length, source: data.configured ? "TMDB" : "preview" };
    } catch (loadError) {
      if (requestId !== recommendationRequest.current) return { count: 0, source: "superseded" };
      setError(loadError instanceof Error ? loadError.message : "Recommendations are temporarily unavailable.");
      setRecommendationsLoading(false);
      setPhase("setup");
      throw loadError;
    }
  }, [contentType, selectedGenres, selectedMoods]);

  const openMovie = useCallback(async (movie: MovieCard, origin?: CardOrigin, trigger?: HTMLButtonElement) => {
    const fallbackWidth = Math.min(220, window.innerWidth * .38);
    setSelectedOrigin(origin ?? {
      left: window.innerWidth / 2 - fallbackWidth / 2,
      top: window.innerHeight / 2 - fallbackWidth * .75,
      width: fallbackWidth,
      height: fallbackWidth * 1.5,
    });
    movieTrigger.current = trigger ?? null;
    setSelectedMovie(movie);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const region = savedRegion();
      const response = await fetch(`/api/movies/${movie.id}?type=${movie.mediaType}${region ? `&region=${region}` : ""}`);
      const data = await response.json() as { error?: string; movie?: MovieDetail };
      if (!response.ok || !data.movie) throw new Error(data.error ?? "Title details are unavailable.");
      setDetail(data.movie);
      return { id: movie.id, title: movie.title, detailsOpen: true };
    } catch (detailLoadError) {
      setDetailError(detailLoadError instanceof Error ? detailLoadError.message : "Title details are temporarily unavailable.");
      throw detailLoadError;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Switch "where to watch" to another country, remember it, and refresh the open title's options.
  const [regionLoading, setRegionLoading] = useState(false);
  const changeRegion = async (region: string) => {
    try { window.localStorage.setItem(REGION_KEY, region); } catch { /* private mode: still update this view */ }
    const movie = selectedMovie;
    if (!movie) return;
    setRegionLoading(true);
    try {
      const response = await fetch(`/api/movies/${movie.id}?type=${movie.mediaType}&region=${region}`);
      const data = await response.json() as { movie?: MovieDetail };
      if (data.movie) setDetail((current) => current && current.id === data.movie?.id ? data.movie : current);
    } finally {
      setRegionLoading(false);
    }
  };

  const closeMovie = useCallback(() => {
    setSelectedMovie(null);
    setSelectedOrigin(null);
    setDetail(null);
    requestAnimationFrame(() => movieTrigger.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const validGenreIds = new Set<number>(GENRES.map((genre) => genre.id));
    const validMoods = new Set(MOODS.map((mood) => mood.slug));
    const report = () => undefined;
    try {
      void Promise.resolve(context.registerTool({
        name: "explore_movie_recommendations",
        title: "Explore recommendations",
        description: "Set one or more genres, optional moods, and a content type, then open an international movie and series recommendation canvas.",
        inputSchema: {
          type: "object",
          properties: {
            genres: { type: "array", items: { type: "integer", enum: [...validGenreIds] }, minItems: 1, uniqueItems: true },
            moods: { type: "array", items: { type: "string", enum: [...validMoods] }, maxItems: 2, uniqueItems: true },
            contentType: { type: "string", enum: ["both", "movie", "tv"] },
          },
          required: ["genres"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const value = input as { genres?: unknown; moods?: unknown; contentType?: unknown };
          const genres = Array.isArray(value.genres) ? value.genres.filter((id): id is number => typeof id === "number" && validGenreIds.has(id)) : [];
          const moods = Array.isArray(value.moods) ? value.moods.filter((slug): slug is MoodSlug => typeof slug === "string" && validMoods.has(slug as MoodSlug)) : [];
          const nextContentType: ContentType = value.contentType === "movie" || value.contentType === "tv" ? value.contentType : "both";
          if (!genres.length) throw new Error("Provide at least one valid genre.");
          setSelectedGenres(genres); setSelectedMoods(moods); setContentType(nextContentType); setSelectedCategory(null);
          return loadRecommendations({ genres, moods, contentType: nextContentType });
        },
      }, { signal: lifecycle.signal })).catch(report);

      void Promise.resolve(context.registerTool({
        name: "open_movie_details",
        title: "Open title details",
        description: "Expand a movie or series card already present on the recommendation canvas.",
        inputSchema: { type: "object", properties: { movieId: { type: "integer" }, mediaType: { type: "string", enum: ["movie", "tv"] } }, required: ["movieId"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input) {
          const value = input as { movieId?: unknown; mediaType?: unknown };
          const id = value.movieId;
          if (typeof id !== "number") throw new Error("movieId must be a number.");
          const movie = movies.find((item) => item.id === id && (value.mediaType !== "movie" && value.mediaType !== "tv" || item.mediaType === value.mediaType));
          if (!movie) throw new Error("That title is not on the current canvas.");
          return openMovie(movie);
        },
      }, { signal: lifecycle.signal })).catch(report);
    } catch {
      return () => lifecycle.abort();
    }
    return () => lifecycle.abort();
  }, [loadRecommendations, movies, openMovie, setContentType, setSelectedMoods]);

  // Browse: open a category or genre wall and keep the address bar on it (/browse?category=anime), so the
  // link can be shared and Back returns to the grid. Switching pills replaces the entry instead of piling
  // one up per tap.
  const openBrowse = (pick: string, trigger?: HTMLButtonElement, history: "push" | "replace" | "none" = "push") => {
    const genre = isGenrePick(pick);
    if (genre) setSelectedGenres([Number(pick)]);
    setSelectedCategory(genre ? null : pick);
    if (view === "browse" && history !== "none") {
      const url = browseHref(pick);
      if (history === "push") window.history.pushState({ ...window.history.state }, "", url);
      else window.history.replaceState({ ...window.history.state }, "", url);
    }
    void loadRecommendations(genre
      ? { genres: [Number(pick)], moods: selectedMoods, contentType }
      : { category: pick, moods: selectedMoods, contentType }, trigger).catch(() => undefined);
  };
  const showAllCategories = () => {
    if (view === "browse" && window.location.search) window.history.pushState({ ...window.history.state }, "", "/browse");
    setPhase("setup"); setMapSeed(null); setMapHistory([]); setMapError(null);
  };
  const openBrowseRef = useRef(openBrowse);
  useEffect(() => { openBrowseRef.current = openBrowse; });
  // A shared category link opens that wall right away; Back / Forward move between the grid and walls.
  useEffect(() => {
    if (view !== "browse") return;
    if (startPick) openBrowseRef.current(startPick, undefined, "none");
    const onPopState = () => {
      const pick = parseBrowsePick(new URLSearchParams(window.location.search));
      if (pick) openBrowseRef.current(pick, undefined, "none");
      else { recommendationRequest.current += 1; setPhase("setup"); setMapError(null); }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view, startPick]);

  // The tab title follows what's on screen, so tabs, history and bookmarks read well.
  const browseName = view === "browse" && phase === "canvas" && !mapSeed ? browsePickName(selectedCategory ?? String(selectedGenres[0])) : null;
  useEffect(() => {
    if (view === "home") {
      if (mapSeed && trendingRanks[titleKey(mapSeed)] !== 1) document.title = `Titles like ${mapSeed.title} — NextWatch`;
      else document.title = "NextWatch — Movies and series for right now";
    } else {
      document.title = browseName ? `${browseName} to watch — NextWatch` : "Browse categories — NextWatch";
    }
  }, [view, mapSeed, trendingRanks, browseName]);

  // Fixed-position controls, rendered inside the canvas screen right after its top bar so keyboard users
  // meet them before the 46 posters (they're fixed on screen, so only the tab order changes).
  const canvasControls = (
    <>
      {phase === "canvas" ? <nav className="discovery-tools" aria-label="Title discovery">
        {mapHistory.length ? <button disabled={mapBusy} onClick={backMap} title={`Back to ${mapHistory.at(-1)?.seed?.title ?? "your picks"}`} type="button"><span className="discovery-label">← Back<span className="wide-only">{mapHistory.at(-1)?.seed ? ` to ${mapHistory.at(-1)?.seed?.title}` : " to your picks"}</span></span></button> : null}
        {view === "home" && mapSeed && !isTrending && !pending ? <button disabled={mapBusy} onClick={() => { haptic(); void showTrending(true); }} type="button"><TrendingUp aria-hidden="true" /> <span><span className="wide-only">What’s trending</span><span className="narrow-only">Trending</span></span></button> : null}
        {view === "home" && mapSeed && configured && !pending ? <button aria-label="Shuffle to another trending title" className="shuffle-button" disabled={mapBusy} onClick={shuffleTrending} title="Another title from today’s top 20" type="button"><Shuffle aria-hidden="true" /> <span>Shuffle<span className="wide-only"> trending</span></span></button> : null}
      </nav> : null}
    </>
  );

  return (
    <>
      {phase === "setup" ? (
        <TasteSetup
          contentType={contentType}
          setContentType={setContentType}
          error={error}
          onSearch={exploreMap}
          onSelectGenre={(genreId, trigger) => openBrowse(String(genreId), trigger)}
          selectedCategory={selectedCategory}
          onSelectCategory={(slug, trigger) => openBrowse(slug, trigger)}
          selectedGenres={selectedGenres}
          selectedMoods={selectedMoods}
          setSelectedMoods={setSelectedMoods}
        />
      ) : null}
      {/* Outside the canvas screen so it keeps its scroll position while results change. */}
      {view === "browse" && phase === "canvas" && !mapSeed ? (
        <CategoryTabs
          activeKey={selectedCategory ?? String(selectedGenres[0])}
          onPick={(key) => openBrowse(key, undefined, "replace")}
        />
      ) : null}
      {homeFailed && mapError ? (
        <MapUnavailable
          detail={mapError}
          onRetry={retryHome}
          onSearchSelect={exploreMap}
          onTrending={() => { setMapError(null); void showTrending(false); }}
          sharedTitle={sharedHomeTitle}
        />
      ) : phase === "canvas" ? (
        <CanvasScreen
          // Prefixed so it can never collide with the details panel's key (same title id) — siblings
          // sharing a key made React lose track of the map and stack fresh copies on every update.
          key={`map:${pending ? (pending.seed ? titleKey(pending.seed) : "loading") : mapSeed ? titleKey(mapSeed) : view === "home" ? "loading" : `taste:${selectedCategory ?? selectedGenres.join("-")}`}`}
          mapSeed={pending ? pending.seed : mapSeed}
          mapMode={Boolean(mapSeed) || view === "home"}
          onSearchSelect={view === "home" ? exploreMap : undefined}
          onHome={view === "home" ? goHome : undefined}
          entryTransition={canvasEntry}
          loading={Boolean(pending) || recommendationsLoading || (view === "home" && !mapSeed)}
          movies={pending ? (pending.seed ? [pending.seed] : []) : movies}
          onChangeTaste={showAllCategories}
          onOpenCredits={() => setCreditsOpen(true)}
          onOpenMovie={(movie, origin, trigger) => { void openMovie(movie, origin, trigger).catch(() => undefined); }}
          selectedGenres={selectedGenres}
          selectedMoods={selectedMoods}
          selectedContentType={findCategory(selectedCategory)?.media ?? contentType}
          category={findCategory(selectedCategory) ?? null}
          controls={canvasControls}
        />
      ) : null}

      {mapSeed && phase === "canvas" && !pending ? <aside className={`map-legend ${view === "home" ? "home-legend" : ""}`}>
        {trendingRank ? <strong className="trending-kicker"><TrendingUp aria-hidden="true" /> {configured ? `#${trendingRank} trending today` : "Featured preview"}</strong> : <strong>Similarity map</strong>}
        <span>Closer to {mapSeed.title} = a stronger match.</span>
        <small>Ranked by TMDB picks & shared genres. Open a poster to see its map.</small>
      </aside> : null}
      {mapError && !homeFailed ? <div className="map-error" role="alert"><span>{mapError}</span>{view === "home"
        ? <button type="button" onClick={() => { setMapError(null); void showTrending(Boolean(mapSeed)); }}>Show trending</button>
        : <button type="button" onClick={() => { setMapError(null); setPhase("setup"); window.scrollTo(0, 0); }}>Search again</button>}<button type="button" aria-label="Dismiss map error" onClick={() => setMapError(null)}>×</button></div> : null}

      {selectedMovie && selectedOrigin ? (
        <MovieExpansion
          key={`details:${titleKey(selectedMovie)}`}
          onFindSimilar={exploreMap}
          onRegionChange={(region) => { void changeRegion(region); }}
          regionLoading={regionLoading}
          detail={detail}
          error={detailError}
          loading={detailLoading}
          onClose={closeMovie}
          origin={selectedOrigin}
          selected={selectedMovie}
        />
      ) : null}
      <CreditsDialog onOpenChange={setCreditsOpen} open={creditsOpen} />
      <SavedDialog onOpenChange={setSavedOpen} onPick={(movie) => { setSavedOpen(false); exploreMap(movie); }} open={savedOpen} />
    </>
  );
}
