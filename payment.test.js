import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  MAX_U64_LAMPORTS,
  MIN_POOL_CONTRIBUTION_LAMPORTS,
  createSolPaymentInstruction,
  formatSolAmount,
  parsePoolContribution,
  parseSolAmount,
  PAYMENT_RECIPIENT_ADDRESS,
} from "./payment.js";

test("parses decimal SOL amounts exactly to lamports", () => {
  assert.equal(parseSolAmount("1"), 1_000_000_000n);
  assert.equal(parseSolAmount("0.1"), 100_000_000n);
  assert.equal(parseSolAmount(".000000001"), 1n);
  assert.equal(parseSolAmount("12.000000009"), 12_000_000_009n);
});

test("rejects zero, negative, exponent, over-precision, and over-u64 amounts", () => {
  for (const amount of ["0", "0.000000000", "-1", "1e-3", "1.0000000001", "18446744073.709551616"]) {
    assert.throws(() => parseSolAmount(amount), { name: "Error" }, amount);
  }
});

test("pool contributions have a 0.5 SOL minimum and no lower application cap", () => {
  assert.equal(MIN_POOL_CONTRIBUTION_LAMPORTS, 500_000_000n);
  assert.equal(parsePoolContribution("0.5"), 500_000_000n);
  assert.equal(parsePoolContribution("1.234567891"), 1_234_567_891n);
  assert.equal(parsePoolContribution("18446744073.709551615"), MAX_U64_LAMPORTS);
  assert.throws(() => parsePoolContribution("0.499999999"), /at least 0.5 SOL/);
});

test("formats lamports without float rounding", () => {
  assert.equal(formatSolAmount(1n), "0.000000001");
  assert.equal(formatSolAmount(100_000_000n), "0.1");
  assert.equal(formatSolAmount(2_000_000_000n), "2");
  assert.equal(formatSolAmount(12_000_000_009n), "12.000000009");
});

test("builds a transfer to the configured recipient for the exact amount", () => {
  const payer = Keypair.generate().publicKey;
  const instruction = createSolPaymentInstruction(payer, parseSolAmount("0.125000001"));

  assert.equal(instruction.keys[0].pubkey.toBase58(), payer.toBase58());
  assert.equal(instruction.keys[1].pubkey.toBase58(), PAYMENT_RECIPIENT_ADDRESS);
  assert.equal(instruction.data.readUInt32LE(0), 2);
  assert.equal(instruction.data.readBigUInt64LE(4), 125_000_001n);
});

test("encodes the protocol maximum without Number rounding", () => {
  const payer = Keypair.generate().publicKey;
  const instruction = createSolPaymentInstruction(payer, MAX_U64_LAMPORTS);
  assert.equal(instruction.data.readBigUInt64LE(4), MAX_U64_LAMPORTS);
});
