// API client for the Daily Dispatch backend (Lambda Function URL + API key).
// The base URL and key are injected at build time via EXPO_PUBLIC_* env vars,
// which are inlined into the JS bundle. The key is a personal single-user key
// the owner already holds; EXPO_PUBLIC_ is acceptable for that (see note).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Cat } from "./theme";

export type Story = {
  cat: Cat;
  headline: string;
  source: string;
  url: string;
  summary: string[];
  fullText: string;
  image: string;
  overview?: { label: string; text: string }[];
  linked?: {
    url: string;
    title: string;
    desc: string;
    image: string;
    fullText: string;
  } | null;
};
export type EditionMeta = {
  id: string; // YYYY-MM-DD
  date: string; // "September 21"
  weekday: string;
  full: string;
  count: number;
  lead: string;
  hero?: string;
  inProgress?: boolean;
};
export type Edition = {
  id: string;
  date: string;
  weekday: string;
  full: string;
  hero?: string;
  inProgress?: boolean;
  stories: Story[];
};

const BASE = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
const KEY = process.env.EXPO_PUBLIC_API_KEY || "";

const CACHE_EDITIONS = "dd.editions";
const cacheEdition = (id: string) => `dd.edition.${id}`;

async function req(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": KEY },
    cache: "no-store", // Today must never come from an HTTP cache
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// List editions, newest first. Falls back to the last cached list offline.
export async function listEditions(): Promise<EditionMeta[]> {
  try {
    const data = await req("/editions");
    const editions: EditionMeta[] = data.editions || [];
    await AsyncStorage.setItem(CACHE_EDITIONS, JSON.stringify(editions));
    return editions;
  } catch (e) {
    const cached = await AsyncStorage.getItem(CACHE_EDITIONS);
    if (cached) return JSON.parse(cached);
    throw e;
  }
}

// One edition with stories. Cached per-id so reading works offline (Boox).
export async function getEdition(id: string): Promise<Edition> {
  try {
    const data = await req(`/editions/${id}`);
    await AsyncStorage.setItem(cacheEdition(id), JSON.stringify(data));
    return data;
  } catch (e) {
    const cached = await AsyncStorage.getItem(cacheEdition(id));
    if (cached) return JSON.parse(cached);
    throw e;
  }
}

export const apiConfigured = () => Boolean(BASE && KEY);
