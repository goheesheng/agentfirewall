import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEY_PATH = new URL("../../../keypair.json", import.meta.url).pathname;

export function loadOrCreateKeypair(): Keypair {
  if (existsSync(KEY_PATH)) {
    const arr = JSON.parse(readFileSync(KEY_PATH, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const kp = Keypair.generate();
  writeFileSync(KEY_PATH, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export function publicKeyBase58(kp: Keypair) {
  return bs58.encode(kp.publicKey.toBytes());
}
