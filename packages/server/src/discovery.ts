import type { DiscoveryDoc, SignedQuote } from "./types";
import { verifyQuote } from "./signing";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; doc: DiscoveryDoc | null }>();

export async function fetchDiscovery(host: string): Promise<DiscoveryDoc | null> {
  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.doc;

  const url = `http://${host}/.well-known/x402.json`;
  let doc: DiscoveryDoc | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) doc = (await res.json()) as DiscoveryDoc;
  } catch {
    doc = null;
  }
  cache.set(host, { at: Date.now(), doc });
  return doc;
}

export function findQuote(doc: DiscoveryDoc | null, path: string): SignedQuote | null {
  if (!doc) return null;
  const ep = doc.endpoints.find((e) => e.path === path);
  return ep?.quote ?? null;
}

export function verifyDiscoveryQuote(quote: SignedQuote | null): boolean {
  if (!quote) return false;
  return verifyQuote(quote);
}
