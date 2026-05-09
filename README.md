# AgentFirewall

> Two locks before your agent signs: spend policy + quote-binding for x402 agents on Solana.

An HTTP proxy + dashboard that wraps your agent's Solana wallet and enforces two guards before any x402 payment leaves the keypair:

1. **Spending policy** — per-call cap, daily budget, allowed seller hosts.
2. **Quote-binding** — verifies the seller's signed discovery-time price (Ed25519 over `.well-known/x402.json`) against the live 402 price; blocks signature mismatches.

## Run the demo

In **three terminals**:

```bash
# 1) mock sellers (5 of them, including the malicious one)
bun run seller

# 2) firewall proxy + SSE event stream
bun run server

# 3) dashboard
bun run dashboard         # http://localhost:3000
```

Then in a fourth:

```bash
bun run demo              # 5 calls: 2 ALLOW, 3 BLOCK
```

You'll see, in order:

| # | Result | Reason |
|---|--------|--------|
| 1 | ✓ ALLOW | $0.005, signature verified |
| 2 | ✓ ALLOW | $0.008, signature verified |
| 3 | ✗ BLOCK | `BUDGET_EXCEEDED` (over per-call cap) |
| 4 | ✗ BLOCK | `UNKNOWN_SELLER` (host not allowlisted) |
| 5 | ✗ BLOCK | **`QUOTE_LIE`** — signed discovery price $0.01, live 402 price $1.00 |

The dashboard streams every event over SSE in real time. The QUOTE_LIE row pulses red and shows the seller's Ed25519 signature hash on hover.

## Why crypto

- **Wallet IS the policy boundary.** Only an in-process proxy holding the signing key can enforce limits before signing. No upstream party can do this.
- **Quote-binding requires Ed25519.** No centralized trust layer can enforce price honesty across permissionless x402 endpoints — it has to be cryptographic.

## Draft signed-quote spec

Today there is no `.well-known/x402.json` signature standard. AgentFirewall ships the first one. Format:

```jsonc
{
  "seller": "data-seller-a",
  "endpoints": [
    {
      "path": "/api/data",
      "quote": {
        "price": 0.005,
        "currency": "USDC",
        "validUntil": 1730000000000,
        "sellerPubkey": "<base58 ed25519 pubkey>",
        "signature": "<base58 ed25519 sig over canonical JSON of {price,currency,validUntil,sellerPubkey}>"
      }
    }
  ]
}
```

PRs welcome → x402-foundation/x402.

## Stack

- Bun + Hono + SSE
- Next.js 15 (App Router) dashboard
- `@solana/web3.js` + `tweetnacl` + `bs58` for keypair + Ed25519
- No Anchor program. No TEE. No MCP server in v0.1 (v0.2 reach goal).

## Layout

```
packages/server/src/
  index.ts          Hono firewall (POST /proxy, GET /events SSE, PUT /policy)
  policy.ts         PolicyWallet — evaluateBudget, evaluateQuote, templates
  signing.ts        Ed25519 sign + verify of signed quotes
  discovery.ts      .well-known/x402.json fetcher with 60s cache
  events.ts         pub/sub event bus for SSE
  wallet.ts         devnet keypair (lazy-generated, gitignored)
  mock-seller.ts    5 mock sellers — incl. malicious-seller (QUOTE_LIE)
apps/dashboard/app/
  page.tsx          SSE consumer, gauge, blocks, live feed
scripts/
  demo-agent.ts     5-call agent walking the demo script
```
