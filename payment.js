import { Buffer } from "buffer/index.js";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const COIN_REQUEST_BASE_PAYMENT_LAMPORTS = 500_000_000n;
export const COIN_REQUEST_SECURITY_FEE_PERCENT = 30n;
export const COIN_REQUEST_SECURITY_FEE_LAMPORTS = COIN_REQUEST_BASE_PAYMENT_LAMPORTS * COIN_REQUEST_SECURITY_FEE_PERCENT / 100n;
export const FIXED_COIN_REQUEST_PAYMENT_LAMPORTS = COIN_REQUEST_BASE_PAYMENT_LAMPORTS + COIN_REQUEST_SECURITY_FEE_LAMPORTS;
export const CREATOR_PROFILE_ADDON_LAMPORTS = 100_000_000n;
export const MIN_POOL_CONTRIBUTION_LAMPORTS = COIN_REQUEST_BASE_PAYMENT_LAMPORTS;
export const MAX_U64_LAMPORTS = 18_446_744_073_709_551_615n;
export const PAYMENT_RECIPIENT_ADDRESS = "ffXZvHDiXH2i5Pq4cL2y7c4RPMcm53wijzvoHbkYoHn";
export const PAYMENT_RECIPIENT = new PublicKey(PAYMENT_RECIPIENT_ADDRESS);

export function parseSolAmount(value) {
  const amount = value.trim();
  if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(amount)) {
    throw new Error("Enter a SOL amount with no more than 9 decimal places.");
  }
  const [whole = "0", fraction = ""] = amount.split(".");
  const lamports = BigInt(whole || "0") * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, "0") || "0");
  if (lamports <= 0n) throw new Error("Amount must be greater than zero.");
  if (lamports > MAX_U64_LAMPORTS) throw new Error("Amount exceeds Solana's maximum transfer amount.");
  return lamports;
}

export function parsePoolContribution(value) {
  const lamports = parseSolAmount(value);
  if (lamports < MIN_POOL_CONTRIBUTION_LAMPORTS) throw new Error("Initial pool contribution must be at least 0.5 SOL.");
  return lamports;
}

export function formatSolAmount(lamports) {
  const amount = BigInt(lamports);
  const whole = amount / LAMPORTS_PER_SOL;
  const fraction = (amount % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function createSolPaymentInstruction(fromPublicKey, lamports) {
  const amount = BigInt(lamports);
  if (amount <= 0n || amount > MAX_U64_LAMPORTS) throw new Error("Payment amount is outside the supported range.");
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(amount, 4);
  return new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: new PublicKey(fromPublicKey.toString()), isSigner: true, isWritable: true },
      { pubkey: PAYMENT_RECIPIENT, isSigner: false, isWritable: true },
    ],
    data,
  });
}