/**
 * AgentFirewall · live integration demo against SAN Foundation
 *
 * What this demonstrates:
 *   1. Switch the firewall into the `researcher_san` template (allows
 *      gateway.sanfoundation.com without a signed quote — SAN doesn't
 *      publish one yet).
 *   2. Ask the firewall whether the call is allowed (budget + allow-list).
 *   3. If allowed, forward the actual x402 call to SAN's gateway via
 *      `x402-fetch` using a Base wallet. The firewall is the policy
 *      engine; the agent does the upstream forwarding.
 *   4. Print SAN's response and the firewall's audit trail.
 *
 * Honest caveats:
 *   - SAN runs on Base, so the upstream payment is signed by a Base wallet
 *     (viem). The firewall's spend-policy logic is chain-agnostic and
 *     enforces the budget BEFORE any signing happens.
 *   - SAN does not yet publish a signed `.well-known/x402.json`. We run
 *     budget-only protection until the spec PR lands at x402-foundation/x402.
 *   - If you don't have a funded Base wallet (BASE_PRIVATE_KEY env var)
 *     this demo runs in DRY-RUN mode: firewall + simulated upstream.
 */

import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";

const FIREWALL = process.env.FIREWALL ?? "http://localhost:8800";
const SAN_HOST = "gateway.sanfoundation.com";
const SAN_PATH = "/x402/v1/web-search";
const SAN_URL = `https://${SAN_HOST}${SAN_PATH}`;
const AMOUNT_USDC = Number(process.env.AMOUNT_USDC ?? 0.001);
const QUERY = process.env.QUERY ?? "agent payments x402 may 2026";

const COLOR = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};
const c = (col: keyof typeof COLOR, s: string) => `${COLOR[col]}${s}${COLOR.reset}`;

console.log(c("bold", "AgentFirewall · live SAN Foundation integration"));
console.log(c("dim", `firewall: ${FIREWALL}`));
console.log(c("dim", `target:   ${SAN_URL}`));
console.log(c("dim", `query:    "${QUERY}"`));
console.log();

// 1) Switch policy template
process.stdout.write(c("cyan", "1/3  Applying policy template 'researcher_san'..."));
const policyRes = await fetch(`${FIREWALL}/policy`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ template: "researcher_san" }),
});
if (!policyRes.ok) {
  console.log(c("red", " FAILED"));
  console.error(await policyRes.text());
  process.exit(1);
}
const policy = await policyRes.json();
console.log(c("green", " ok"));
console.log(
  c(
    "dim",
    `     per-call cap $${policy.config.maxPerCallUSDC} · daily $${policy.config.dailyBudgetUSDC} · ` +
      `signed-quote required: ${policy.config.requireSignedQuote}`,
  ),
);
console.log();

// 2) Ask the firewall — pre-flight check
process.stdout.write(c("cyan", "2/3  Asking firewall whether the call is allowed..."));
const firewallRes = await fetch(`${FIREWALL}/proxy`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sellerHost: SAN_HOST,
    path: SAN_PATH,
    amountUSDC: AMOUNT_USDC,
  }),
});
const firewallBody = await firewallRes.json().catch(() => ({}));
if (firewallRes.status === 451) {
  console.log(c("red", " BLOCKED"));
  console.log(c("red", `     ${firewallBody.reason}: ${firewallBody.hint}`));
  console.log(c("dim", "     no upstream call will be made."));
  process.exit(0);
}
if (!firewallRes.ok) {
  console.log(c("yellow", ` ${firewallRes.status}`));
  console.error(firewallBody);
  process.exit(1);
}
console.log(c("green", " ALLOW"));
console.log(
  c(
    "dim",
    `     paymentSigned=${firewallBody.paymentSigned} · ` +
      `dailySpent=$${firewallBody.dailySpentUSDC?.toFixed(4) ?? "?"} · ` +
      `unsigned=${firewallBody.unsigned ?? "n/a"}`,
  ),
);
console.log();

// 3) Forward the call to SAN's x402 gateway
const baseKey = process.env.BASE_PRIVATE_KEY;
if (!baseKey) {
  console.log(c("yellow", "3/3  DRY-RUN — no BASE_PRIVATE_KEY env var set."));
  console.log(c("dim", "     Set a funded Base private key (USDC on Base mainnet)"));
  console.log(c("dim", "     to make the real upstream call:"));
  console.log(c("dim", "       BASE_PRIVATE_KEY=0x... bun run demo:san"));
  console.log();
  console.log(c("dim", "     Simulated upstream response:"));
  console.log(
    c(
      "dim",
      `       POST ${SAN_URL}\n       → 402 PAYMENT-REQUIRED\n       → x402-fetch signs USDC transfer on Base\n       → 200 OK with SAN search payload`,
    ),
  );
  process.exit(0);
}

process.stdout.write(c("cyan", "3/3  Forwarding to SAN over x402 (real Base wallet)..."));
const account = privateKeyToAccount(baseKey as `0x${string}`);
const wallet = createWalletClient({ account, chain: base, transport: http() });
const maxValue = BigInt(Math.ceil(AMOUNT_USDC * 1_000_000)); // USDC has 6 decimals

const fetchWithPay = wrapFetchWithPayment(fetch, wallet as any, maxValue);

try {
  const sanRes = await fetchWithPay(SAN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, limit: 3 }),
  });
  const sanBody: any = await sanRes.json().catch(() => ({}));
  if (!sanRes.ok) {
    console.log(c("yellow", ` ${sanRes.status}`));
    console.log(c("dim", "     " + JSON.stringify(sanBody).slice(0, 300)));
    process.exit(1);
  }
  console.log(c("green", " 200 OK"));
  console.log();
  console.log(c("bold", "SAN response (first result):"));
  const first = sanBody.results?.[0] ?? sanBody.data?.[0] ?? sanBody;
  const preview = JSON.stringify(first, null, 2).split("\n").slice(0, 14).join("\n");
  console.log(preview);
  console.log();
  console.log(c("dim", "Done. Firewall audited the call · upstream signed by Base wallet."));
} catch (err) {
  console.log(c("red", " ERROR"));
  console.error((err as Error).message);
  process.exit(1);
}
