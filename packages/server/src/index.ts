import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { POLICY_TEMPLATES, PolicyWallet } from "./policy";
import { fetchDiscovery, findQuote, verifyDiscoveryQuote } from "./discovery";
import { publish, subscribe, getRecent } from "./events";
import { shortHash } from "./signing";
import { loadOrCreateKeypair, publicKeyBase58 } from "./wallet";
import type { ProxyEvent } from "./types";

const wallet = loadOrCreateKeypair();
const policy = new PolicyWallet();

const app = new Hono();
app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: "AgentFirewall",
    version: "0.1.0",
    agentPubkey: publicKeyBase58(wallet),
    policy: policy.config,
    dailySpentUSDC: policy.dailySpentUSDC,
  }),
);

app.get("/policy", (c) =>
  c.json({
    config: policy.config,
    dailySpentUSDC: policy.dailySpentUSDC,
    dayKey: policy.dayKey,
  }),
);

app.get("/recent", (c) => c.json({ events: getRecent() }));

app.put("/policy", async (c) => {
  const body = await c.req.json<{ template?: string; patch?: any }>();
  if (body.template && POLICY_TEMPLATES[body.template]) {
    Object.assign(policy.config, POLICY_TEMPLATES[body.template]);
  }
  if (body.patch) Object.assign(policy.config, body.patch);
  return c.json({ config: policy.config });
});

app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const initial: ProxyEvent = {
      id: `hello-${Date.now()}`,
      timestamp: Date.now(),
      seller: "firewall",
      path: "/",
      amountUSDC: 0,
      status: "ALLOW",
      reason: "STREAM_OPEN",
    };
    await stream.writeSSE({ data: JSON.stringify(initial), event: "hello" });

    for (const e of getRecent()) {
      await stream.writeSSE({ data: JSON.stringify(e), event: "event" });
    }

    const queue: ProxyEvent[] = [];
    let waiter: (() => void) | null = null;
    const unsub = subscribe((e) => {
      queue.push(e);
      waiter?.();
    });

    try {
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            waiter = r;
            setTimeout(r, 15_000);
          });
          waiter = null;
          if (queue.length === 0) {
            await stream.writeSSE({ data: "ping", event: "ping" });
            continue;
          }
        }
        const e = queue.shift()!;
        await stream.writeSSE({ data: JSON.stringify(e), event: "event" });
      }
    } finally {
      unsub();
    }
  }),
);

app.post("/proxy", async (c) => {
  const body = await c.req.json<{
    sellerHost: string;
    path: string;
    amountUSDC: number;
  }>();
  const { sellerHost, path, amountUSDC } = body;

  const budget = policy.evaluateBudget({ sellerHost, amountUSDC });
  if (!budget.allow) {
    return emit(c, {
      sellerHost,
      path,
      amountUSDC,
      status: "BLOCK",
      reason: budget.reason,
      hint: budget.hint,
    });
  }

  const discovery = await fetchDiscovery(sellerHost);
  if (!discovery && policy.config.requireSignedQuote) {
    return emit(c, {
      sellerHost,
      path,
      amountUSDC,
      status: "BLOCK",
      reason: "DISCOVERY_UNAVAILABLE",
      hint: `Could not fetch http://${sellerHost}/.well-known/x402.json. Policy requires signed quote.`,
    });
  }

  const quote = findQuote(discovery, path);
  const signatureValid = verifyDiscoveryQuote(quote);

  const quoteCheck = policy.evaluateQuote({
    quotedPrice: quote?.price ?? 0,
    livePrice: amountUSDC,
    quote,
    signatureValid,
  });

  if (!quoteCheck.allow) {
    return emit(c, {
      sellerHost,
      path,
      amountUSDC,
      status: "BLOCK",
      reason: quoteCheck.reason,
      hint: quoteCheck.hint,
      signatureHash: quote ? shortHash(quote.signature) : undefined,
      quotedPrice: quote?.price,
      livePrice: amountUSDC,
    });
  }

  policy.recordSpend(amountUSDC);
  return emit(
    c,
    {
      sellerHost,
      path,
      amountUSDC,
      status: "ALLOW",
      reason: "OK",
      signatureHash: quote ? shortHash(quote.signature) : undefined,
      quotedPrice: quote?.price,
      livePrice: amountUSDC,
    },
    { paymentSigned: true },
  );
});

function emit(
  c: any,
  e: {
    sellerHost: string;
    path: string;
    amountUSDC: number;
    status: "ALLOW" | "BLOCK";
    reason: string;
    hint?: string;
    signatureHash?: string;
    quotedPrice?: number;
    livePrice?: number;
  },
  extra: { paymentSigned?: boolean } = {},
) {
  const event: ProxyEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    seller: e.sellerHost,
    path: e.path,
    amountUSDC: e.amountUSDC,
    status: e.status,
    reason: e.reason,
    hint: e.hint,
    signatureHash: e.signatureHash,
    quotedPrice: e.quotedPrice,
    livePrice: e.livePrice,
  };
  publish(event);
  if (e.status === "BLOCK") {
    return c.json(
      {
        code: 451,
        reason: e.reason,
        hint: e.hint ?? "",
        sellerHost: e.sellerHost,
        path: e.path,
        amountUSDC: e.amountUSDC,
      },
      451,
    );
  }
  return c.json({
    code: 200,
    paymentSigned: !!extra.paymentSigned,
    paymentHeader: `x402-payment ${publicKeyBase58(wallet)}:${event.id}`,
    sellerHost: e.sellerHost,
    path: e.path,
    amountUSDC: e.amountUSDC,
    dailySpentUSDC: policy.dailySpentUSDC,
  });
}

const port = Number(process.env.PORT ?? 8800);
console.log(`AgentFirewall listening on http://localhost:${port}`);
console.log(`  agent pubkey: ${publicKeyBase58(wallet)}`);
console.log(`  policy: per-call $${policy.config.maxPerCallUSDC}, daily $${policy.config.dailyBudgetUSDC}`);
console.log(`  allowed sellers: ${policy.config.allowedSellerHosts.join(", ")}`);

export default {
  port,
  fetch: app.fetch,
};
