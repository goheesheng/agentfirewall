import nacl from "tweetnacl";
import bs58 from "bs58";
import type { SignedQuote } from "./types";

export function quoteMessage(q: Pick<SignedQuote, "price" | "currency" | "validUntil" | "sellerPubkey">): Uint8Array {
  const canonical = JSON.stringify({
    price: q.price,
    currency: q.currency,
    validUntil: q.validUntil,
    sellerPubkey: q.sellerPubkey,
  });
  return new TextEncoder().encode(canonical);
}

export function signQuote(
  q: Pick<SignedQuote, "price" | "currency" | "validUntil" | "sellerPubkey">,
  secretKey: Uint8Array,
): string {
  const sig = nacl.sign.detached(quoteMessage(q), secretKey);
  return bs58.encode(sig);
}

export function verifyQuote(q: SignedQuote): boolean {
  try {
    const msg = quoteMessage(q);
    const sig = bs58.decode(q.signature);
    const pub = bs58.decode(q.sellerPubkey);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

export function shortHash(sig: string): string {
  return sig.slice(0, 8) + "…" + sig.slice(-6);
}
