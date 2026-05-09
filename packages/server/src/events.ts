import type { ProxyEvent } from "./types";

type Subscriber = (event: ProxyEvent) => void;

const subs = new Set<Subscriber>();
const recent: ProxyEvent[] = [];
const MAX_RECENT = 50;

export function subscribe(fn: Subscriber): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function publish(event: ProxyEvent) {
  recent.push(event);
  while (recent.length > MAX_RECENT) recent.shift();
  for (const fn of subs) {
    try {
      fn(event);
    } catch {}
  }
}

export function getRecent(): ProxyEvent[] {
  return [...recent];
}
