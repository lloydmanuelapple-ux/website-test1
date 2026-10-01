import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCandles, normalizeTrendingPools } from "./market-data.js";

test("normalizes trending pools and selects the deepest pool per token", () => {
  const tokenId = "solana_token-address";
  const payload = {
    data: [
      {
        attributes: {
          address: "shallow-pool",
          name: "MOON / SOL",
          base_token_price_usd: "0.25",
          price_change_percentage: { m5: "2.5", h1: "4", h6: "9", h24: "14" },
          volume_usd: { m5: "400", h24: "12000" },
          reserve_in_usd: "8000",
          market_cap_usd: "0",
          fdv_usd: "250000",
          transactions: { m5: { buys: 8, sells: 3 }, h24: { buys: 420, sells: 190 } },
        },
        relationships: {
          base_token: { data: { id: tokenId } },
          dex: { data: { id: "raydium" } },
        },
      },
      {
        attributes: {
          address: "deep-pool",
          name: "MOON / USDC",
          base_token_price_usd: "0.26",
          reserve_in_usd: "16000",
          volume_usd: { h24: "18000" },
        },
        relationships: { base_token: { data: { id: tokenId } } },
      },
      { attributes: { address: "orphan-pool" }, relationships: {} },
    ],
    included: [{
      id: tokenId,
      type: "token",
      attributes: { address: "token-address", name: "Moon Dog", symbol: "MOON", image_url: "https://example.com/moon.png" },
    }],
  };

  assert.deepEqual(normalizeTrendingPools(payload), [{
    address: "token-address",
    poolAddress: "deep-pool",
    name: "Moon Dog",
    symbol: "MOON",
    imageUrl: "https://example.com/moon.png",
    priceUsd: 0.26,
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    volume5m: 0,
    volume24h: 18000,
    liquidityUsd: 16000,
    marketCapUsd: 0,
    buys5m: 0,
    sells5m: 0,
    buys24h: 0,
    sells24h: 0,
    poolCreatedAt: null,
    dex: "Solana DEX",
  }]);
});

test("normalizes OHLCV candles in ascending time order and drops malformed rows", () => {
  const payload = {
    data: {
      attributes: {
        ohlcv_list: [
          [120, "2", "3", "1", "2.5", "40"],
          [60, 1, 2, 0.5, 1.5, 20],
          [180, "bad", 1, 1, 1, 1],
        ],
      },
    },
  };

  assert.deepEqual(normalizeCandles(payload), [
    { time: 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 20 },
    { time: 120, open: 2, high: 3, low: 1, close: 2.5, volume: 40 },
  ]);
});