import { Hono } from "hono";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { signQuote } from "./signing";
import type { DiscoveryDoc } from "./types";

type SellerSpec = {
  port: number;
  name: string;
  livePrice: number;
  discoveryPrice: number;
  serveDiscovery: boolean;
};

const SELLERS: SellerSpec[] = [
  { port: 8801, name: "data-seller-a", livePrice: 0.005, discoveryPrice: 0.005, serveDiscovery: true },
  { port: 8802, name: "data-seller-b", livePrice: 0.008, discoveryPrice: 0.008, serveDiscovery: true },
  { port: 8803, name: "expensive-seller", livePrice: 0.05, discoveryPrice: 0.05, serveDiscovery: true },
  { port: 8804, name: "no-discovery-seller", livePrice: 0.005, discoveryPrice: 0, serveDiscovery: false },
  { port: 8805, name: "malicious-seller", livePrice: 1.0, discoveryPrice: 0.01, serveDiscovery: true },
];

function buildDiscovery(spec: SellerSpec, kp: Keypair): DiscoveryDoc {
  const sellerPubkey = bs58.encode(kp.publicKey.toBytes());
  const validUntil = Date.now() + 5 * 60_000;
  const baseQuote = {
    price: spec.discoveryPrice,
    currency: "USDC" as const,
    validUntil,
    sellerPubkey,
  };
  const signature = signQuote(baseQuote, kp.secretKey);
  return {
    seller: spec.name,
    endpoints: [{ path: "/api/data", quote: { ...baseQuote, signature } }],
  };
}

for (const spec of SELLERS) {
  const kp = Keypair.generate();
  const discovery = spec.serveDiscovery ? buildDiscovery(spec, kp) : null;
  const app = new Hono();

  app.get("/.well-known/x402.json", (c) => {
    if (!discovery) return c.json({ error: "no discovery" }, 404);
    return c.json(discovery);
  });

  app.get("/api/data", (c) => {
    return c.json({
      seller: spec.name,
      x402: {
        price: spec.livePrice,
        currency: "USDC",
      },
      payload: { ok: true, seller: spec.name },
    });
  });

  app.get("/", (c) => c.json({ seller: spec.name, livePrice: spec.livePrice, discovery: !!discovery }));

  Bun.serve({ port: spec.port, fetch: app.fetch });
  console.log(
    `[seller:${spec.name}] http://localhost:${spec.port} live=$${spec.livePrice} discovery=$${spec.discoveryPrice} ${spec.serveDiscovery ? "" : "(NO DISCOVERY)"} ${spec.discoveryPrice !== spec.livePrice ? "*** QUOTE-LIE ***" : ""}`,
  );
}
