export type BlockReason =
  | "BUDGET_EXCEEDED"
  | "DAILY_BUDGET_EXCEEDED"
  | "UNKNOWN_SELLER"
  | "QUOTE_LIE"
  | "DISCOVERY_UNAVAILABLE"
  | "SIGNATURE_INVALID"
  | "EXPIRED_QUOTE"
  | "REQUIRE_SIGNED_QUOTE";

export type Decision =
  | { allow: true; reason: "OK"; hint?: string }
  | { allow: false; reason: BlockReason; hint: string };

export type PolicyConfig = {
  maxPerCallUSDC: number;
  dailyBudgetUSDC: number;
  allowedSellerHosts: string[];
  requireSignedQuote: boolean;
  priceTolerance: number;
};

export type SignedQuote = {
  price: number;
  currency: "USDC" | "SOL";
  validUntil: number;
  sellerPubkey: string;
  signature: string;
};

export type DiscoveryDoc = {
  seller: string;
  endpoints: Array<{
    path: string;
    quote: SignedQuote;
  }>;
};

export type ProxyEvent = {
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
