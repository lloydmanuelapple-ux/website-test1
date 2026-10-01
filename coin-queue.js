import bs58 from "bs58";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { CREATOR_PROFILE_ADDON_LAMPORTS, FIXED_COIN_REQUEST_PAYMENT_LAMPORTS, MIN_POOL_CONTRIBUTION_LAMPORTS, PAYMENT_RECIPIENT_ADDRESS } from "./payment.js";
import { normalizeJpegUrl } from "./logo-url.js";

const DECIMAL_OPTIONS = new Set([0, 2, 6, 9]);
const MAX_TOKEN_SUPPLY = 1_000_000_000_000;
const MAX_USD_TARGET = 1_000_000_000_000_000;

function publicKeyString(value) {
  try {
    return new PublicKey(value?.toString()).toBase58();
  } catch {
    return "";
  }
}

function normalizeOptionalHttpsUrl(value, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length > 500) throw new Error(`${fieldName} must be 500 characters or fewer.`);
  let url;
  try { url = new URL(text); } catch { throw new Error(`${fieldName} must be a valid HTTPS URL.`); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error(`${fieldName} must be a valid HTTPS URL.`);
  }
  return url.toString();
}

function normalizeCreatorExtras(value) {
  if (value?.enabled !== true) return { enabled: false };
  const creatorName = typeof value.creatorName === "string" ? value.creatorName.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (creatorName.length > 64) throw new Error("Creator name must be 64 characters or fewer.");
  if (description.length > 280) throw new Error("Creator description must be 280 characters or fewer.");
  const extras = {
    enabled: true,
    creatorName,
    websiteUrl: normalizeOptionalHttpsUrl(value.websiteUrl, "Website"),
    xUrl: normalizeOptionalHttpsUrl(value.xUrl, "X profile"),
    telegramUrl: normalizeOptionalHttpsUrl(value.telegramUrl, "Telegram link"),
    discordUrl: normalizeOptionalHttpsUrl(value.discordUrl, "Discord link"),
    description,
  };
  if (!extras.creatorName && !extras.websiteUrl && !extras.xUrl && !extras.telegramUrl && !extras.discordUrl && !extras.description) {
    throw new Error("Enter at least one creator detail for the selected add-on.");
  }
  return extras;
}

export function verifyPoolContributionPayment(transactionResponse, { signature, payer, expectedLamports }) {
  const transaction = transactionResponse?.transaction;
  const message = transaction?.message;
  const meta = transactionResponse?.meta;
  if (!transaction || !message || !meta || meta.err) return false;
  if (!Array.isArray(transaction.signatures)) return false;

  const accountKeys = message.accountKeys ?? [];
  const payerAddress = publicKeyString(payer);
  const payerIndex = accountKeys.findIndex((account) => publicKeyString(account.pubkey ?? account) === payerAddress);
  if (!payerAddress || payerIndex !== 0 || (message.header?.numRequiredSignatures ?? 0) < 1) return false;
  if (transaction.signatures[0] !== signature) return false;

  const instructions = message.instructions ?? [];
  if (instructions.length !== 1) return false;
  const [instruction] = instructions;
  const instructionAccounts = instruction.accounts ?? [];
  const programId = accountKeys[instruction.programIdIndex];
  if (publicKeyString(programId) !== SystemProgram.programId.toBase58() || instructionAccounts.length !== 2) return false;
  const source = accountKeys[instructionAccounts[0]];
  const destination = accountKeys[instructionAccounts[1]];
  if (publicKeyString(source) !== payerAddress || publicKeyString(destination) !== PAYMENT_RECIPIENT_ADDRESS) return false;

  let data;
  try { data = Buffer.from(bs58.decode(instruction.data)); } catch { return false; }
  if (data.length !== 12 || data.readUInt32LE(0) !== 2) return false;
  const lamports = data.readBigUInt64LE(4);
  if (lamports !== BigInt(expectedLamports) || lamports < MIN_POOL_CONTRIBUTION_LAMPORTS) return false;

  const preBalance = Number(meta.preBalances?.[payerIndex]);
  const postBalance = Number(meta.postBalances?.[payerIndex]);
  return Number.isFinite(preBalance) && Number.isFinite(postBalance) && postBalance < preBalance;
}

export function normalizeCoinRequest(value, poolContributionLamports) {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const symbol = typeof value?.symbol === "string" ? value.symbol.trim().toUpperCase() : "";
  const supply = Number(value?.supply);
  const decimals = Number(value?.decimals);
  const marketCapTarget = Number(value?.marketCapTarget);
  if (!name || name.length > 32) throw new Error("Coin name must be 1–32 characters.");
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error("Ticker must contain 1–10 letters or numbers.");
  if (!Number.isSafeInteger(supply) || supply < 1 || supply > MAX_TOKEN_SUPPLY) throw new Error("Supply is outside the supported range.");
  if (!DECIMAL_OPTIONS.has(decimals)) throw new Error("Unsupported decimal precision.");
  if (BigInt(supply) * 10n ** BigInt(decimals) > 18_446_744_073_709_551_615n) throw new Error("Supply exceeds the SPL token amount limit.");
  if (!Number.isSafeInteger(marketCapTarget) || marketCapTarget < 1 || marketCapTarget > MAX_USD_TARGET) throw new Error("Market cap target is outside the supported range.");
  const creatorExtras = normalizeCreatorExtras(value?.creatorExtras);
  if (!/^\d+$/.test(String(poolContributionLamports ?? ""))) throw new Error("Pool contribution amount is required in lamports.");
  const contribution = BigInt(poolContributionLamports);
  if (contribution < MIN_POOL_CONTRIBUTION_LAMPORTS) throw new Error("Pool contribution must be at least 0.5 SOL.");
  const expectedPayment = FIXED_COIN_REQUEST_PAYMENT_LAMPORTS + (creatorExtras.enabled ? CREATOR_PROFILE_ADDON_LAMPORTS : 0n);
  if (contribution !== expectedPayment) throw new Error("Coin request payment does not match the selected add-ons.");

  let imageUrl = "";
  if (typeof value.imageUrl === "string" && value.imageUrl.trim()) imageUrl = normalizeJpegUrl(value.imageUrl);
  return {
    name,
    symbol,
    supply,
    decimals,
    marketCapTarget,
    poolContributionLamports: contribution.toString(),
    mintAuthority: value.mintAuthority === true,
    freezeAuthority: value.freezeAuthority === true,
    imageUrl,
    creatorExtras,
    network: "devnet",
  };
}