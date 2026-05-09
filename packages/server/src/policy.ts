import type { Decision, PolicyConfig, SignedQuote } from "./types";

export const DEFAULT_POLICY: PolicyConfig = {
  maxPerCallUSDC: 0.01,
  dailyBudgetUSDC: 0.5,
  allowedSellerHosts: [
    "localhost:8801",
    "localhost:8802",
    "localhost:8803",
    "localhost:8804",
    "localhost:8805",
  ],
  requireSignedQuote: true,
  priceTolerance: 0,
};

export const POLICY_TEMPLATES: Record<string, Partial<PolicyConfig>> = {
  paranoid: { maxPerCallUSDC: 0.01, dailyBudgetUSDC: 0.1, requireSignedQuote: true, priceTolerance: 0 },
  researcher: { maxPerCallUSDC: 0.05, dailyBudgetUSDC: 1.0, requireSignedQuote: true, priceTolerance: 0.001 },
  trader: { maxPerCallUSDC: 0.5, dailyBudgetUSDC: 10, requireSignedQuote: true, priceTolerance: 0.01 },
  default: { maxPerCallUSDC: 0.01, dailyBudgetUSDC: 0.5, requireSignedQuote: true, priceTolerance: 0 },
  open: { maxPerCallUSDC: 1, dailyBudgetUSDC: 100, requireSignedQuote: false, priceTolerance: Infinity },
};

export class PolicyWallet {
  config: PolicyConfig;
  dailySpentUSDC = 0;
  dayKey: string = todayKey();

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_POLICY, ...config };
  }

  private rolloverIfNewDay() {
    const k = todayKey();
    if (k !== this.dayKey) {
      this.dayKey = k;
      this.dailySpentUSDC = 0;
    }
  }

  evaluateBudget(req: { sellerHost: string; amountUSDC: number }): Decision {
    this.rolloverIfNewDay();
    if (!this.config.allowedSellerHosts.includes(req.sellerHost)) {
      return {
        allow: false,
        reason: "UNKNOWN_SELLER",
        hint: `Host ${req.sellerHost} not in allowedSellerHosts. Add it to your policy or use the 'open' template.`,
      };
    }
    if (req.amountUSDC > this.config.maxPerCallUSDC) {
      return {
        allow: false,
        reason: "BUDGET_EXCEEDED",
        hint: `Per-call cap is $${this.config.maxPerCallUSDC.toFixed(4)} USDC, requested $${req.amountUSDC.toFixed(4)}.`,
      };
    }
    if (this.dailySpentUSDC + req.amountUSDC > this.config.dailyBudgetUSDC) {
      return {
        allow: false,
        reason: "DAILY_BUDGET_EXCEEDED",
        hint: `Daily cap $${this.config.dailyBudgetUSDC.toFixed(2)} would be exceeded. Spent today: $${this.dailySpentUSDC.toFixed(4)}.`,
      };
    }
    return { allow: true, reason: "OK" };
  }

  evaluateQuote(req: {
    quotedPrice: number;
    livePrice: number;
    quote: SignedQuote | null;
    signatureValid: boolean;
  }): Decision {
    if (this.config.requireSignedQuote && !req.quote) {
      return {
        allow: false,
        reason: "REQUIRE_SIGNED_QUOTE",
        hint: "Policy requires a signed quote in seller's .well-known/x402.json. None present.",
      };
    }
    if (req.quote && !req.signatureValid) {
      return {
        allow: false,
        reason: "SIGNATURE_INVALID",
        hint: "Seller's discovery doc signature failed Ed25519 verification.",
      };
    }
    if (req.quote && req.quote.validUntil < Date.now()) {
      return {
        allow: false,
        reason: "EXPIRED_QUOTE",
        hint: `Quote validUntil=${new Date(req.quote.validUntil).toISOString()} has passed.`,
      };
    }
    const drift = Math.abs(req.livePrice - req.quotedPrice);
    if (drift > this.config.priceTolerance) {
      return {
        allow: false,
        reason: "QUOTE_LIE",
        hint: `Seller's signed discovery price $${req.quotedPrice.toFixed(4)} ≠ live 402 price $${req.livePrice.toFixed(4)}. Signature verified, mismatch detected.`,
      };
    }
    return { allow: true, reason: "OK" };
  }

  recordSpend(amountUSDC: number) {
    this.rolloverIfNewDay();
    this.dailySpentUSDC += amountUSDC;
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
