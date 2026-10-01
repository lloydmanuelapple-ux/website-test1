import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { Keypair, Transaction } from "@solana/web3.js";
import { createSolPaymentInstruction, COIN_REQUEST_BASE_PAYMENT_LAMPORTS, COIN_REQUEST_SECURITY_FEE_LAMPORTS, CREATOR_PROFILE_ADDON_LAMPORTS, FIXED_COIN_REQUEST_PAYMENT_LAMPORTS, MAX_U64_LAMPORTS, MIN_POOL_CONTRIBUTION_LAMPORTS, PAYMENT_RECIPIENT_ADDRESS } from "./payment.js";
import { normalizeCoinRequest, verifyPoolContributionPayment } from "./coin-queue.js";

function makePayment(payer, signature, lamports = MIN_POOL_CONTRIBUTION_LAMPORTS, overrides = {}) {
  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(createSolPaymentInstruction(payer, lamports));
  const message = transaction.compileMessage();
  return {
    transaction: {
      signatures: [signature],
      message,
    },
    meta: {
      err: null,
      preBalances: [Number(lamports) + 5_000, 0, 0],
      postBalances: [5_000, Number(lamports), 0],
    },
    ...overrides,
  };
}

test("accepts a confirmed chosen pool contribution signed by the paying wallet", () => {
  const payer = Keypair.generate().publicKey;
  const lamports = 1_250_000_000n;
  assert.equal(verifyPoolContributionPayment(makePayment(payer, "signature", lamports), {
    signature: "signature",
    payer: payer.toBase58(),
    expectedLamports: lamports,
  }), true);
});

test("verifies a large contribution exactly above Number safe-integer range", () => {
  const payer = Keypair.generate().publicKey;
  assert.equal(verifyPoolContributionPayment(makePayment(payer, "large-signature", MAX_U64_LAMPORTS), {
    signature: "large-signature",
    payer: payer.toBase58(),
    expectedLamports: MAX_U64_LAMPORTS,
  }), true);
});

test("rejects wrong signatures, wrong recipient, wrong amount, unsigned payer, and failed transactions", () => {
  const payer = Keypair.generate().publicKey;
  const transaction = makePayment(payer, "signature");
  const expected = { signature: "signature", payer: payer.toBase58(), expectedLamports: MIN_POOL_CONTRIBUTION_LAMPORTS };
  assert.equal(verifyPoolContributionPayment(transaction, { ...expected, signature: "other-signature" }), false);
  const wrongRecipient = structuredClone(transaction);
  wrongRecipient.transaction.message.accountKeys[1] = Keypair.generate().publicKey;
  assert.equal(verifyPoolContributionPayment(wrongRecipient, expected), false);
  const wrongAmount = structuredClone(transaction);
  const transferData = Buffer.from(bs58.decode(wrongAmount.transaction.message.instructions[0].data));
  transferData.writeBigUInt64LE(MIN_POOL_CONTRIBUTION_LAMPORTS - 1n, 4);
  wrongAmount.transaction.message.instructions[0].data = bs58.encode(transferData);
  assert.equal(verifyPoolContributionPayment(wrongAmount, expected), false);
  const extraInstruction = structuredClone(transaction);
  extraInstruction.transaction.message.instructions.push(structuredClone(extraInstruction.transaction.message.instructions[0]));
  assert.equal(verifyPoolContributionPayment(extraInstruction, expected), false);
  const unsignedPayer = structuredClone(transaction);
  unsignedPayer.transaction.message.header.numRequiredSignatures = 0;
  assert.equal(verifyPoolContributionPayment(unsignedPayer, expected), false);
  const failed = structuredClone(transaction);
  failed.meta.err = { InstructionError: [0, "Custom"] };
  assert.equal(verifyPoolContributionPayment(failed, expected), false);
  assert.equal(verifyPoolContributionPayment(makePayment(payer, "small", MIN_POOL_CONTRIBUTION_LAMPORTS - 1n), {
    signature: "small",
    payer: payer.toBase58(),
    expectedLamports: MIN_POOL_CONTRIBUTION_LAMPORTS - 1n,
  }), false);
});

test("normalizes only the supported coin request fields", () => {
  assert.equal(COIN_REQUEST_BASE_PAYMENT_LAMPORTS, 500_000_000n);
  assert.equal(COIN_REQUEST_SECURITY_FEE_LAMPORTS, 150_000_000n);
  assert.equal(FIXED_COIN_REQUEST_PAYMENT_LAMPORTS, 650_000_000n);
  assert.deepEqual(normalizeCoinRequest({
    name: "  Moon Notes ",
    symbol: "moon",
    supply: "1000000000",
    decimals: "6",
    marketCapTarget: "1000000000",
    imageUrl: "https://assets.example/moon.jpg",
    mintAuthority: true,
    freezeAuthority: false,
    unexpected: "discard this",
  }, "650000000"), {
    name: "Moon Notes",
    symbol: "MOON",
    supply: 1_000_000_000,
    decimals: 6,
    marketCapTarget: 1_000_000_000,
    poolContributionLamports: "650000000",
    mintAuthority: true,
    freezeAuthority: false,
    imageUrl: "https://assets.example/moon.jpg",
    creatorExtras: { enabled: false },
    network: "devnet",
  });
  assert.throws(() => normalizeCoinRequest({ name: "X", symbol: "X", supply: 1, decimals: 9, marketCapTarget: 1, imageUrl: "javascript:alert(1)" }, "650000000"), /HTTP or HTTPS/);
  assert.throws(() => normalizeCoinRequest({ name: "X", symbol: "X", supply: 1, decimals: 9, marketCapTarget: 1 }, "499999999"), /at least 0.5 SOL/);
  assert.equal(CREATOR_PROFILE_ADDON_LAMPORTS, 100_000_000n);
  assert.throws(() => normalizeCoinRequest({ name: "X", symbol: "X", supply: 1, decimals: 9, marketCapTarget: 1 }, "750000000"), /selected add-ons/);
  assert.throws(() => normalizeCoinRequest({ name: "X", symbol: "X", supply: 1, decimals: 9, marketCapTarget: 1 }, "500000000"), /selected add-ons/);
});

test("includes the creator profile bundle only with its exact add-on payment", () => {
  const coin = {
    name: "Profile Coin",
    symbol: "PROFILE",
    supply: 1_000_000,
    decimals: 6,
    marketCapTarget: 10_000,
    creatorExtras: {
      enabled: true,
      creatorName: "Ada Creator",
      websiteUrl: "https://example.com",
      xUrl: "https://x.com/ada",
      telegramUrl: "",
      discordUrl: "",
      description: "A short project description.",
    },
  };
  const normalized = normalizeCoinRequest(coin, (FIXED_COIN_REQUEST_PAYMENT_LAMPORTS + CREATOR_PROFILE_ADDON_LAMPORTS).toString());
  assert.equal(normalized.creatorExtras.enabled, true);
  assert.equal(normalized.creatorExtras.creatorName, "Ada Creator");
  assert.equal(normalized.creatorExtras.websiteUrl, "https://example.com/");
  assert.throws(() => normalizeCoinRequest(coin, FIXED_COIN_REQUEST_PAYMENT_LAMPORTS.toString()), /selected add-ons/);
  assert.throws(() => normalizeCoinRequest({ ...coin, creatorExtras: { ...coin.creatorExtras, websiteUrl: "http://example.com" } }, "750000000"), /valid HTTPS URL/);
  assert.throws(() => normalizeCoinRequest({ ...coin, creatorExtras: { enabled: true } }, "750000000"), /at least one creator detail/);
});