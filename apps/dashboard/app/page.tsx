"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ProxyEvent = {
  id: string;
  timestamp: number;
  seller: string;
  path: string;
  amountUSDC: number;
  status: "ALLOW" | "BLOCK";
  reason: string;
  hint?: string;
  signatureHash?: string;
  quotedPrice?: number;
  livePrice?: number;
  unsigned?: boolean;
};

type Policy = {
  config: {
    maxPerCallUSDC: number;
    dailyBudgetUSDC: number;
    allowedSellerHosts: string[];
    requireSignedQuote: boolean;
    priceTolerance: number;
  };
  dailySpentUSDC: number;
};

const FIREWALL = "http://localhost:8800";

export default function Page() {
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [live, setLive] = useState(false);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    let stop = false;
    async function poll() {
      while (!stop) {
        try {
          const res = await fetch(`${FIREWALL}/policy`);
          if (res.ok) {
            const p = await res.json();
            setPolicy(p);
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    poll();
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    const es = new EventSource(`${FIREWALL}/events`);
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("hello", () => setLive(true));
    es.addEventListener("event", (msg: MessageEvent) => {
      try {
        const ev = JSON.parse(msg.data) as ProxyEvent;
        if (seenIds.current.has(ev.id)) return;
        seenIds.current.add(ev.id);
        setEvents((prev) => [ev, ...prev].slice(0, 60));
      } catch {}
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  const sellerSpend = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.status !== "ALLOW") continue;
      map.set(e.seller, (map.get(e.seller) ?? 0) + e.amountUSDC);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const blocks = events.filter((e) => e.status === "BLOCK");
  const dailySpent = policy?.dailySpentUSDC ?? 0;
  const dailyCap = policy?.config.dailyBudgetUSDC ?? 1;
  const pct = Math.min(100, (dailySpent / dailyCap) * 100);
  const sellerCap = sellerSpend[0]?.[1] ?? 0;

  return (
    <div className="shell">
      <div className="brand">
        <span className="lock">🔒</span>
        <h1>AgentFirewall</h1>
        <span className="v">v0.1 · devnet</span>
      </div>
      <div className="tagline">
        Two locks before your agent signs · spend policy + quote-binding ·{" "}
        <span className={`status-dot ${live ? "live" : ""}`} />
        <span className="status-line">{live ? "live" : "connecting…"}</span>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Daily Budget</h2>
          <div className="gauge">
            <span className="num">${dailySpent.toFixed(4)}</span>
            <span className="of">/ ${dailyCap.toFixed(2)} USDC</span>
          </div>
          <div className={`bar ${pct > 75 ? "warn" : ""}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="card">
          <h2>Active Policy</h2>
          {policy ? (
            <>
              <div className="policy-row">
                <span className="k">per-call cap</span>
                <span className="v">${policy.config.maxPerCallUSDC.toFixed(4)}</span>
              </div>
              <div className="policy-row">
                <span className="k">daily budget</span>
                <span className="v">${policy.config.dailyBudgetUSDC.toFixed(2)}</span>
              </div>
              <div className="policy-row">
                <span className="k">require signed quote</span>
                <span className="v">{policy.config.requireSignedQuote ? "yes" : "no"}</span>
              </div>
              <div className="policy-row">
                <span className="k">price tolerance</span>
                <span className="v">${policy.config.priceTolerance.toFixed(4)}</span>
              </div>
              <div className="policy-row">
                <span className="k">allowed sellers</span>
                <span className="v">{policy.config.allowedSellerHosts.length}</span>
              </div>
            </>
          ) : (
            <div className="empty">loading…</div>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Per-Seller Spend</h2>
          {sellerSpend.length === 0 ? (
            <div className="empty">no allowed payments yet</div>
          ) : (
            <div className="seller-chart">
              {sellerSpend.map(([seller, amt]) => (
                <div className="seller-bar" key={seller}>
                  <span className="name">{seller}</span>
                  <span className="track">
                    <span style={{ width: `${(amt / Math.max(0.0001, sellerCap)) * 100}%` }} />
                  </span>
                  <span className="num">${amt.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Recent Blocks ({blocks.length})</h2>
          {blocks.length === 0 ? (
            <div className="empty">nothing blocked yet</div>
          ) : (
            <div className="feed">
              {blocks.slice(0, 8).map((e) => (
                <BlockRow key={e.id} e={e} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Live Feed</h2>
        {events.length === 0 ? (
          <div className="empty">waiting for traffic — run <code>bun run demo</code></div>
        ) : (
          <div className="feed">
            {events.map((e) => (
              <FeedRow key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedRow({ e }: { e: ProxyEvent }) {
  const klass = `row ${e.status === "ALLOW" ? "allow" : "block"} ${e.reason === "QUOTE_LIE" ? "quote-lie" : ""}`;
  const time = new Date(e.timestamp).toLocaleTimeString();
  return (
    <div className={klass}>
      <span className="badge">{e.status}</span>
      <div>
        <div className="reason">
          {e.reason}
          {e.signatureHash ? (
            <span className="sig-tooltip" title={`Ed25519 signature: ${e.signatureHash}`}>
              sig {e.signatureHash}
            </span>
          ) : null}
          {e.unsigned ? (
            <span
              className="sig-tooltip"
              style={{
                color: "#d29922",
                borderBottomColor: "#d29922",
                marginLeft: 8,
              }}
              title="Seller does not publish a signed .well-known/x402.json — running with budget controls only."
            >
              unsigned · budget-only
            </span>
          ) : null}
        </div>
        <div className="seller">
          {time} · {e.seller}
          {e.path}
        </div>
        {e.hint ? <div className="hint">{e.hint}</div> : null}
      </div>
      <div className="amount">${e.amountUSDC.toFixed(4)}</div>
    </div>
  );
}

function BlockRow({ e }: { e: ProxyEvent }) {
  return (
    <div className={`row block ${e.reason === "QUOTE_LIE" ? "quote-lie" : ""}`}>
      <span className="badge">BLOCK</span>
      <div>
        <div className="reason">{e.reason}</div>
        {e.hint ? <div className="hint">{e.hint}</div> : null}
        <div className="seller">{e.seller}{e.path}</div>
      </div>
      <div className="amount">${e.amountUSDC.toFixed(4)}</div>
    </div>
  );
}
