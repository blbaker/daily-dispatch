// Minimal route table: method + anchored regex, capture groups become params.
import { Deps } from "./deps";
import { HttpEvent, HttpResult } from "./http";

export interface Ctx {
  deps: Deps;
  event: HttpEvent;
  query: Record<string, string>;
  params: string[];
}

export interface Route {
  method: string;
  pattern: RegExp;
  run: (ctx: Ctx) => Promise<HttpResult>;
}

export function matchRoute(
  routes: Route[],
  method: string,
  path: string,
): { route: Route; params: string[] } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (m) return { route, params: m.slice(1) };
  }
  return null;
}
