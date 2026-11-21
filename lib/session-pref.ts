"use client";

import { useCallback, useSyncExternalStore } from "react";

// Small preferences kept for this browser tab (sessionStorage), such as the chosen mood or
// "movies / series". Read through useSyncExternalStore so the server render and the first client render
// agree (both use the fallback), then the stored value takes over without a setState-in-effect.

const EVENT = "nextwatch:session-pref";
const memory = new Map<string, string>(); // used when sessionStorage is blocked
const cache = new Map<string, { raw: string | null; value: unknown }>();

function readRaw(key: string) {
  try { return window.sessionStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useSessionPref<T>(key: string, parse: (value: unknown) => T, fallback: T) {
  const read = useCallback(() => {
    const raw = readRaw(key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value as T;
    let decoded: unknown = raw;
    if (raw !== null) { try { decoded = JSON.parse(raw); } catch { /* older plain-string value */ } }
    const value = raw === null ? fallback : parse(decoded);
    cache.set(key, { raw, value });
    return value;
  }, [key, parse, fallback]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback((next: T | ((previous: T) => T)) => {
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(read()) : next;
    const raw = JSON.stringify(resolved);
    memory.set(key, raw);
    try { window.sessionStorage.setItem(key, raw); } catch { /* blocked: memory keeps it for this page */ }
    window.dispatchEvent(new Event(EVENT));
  }, [key, read]);
  return [value, set] as const;
}
