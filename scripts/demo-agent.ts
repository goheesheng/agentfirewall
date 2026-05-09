const FIREWALL = process.env.FIREWALL ?? "http://localhost:8800";

type Call = {
  label: string;
  sellerHost: string;
  path: string;
  amountUSDC: number;
  expect: "ALLOW" | "BLOCK";
};

const CALLS: Call[] = [
  { label: "1/5  pass — data-seller-a, $0.005", sellerHost: "localhost:8801", path: "/api/data", amountUSDC: 0.005, expect: "ALLOW" },
  { label: "2/5  pass — data-seller-b, $0.008", sellerHost: "localhost:8802", path: "/api/data", amountUSDC: 0.008, expect: "ALLOW" },
  { label: "3/5  block — over per-call cap, $0.05", sellerHost: "localhost:8803", path: "/api/data", amountUSDC: 0.05, expect: "BLOCK" },
  { label: "4/5  block — UNKNOWN_SELLER, host not in allowlist", sellerHost: "evil.example.com", path: "/api/data", amountUSDC: 0.005, expect: "BLOCK" },
  { label: "5/5  block — QUOTE_LIE, signed $0.01 vs live $1.00", sellerHost: "localhost:8805", path: "/api/data", amountUSDC: 1.0, expect: "BLOCK" },
];

const COLOR = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

async function call(c: Call) {
  const res = await fetch(`${FIREWALL}/proxy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sellerHost: c.sellerHost,
      path: c.path,
      amountUSDC: c.amountUSDC,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`${COLOR.bold}AgentFirewall demo agent${COLOR.reset}`);
console.log(`${COLOR.dim}firewall: ${FIREWALL}${COLOR.reset}\n`);

for (let i = 0; i < CALLS.length; i++) {
  const c = CALLS[i];
  if (i === 4) {
    await fetch(`${FIREWALL}/policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: { maxPerCallUSDC: 5, dailyBudgetUSDC: 50 } }),
    });
    console.log(`${COLOR.dim}policy raised: per-call $5, daily $50 — letting quote-binding be the gate${COLOR.reset}`);
  }
  process.stdout.write(`${COLOR.cyan}${c.label}${COLOR.reset}\n`);
  try {
    const { status, data } = await call(c);
    if (status === 200) {
      console.log(
        `  ${COLOR.green}✓ ALLOW${COLOR.reset}  paid=$${c.amountUSDC.toFixed(4)} dailySpent=$${data.dailySpentUSDC?.toFixed(4) ?? "?"} sig=${(data.paymentHeader ?? "").split(":")[1]?.slice(0, 8) ?? ""}`,
      );
    } else if (status === 451) {
      console.log(`  ${COLOR.red}✗ BLOCK${COLOR.reset}  ${COLOR.bold}${data.reason}${COLOR.reset} — ${data.hint}`);
    } else {
      console.log(`  ${COLOR.yellow}? ${status}${COLOR.reset}  ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`  ${COLOR.yellow}? ERROR${COLOR.reset}  ${(err as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 700));
  console.log();
}

console.log(`${COLOR.dim}done. dashboard: http://localhost:3000${COLOR.reset}`);
