const API_ROOT = "https://api.geckoterminal.com/api/v2";

export const REFRESH_INTERVAL_MS = 30_000;

export const CHART_INTERVALS = {
  "1m": { timeframe: "minute", aggregate: 1, limit: 300 },
  "5m": { timeframe: "minute", aggregate: 5, limit: 288 },
  "15m": { timeframe: "minute", aggregate: 15, limit: 192 },
  "1h": { timeframe: "hour", aggregate: 1, limit: 168 },
  "4h": { timeframe: "hour", aggregate: 4, limit: 120 },
  "1d": { timeframe: "day", aggregate: 1, limit: 90 },
};

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeTrendingPools(payload) {
  const includedTokens = new Map(
    (payload?.included ?? [])
      .filter((item) => item.type === "token")
      .map((item) => [item.id, item.attributes]),
  );
  const poolsByToken = new Map();

  for (const pool of payload?.data ?? []) {
    const attributes = pool.attributes;
    const tokenId = pool.relationships?.base_token?.data?.id;
    const token = includedTokens.get(tokenId);
    const tokenAddress = token?.address;
    const poolAddress = attributes?.address;
    if (!tokenAddress || !poolAddress) continue;

    const volume = numberOrZero(attributes.volume_usd?.h24);
    const liquidity = numberOrZero(attributes.reserve_in_usd);
    const candidate = {
      address: tokenAddress,
      poolAddress,
      name: token.name || attributes.name?.split(" / ")[0] || "Unknown token",
      symbol: token.symbol || "?",
      imageUrl: token.image_url || "",
      priceUsd: numberOrZero(attributes.base_token_price_usd),
      priceChange: {
        m5: numberOrZero(attributes.price_change_percentage?.m5),
        h1: numberOrZero(attributes.price_change_percentage?.h1),
        h6: numberOrZero(attributes.price_change_percentage?.h6),
        h24: numberOrZero(attributes.price_change_percentage?.h24),
      },
      volume5m: numberOrZero(attributes.volume_usd?.m5),
      volume24h: volume,
      liquidityUsd: liquidity,
      marketCapUsd: numberOrZero(attributes.market_cap_usd) || numberOrZero(attributes.fdv_usd),
      buys5m: numberOrZero(attributes.transactions?.m5?.buys),
      sells5m: numberOrZero(attributes.transactions?.m5?.sells),
      buys24h: numberOrZero(attributes.transactions?.h24?.buys),
      sells24h: numberOrZero(attributes.transactions?.h24?.sells),
      poolCreatedAt: attributes.pool_created_at || null,
      dex: pool.relationships?.dex?.data?.id || "Solana DEX",
    };

    const previous = poolsByToken.get(tokenAddress);
    if (!previous || candidate.liquidityUsd > previous.liquidityUsd) {
      poolsByToken.set(tokenAddress, candidate);
    }
  }

  return [...poolsByToken.values()];
}

export function normalizeCandles(payload) {
  const candles = payload?.data?.attributes?.ohlcv_list ?? [];
  return candles
    .filter((candle) => Array.isArray(candle) && candle.length >= 6 && candle.slice(0, 6).every((value) => Number.isFinite(Number(value))))
    .map(([time, open, high, low, close, volume]) => ({
      time: Number(time),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }))
    .sort((left, right) => left.time - right.time);
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Market data request failed (${response.status}).`);
  return response.json();
}

export async function fetchTrendingPools({ signal, pages = 3 } = {}) {
  const pageNumbers = Array.from({ length: pages }, (_, index) => index + 1);
  const payloads = await Promise.all(pageNumbers.map((page) => fetchJson(
    `${API_ROOT}/networks/solana/trending_pools?include=base_token%2Cdex&page=${page}`,
    signal,
  )));
  const pools = payloads.flatMap(normalizeTrendingPools);
  return [...new Map(pools.map((pool) => [pool.address, pool])).values()];
}

export async function fetchPoolCandles(poolAddress, interval = "5m", { signal } = {}) {
  const settings = CHART_INTERVALS[interval] || CHART_INTERVALS["5m"];
  const query = new URLSearchParams({
    aggregate: String(settings.aggregate),
    limit: String(settings.limit),
    currency: "usd",
    token: "base",
  });
  const payload = await fetchJson(
    `${API_ROOT}/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/${settings.timeframe}?${query}`,
    signal,
  );
  return normalizeCandles(payload);
}