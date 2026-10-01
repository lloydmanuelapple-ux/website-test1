import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { normalizeCoinRequest, verifyPoolContributionPayment } from "./coin-queue.js";
import { MIN_POOL_CONTRIBUTION_LAMPORTS } from "./payment.js";

const app = express();
const production = process.env.NODE_ENV === "production";
const apiOnly = process.argv.includes("--api-only");
const port = Number(process.env.PORT || (apiOnly ? process.env.API_PORT || 3001 : 4173));
const dataDirectory = path.resolve(process.env.COIN_QUEUE_DATA_DIR || "data");
const queuePath = path.join(dataDirectory, "coin-requests.json");
const mainnet = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
const ownerToken = process.env.AI_TOKEN_OWNER_TOKEN
  || (!production ? randomBytes(32).toString("hex") : "");

let writeChain = Promise.resolve();
app.disable("x-powered-by");
app.use(express.json({ limit: "24kb" }));

async function readQueue() {
  try {
    const content = await readFile(queuePath, "utf8");
    const entries = JSON.parse(content);
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function withQueueLock(operation) {
  const result = writeChain.then(operation, operation);
  writeChain = result.catch(() => {});
  return result;
}

async function writeQueue(entries) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${queuePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, queuePath);
}

function privateReceipt(entry) {
  return {
    requestId: entry.requestId,
    receiptToken: entry.receiptToken,
    status: entry.status,
    paymentSignature: entry.paymentSignature,
    poolContributionLamports: entry.poolContributionLamports,
    creatorExtrasEnabled: entry.coin.creatorExtras?.enabled === true,
    name: entry.coin.name,
    symbol: entry.coin.symbol,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function requireOwner(req, res, next) {
  if (!ownerToken) return res.status(503).json({ error: "Owner access is not configured." });
  const supplied = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const suppliedBuffer = Buffer.from(supplied);
  const ownerBuffer = Buffer.from(ownerToken);
  if (suppliedBuffer.length !== ownerBuffer.length || !timingSafeEqual(suppliedBuffer, ownerBuffer)) {
    return res.status(401).json({ error: "Owner authentication required." });
  }
  next();
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/coin-requests", async (req, res) => {
  try {
    const signature = typeof req.body?.paymentSignature === "string" ? req.body.paymentSignature : "";
    const payer = new PublicKey(req.body?.payer).toBase58();
    const coin = normalizeCoinRequest(req.body?.coin, req.body?.poolContributionLamports);
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) {
      return res.status(400).json({ error: "A valid Mainnet payment signature is required." });
    }

    const entries = await readQueue();
    const existing = entries.find((entry) => entry.paymentSignature === signature);
    if (existing) {
      if (existing.payer !== payer) return res.status(409).json({ error: "Payment signature is already assigned to another wallet." });
      return res.json(privateReceipt(existing));
    }

    const transaction = await mainnet.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) return res.status(425).json({ error: "Payment is not visible as confirmed on Mainnet yet. Retry verification; do not send again." });
    if (!verifyPoolContributionPayment(transaction, { signature, payer, expectedLamports: coin.poolContributionLamports })) {
      return res.status(402).json({ error: "Confirmed transaction does not match the required payment amount, recipient, and payer." });
    }

    const entry = await withQueueLock(async () => {
      const currentEntries = await readQueue();
      const duplicate = currentEntries.find((item) => item.paymentSignature === signature);
      if (duplicate) {
        if (duplicate.payer !== payer) throw Object.assign(new Error("Payment signature is already assigned to another wallet."), { statusCode: 409 });
        return duplicate;
      }
      const timestamp = new Date().toISOString();
      const request = {
        requestId: randomUUID(),
        receiptToken: randomBytes(32).toString("base64url"),
        status: "waiting_for_creator",
        createdAt: timestamp,
        updatedAt: timestamp,
        payer,
        paymentSignature: signature,
        poolContributionLamports: coin.poolContributionLamports,
        coin,
      };
      await writeQueue([...currentEntries, request]);
      return request;
    });
    return res.status(201).json(privateReceipt(entry));
  } catch (error) {
    const statusCode = error.statusCode || (error instanceof TypeError ? 400 : 400);
    return res.status(statusCode).json({ error: error.message || "Could not verify or queue this request." });
  }
});

app.get("/api/coin-requests/status", async (req, res) => {
  try {
    const receiptToken = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!receiptToken) return res.status(401).json({ error: "Request receipt token required." });
    const entries = await readQueue();
    const entry = entries.find((item) => item.receiptToken === receiptToken);
    if (!entry) return res.status(404).json({ error: "Request receipt not found." });
    return res.json(privateReceipt(entry));
  } catch {
    return res.status(500).json({ error: "Could not retrieve request status." });
  }
});

app.get("/api/owner/coin-requests", requireOwner, async (_req, res) => {
  try {
    const entries = await readQueue();
    return res.json(entries.map(({ receiptToken, ...entry }) => entry));
  } catch {
    return res.status(500).json({ error: "Could not retrieve creator queue." });
  }
});

app.patch("/api/owner/coin-requests/:requestId", requireOwner, async (req, res) => {
  const validStatuses = new Set(["waiting_for_creator", "in_progress", "ready"]);
  const status = req.body?.status;
  if (!validStatuses.has(status)) return res.status(400).json({ error: "Unsupported request status." });
  try {
    const entry = await withQueueLock(async () => {
      const entries = await readQueue();
      const index = entries.findIndex((item) => item.requestId === req.params.requestId);
      if (index < 0) return null;
      entries[index] = { ...entries[index], status, updatedAt: new Date().toISOString() };
      await writeQueue(entries);
      return entries[index];
    });
    if (!entry) return res.status(404).json({ error: "Request not found." });
    return res.json({ requestId: entry.requestId, status: entry.status, updatedAt: entry.updatedAt });
  } catch {
    return res.status(500).json({ error: "Could not update request status." });
  }
});

if (!apiOnly) app.use(express.static(path.resolve("dist")));

app.listen(port, "0.0.0.0", () => {
  console.log(`AI.Token ${apiOnly ? "queue API" : "server"} listening on port ${port}`);
  if (!production && ownerToken) console.log(`Private owner queue token: ${ownerToken}`);
});