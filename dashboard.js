import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { fetchPoolCandles, fetchTrendingPools, REFRESH_INTERVAL_MS } from "./market-data.js";
import { createSolPaymentInstruction, formatSolAmount, parseSolAmount, PAYMENT_RECIPIENT } from "./payment.js";

const $ = (selector) => document.querySelector(selector);
const chartElement = $("#price-chart");
const chartState = $("#chart-state");
const marketState = $("#market-state");
const rowContainer = $("#market-rows");
const paymentRecipient = PAYMENT_RECIPIENT;
const mainnetConnection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

let markets = [];
let selectedMarket = null;
let selectedInterval = "5m";
let activeFilter = "all";
let searchText = "";
let sortField = "priceChange.h24";
let sortDirection = -1;
let currentTool = "cursor";
let pendingTrendPoint = null;
let refreshInProgress = false;
let candleRequestId = 0;
let observedWalletProvider = null;
let walletPublicKey = null;
let drawings = [];
let renderedDrawings = [];
let watchlist = loadWatchlist();
let chartController = null;
let feedController = null;
let reviewedPayment = null;
let paymentFeeEstimate = null;
let paymentSignature = null;
let isSendingPayment = false;
let paymentReviewRequestId = 0;

const chart = createChart(chartElement, {
  autoSize: true,
  height: 448,
  layout: {
    background: { type: ColorType.Solid, color: "#11261f" },
    textColor: "#8ba397",
    fontFamily: '"DM Mono", "Courier New", monospace',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: "rgba(147, 178, 159, 0.08)" },
    horzLines: { color: "rgba(147, 178, 159, 0.08)" },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: "#759684", labelBackgroundColor: "#25523d" },
    horzLine: { color: "#759684", labelBackgroundColor: "#25523d" },
  },
  rightPriceScale: { borderColor: "rgba(147, 178, 159, 0.16)", scaleMargins: { top: 0.08, bottom: 0.24 } },
  timeScale: { borderColor: "rgba(147, 178, 159, 0.16)", timeVisible: true, secondsVisible: false, rightOffset: 5 },
  localization: { locale: "en-US" },
});

const candleSeries = chart.addSeries(CandlestickSeries, {
  upColor: "#68d6a2",
  downColor: "#f07b63",
  borderUpColor: "#68d6a2",
  borderDownColor: "#f07b63",
  wickUpColor: "#68d6a2",
  wickDownColor: "#f07b63",
  priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
});
const volumeSeries = chart.addSeries(HistogramSeries, {
  priceFormat: { type: "volume" },
  priceScaleId: "volume",
  lastValueVisible: false,
  priceLineVisible: false,
});
chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false, borderVisible: false });

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem("ait-pulse-watchlist-v1") || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((address) => typeof address === "string") : []);
  } catch {
    return new Set();
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem("ait-pulse-watchlist-v1", JSON.stringify([...watchlist]));
  } catch {
    $("#feed-status-text").textContent = "Watchlist could not be saved in this browser";
  }
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "--";
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : value >= 0.01 ? 6 : 9;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
}

function formatCompact(value) {
  return Number.isFinite(value) ? compactCurrency.format(value) : "--";
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAddress(address) {
  return address ? `${address.slice(0, 5)}…${address.slice(-5)}` : "--";
}

function changeClass(value) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

function getSortValue(market, field) {
  return field === "priceChange.h24" ? market.priceChange.h24 : market[field];
}

function getVisibleMarkets() {
  const query = searchText.toLowerCase();
  const visible = markets.filter((market) => {
    if (activeFilter === "gainers" && market.priceChange.h24 <= 0) return false;
    if (activeFilter === "losers" && market.priceChange.h24 >= 0) return false;
    if (activeFilter === "watchlist" && !watchlist.has(market.address)) return false;
    return !query || `${market.name} ${market.symbol} ${market.address}`.toLowerCase().includes(query);
  });
  visible.sort((left, right) => {
    const leftValue = getSortValue(left, sortField);
    const rightValue = getSortValue(right, sortField);
    if (typeof leftValue === "string") return leftValue.localeCompare(rightValue) * sortDirection;
    return (Number(leftValue) - Number(rightValue)) * sortDirection;
  });
  return visible;
}

function makeTableCell(className, text) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderMarkets() {
  const visible = getVisibleMarkets();
  rowContainer.replaceChildren();
  $("#pair-count").textContent = `${visible.length} ${visible.length === 1 ? "pair" : "pairs"}`;
  $("#watchlist-count").textContent = String(watchlist.size);

  for (const market of visible) {
    const row = document.createElement("tr");
    row.className = market.address === selectedMarket?.address ? "market-row selected" : "market-row";
    row.dataset.address = market.address;
    row.tabIndex = 0;
    row.setAttribute("aria-label", `Select ${market.name}, ${market.symbol}`);

    const assetCell = document.createElement("td");
    const asset = document.createElement("div");
    asset.className = "asset-cell";
    const star = document.createElement("button");
    star.className = watchlist.has(market.address) ? "watch-button watched" : "watch-button";
    star.type = "button";
    star.dataset.watchAddress = market.address;
    star.title = watchlist.has(market.address) ? "Remove from watchlist" : "Add to watchlist";
    star.setAttribute("aria-label", star.title);
    star.textContent = watchlist.has(market.address) ? "★" : "☆";
    const avatar = document.createElement("span");
    avatar.className = "asset-avatar";
    avatar.textContent = market.symbol.slice(0, 1).toUpperCase();
    if (market.imageUrl) {
      const image = document.createElement("img");
      image.src = market.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove(), { once: true });
      avatar.replaceChildren(image);
    }
    const identity = document.createElement("span");
    identity.className = "asset-identity";
    const name = document.createElement("strong");
    name.textContent = market.name;
    const symbol = document.createElement("small");
    symbol.textContent = `${market.symbol} · ${formatAddress(market.address)}`;
    identity.append(name, symbol);
    asset.append(star, avatar, identity);
    assetCell.append(asset);

    row.append(
      assetCell,
      makeTableCell("numeric-cell", formatPrice(market.priceUsd)),
      makeTableCell(`numeric-cell ${changeClass(market.priceChange.h24)}`, formatPercent(market.priceChange.h24)),
      makeTableCell("numeric-cell volume-cell", formatCompact(market.volume24h)),
    );
    rowContainer.append(row);
  }

  marketState.hidden = visible.length > 0;
  if (!markets.length) {
    marketState.hidden = false;
    marketState.textContent = "No markets loaded yet.";
  } else if (visible.length === 0) {
    marketState.hidden = false;
    marketState.textContent = "No pairs match this view.";
  }
}

function renderMarketSummary() {
  const totalVolume = markets.reduce((sum, market) => sum + market.volume24h, 0);
  const gainers = markets.filter((market) => market.priceChange.h24 > 0).length;
  const top = [...markets].sort((left, right) => right.priceChange.h24 - left.priceChange.h24)[0];
  $("#stat-pairs").textContent = String(markets.length);
  $("#stat-volume").textContent = formatCompact(totalVolume);
  $("#stat-gainers").textContent = markets.length ? `${gainers} / ${markets.length}` : "--";
  $("#stat-top-mover").textContent = top ? top.symbol : "--";
  $("#stat-top-mover").title = top?.name || "";
  $("#stat-top-change").textContent = top ? formatPercent(top.priceChange.h24) : "waiting for feed";
  $("#stat-top-change").className = top ? changeClass(top.priceChange.h24) : "";
  $("#stat-updated").textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
}

function renderSelectedMarket() {
  if (!selectedMarket) return;
  $("#chart-title").textContent = selectedMarket.name;
  $("#chart-symbol").textContent = `${selectedMarket.symbol} / USD`;
  $("#chart-dex").textContent = selectedMarket.dex;
  $("#chart-address").textContent = formatAddress(selectedMarket.address);
  $("#selected-initial").textContent = selectedMarket.symbol.slice(0, 1).toUpperCase();
  const icon = $("#selected-icon");
  icon.style.backgroundImage = selectedMarket.imageUrl ? `url("${selectedMarket.imageUrl.replaceAll('"', "")}")` : "none";
  icon.classList.toggle("has-image", Boolean(selectedMarket.imageUrl));
  $("#chart-price").textContent = formatPrice(selectedMarket.priceUsd);
  $("#chart-change").textContent = formatPercent(selectedMarket.priceChange.h24);
  $("#chart-change").className = changeClass(selectedMarket.priceChange.h24);
  const external = $("#chart-external");
  external.href = `https://www.geckoterminal.com/solana/pools/${encodeURIComponent(selectedMarket.poolAddress)}`;
  external.hidden = false;

  $("#flow-volume").textContent = formatCompact(selectedMarket.volume5m);
  $("#flow-trades").textContent = `${selectedMarket.buys5m.toLocaleString()} buys / ${selectedMarket.sells5m.toLocaleString()} sells`;
  $("#flow-volume-24h").textContent = formatCompact(selectedMarket.volume24h);
  $("#flow-trades-24h").textContent = `${selectedMarket.buys24h.toLocaleString()} / ${selectedMarket.sells24h.toLocaleString()}`;
  const fiveMinuteTrades = selectedMarket.buys5m + selectedMarket.sells5m;
  const buyRatio = fiveMinuteTrades ? selectedMarket.buys5m / fiveMinuteTrades : 0;
  $("#buy-pressure-label").textContent = fiveMinuteTrades ? `${Math.round(buyRatio * 100)}% buys` : "No 5m trades";
  $("#buy-pressure-bar").style.width = `${Math.round(buyRatio * 100)}%`;
  $("#buy-pressure-bar").classList.toggle("seller-dominant", buyRatio < 0.5);
  $("#risk-liquidity").textContent = formatCompact(selectedMarket.liquidityUsd);
  $("#risk-pool-age").textContent = selectedMarket.poolCreatedAt
    ? formatPoolAge(selectedMarket.poolCreatedAt)
    : "Not reported";
  $("#risk-change").textContent = formatPercent(selectedMarket.priceChange.h24);
  $("#risk-change").className = changeClass(selectedMarket.priceChange.h24);
  $("#risk-source-link").href = external.href;
}

function formatPoolAge(createdAt) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return "Not reported";
  const ageHours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (ageHours < 24) return `${ageHours}h`;
  const ageDays = Math.floor(ageHours / 24);
  return ageDays < 365 ? `${ageDays}d` : `${(ageDays / 365).toFixed(1)}y`;
}

function drawingStorageKey() {
  return selectedMarket ? `ait-pulse-drawings:${selectedMarket.address}:${selectedInterval}` : "";
}

function persistDrawings() {
  if (!drawingStorageKey()) return;
  try {
    localStorage.setItem(drawingStorageKey(), JSON.stringify(drawings));
  } catch {
    $("#feed-status-text").textContent = "Chart drawings could not be saved in this browser";
  }
}

function removeRenderedDrawings() {
  for (const drawing of renderedDrawings) {
    if (drawing.type === "horizontal") candleSeries.removePriceLine(drawing.line);
    else chart.removeSeries(drawing.series);
  }
  renderedDrawings = [];
}

function renderDrawings() {
  removeRenderedDrawings();
  drawings.forEach((drawing, index) => {
    if (drawing.type === "horizontal") {
      const line = candleSeries.createPriceLine({
        price: drawing.price,
        color: drawing.color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Level",
      });
      renderedDrawings.push({ type: "horizontal", line });
      return;
    }
    const series = chart.addSeries(LineSeries, {
      color: drawing.color || (index % 2 ? "#ef8a67" : "#edd273"),
      lineWidth: 2,
      lineStyle: 0,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const points = [
      { time: drawing.startTime, value: drawing.startPrice },
      { time: drawing.endTime, value: drawing.endPrice },
    ].sort((left, right) => Number(left.time) - Number(right.time));
    series.setData(points);
    renderedDrawings.push({ type: "trend", series });
  });
}

function restoreDrawings() {
  try {
    const saved = JSON.parse(localStorage.getItem(drawingStorageKey()) || "[]");
    drawings = Array.isArray(saved) ? saved.filter((drawing) => drawing && (drawing.type === "horizontal" || drawing.type === "trend")) : [];
  } catch {
    drawings = [];
  }
  renderDrawings();
}

function setDrawingTool(tool) {
  currentTool = tool;
  pendingTrendPoint = null;
  for (const button of document.querySelectorAll(".tool-button[data-tool]")) {
    button.classList.toggle("active", button.dataset.tool === tool);
  }
  chartElement.classList.toggle("drawing-mode", tool !== "cursor");
  const hints = {
    cursor: "",
    trend: "Click two points to place a trend line",
    horizontal: "Click the chart to place a price level",
  };
  const hint = $("#drawing-hint");
  hint.textContent = hints[tool];
  hint.hidden = tool === "cursor";
}

chart.subscribeClick((event) => {
  if (currentTool === "cursor" || !event.point || !event.time) return;
  const price = candleSeries.coordinateToPrice(event.point.y);
  if (!Number.isFinite(price)) return;

  if (currentTool === "horizontal") {
    drawings.push({ type: "horizontal", price, color: "#edd273" });
    renderDrawings();
    persistDrawings();
    return;
  }

  const time = Number(event.time);
  if (!Number.isFinite(time)) return;
  if (!pendingTrendPoint) {
    pendingTrendPoint = { time, price };
    $("#drawing-hint").textContent = "Click the second point to finish the trend line";
    return;
  }
  drawings.push({
    type: "trend",
    startTime: pendingTrendPoint.time,
    startPrice: pendingTrendPoint.price,
    endTime: time,
    endPrice: price,
    color: "#68d6a2",
  });
  pendingTrendPoint = null;
  renderDrawings();
  persistDrawings();
});

async function loadCandles() {
  if (!selectedMarket) return;
  const requestId = ++candleRequestId;
  chartController?.abort();
  chartController = new AbortController();
  chartState.hidden = false;
  chartState.innerHTML = '<span class="spinner"></span><span>Loading candle history…</span>';
  try {
    const candles = await fetchPoolCandles(selectedMarket.poolAddress, selectedInterval, { signal: chartController.signal });
    if (requestId !== candleRequestId) return;
    if (!candles.length) throw new Error("No candle history is available for this pair.");
    candleSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    volumeSeries.setData(candles.map(({ time, volume, close, open }) => ({
      time,
      value: volume,
      color: close >= open ? "rgba(104, 214, 162, 0.36)" : "rgba(240, 123, 99, 0.36)",
    })));
    chart.timeScale().fitContent();
    $("#chart-candle-count").textContent = `${candles.length} candles`;
    chartState.hidden = true;
    restoreDrawings();
  } catch (error) {
    if (error.name === "AbortError" || requestId !== candleRequestId) return;
    chartState.textContent = error.message || "Could not load chart history.";
    chartState.hidden = false;
  }
}

async function refreshMarkets({ initial = false } = {}) {
  if (refreshInProgress) return;
  refreshInProgress = true;
  feedController?.abort();
  feedController = new AbortController();
  $("#feed-status-dot").classList.add("loading");
  $("#feed-status-dot").classList.remove("error");
  $("#feed-status-text").textContent = initial ? "Loading trending pools…" : "Refreshing market feed…";
  if (initial) {
    marketState.hidden = false;
    marketState.innerHTML = '<span class="spinner"></span><span>Finding active pools…</span>';
  }
  try {
    const previousAddress = selectedMarket?.address;
    const latest = await fetchTrendingPools({ pages: 3, signal: feedController.signal });
    if (!latest.length) throw new Error("No trending Solana pools returned by the data source.");
    markets = latest.slice(0, 60);
    selectedMarket = markets.find((market) => market.address === previousAddress) || markets[0];
    renderMarketSummary();
    renderMarkets();
    renderSelectedMarket();
    $("#feed-status-dot").classList.remove("loading");
    $("#feed-status-text").textContent = "Live · refreshes every 30s";
    await loadCandles();
  } catch (error) {
    if (error.name !== "AbortError") {
      $("#feed-status-dot").classList.remove("loading");
      $("#feed-status-dot").classList.add("error");
      $("#feed-status-text").textContent = error.message || "Market feed unavailable";
      if (!markets.length) {
        marketState.hidden = false;
        marketState.textContent = "Market data unavailable. Use refresh to try again.";
      }
    }
  } finally {
    refreshInProgress = false;
  }
}

function selectMarket(address) {
  const market = markets.find((item) => item.address === address);
  if (!market) return;
  selectedMarket = market;
  renderMarkets();
  renderSelectedMarket();
  loadCandles();
  if (window.matchMedia("(max-width: 980px)").matches) {
    $("#market-chart").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setSort(field) {
  if (sortField === field) sortDirection *= -1;
  else {
    sortField = field;
    sortDirection = field === "name" ? 1 : -1;
  }
  for (const button of document.querySelectorAll(".sort-button")) {
    button.classList.toggle("active", button.dataset.sort === sortField);
    button.querySelector("span").textContent = button.dataset.sort === sortField ? (sortDirection === 1 ? "↑" : "↓") : "↕";
  }
  renderMarkets();
}

function getWalletProvider() {
  return window.phantom?.solana || window.solana;
}

async function connectWallet() {
  const provider = getWalletProvider();
  const label = $("#wallet-label");
  if (!provider?.isPhantom) {
    $("#phantom-install").hidden = false;
    label.textContent = "Phantom not found";
    updatePaymentControls();
    return;
  }
  try {
    const response = await provider.connect();
    walletPublicKey = new PublicKey(response.publicKey.toString());
    const address = walletPublicKey.toBase58();
    label.textContent = `${address.slice(0, 4)}…${address.slice(-4)}`;
    $("#phantom-install").hidden = true;
    if (observedWalletProvider !== provider) {
      provider.on?.("accountChanged", (publicKey) => {
        walletPublicKey = publicKey ? new PublicKey(publicKey.toString()) : null;
        label.textContent = walletPublicKey ? `${walletPublicKey.toBase58().slice(0, 4)}…${walletPublicKey.toBase58().slice(-4)}` : "Connect Phantom";
        updatePaymentControls();
      });
      observedWalletProvider = provider;
    }
    updatePaymentControls();
  } catch (error) {
    if (error.code !== 4001) label.textContent = "Connection failed";
  }
}

function updatePaymentControls() {
  const provider = getWalletProvider();
  const walletReady = Boolean(provider?.isPhantom && walletPublicKey);
  const acknowledgementsReady = $("#ack-transfer").checked && $("#ack-no-return").checked;
  const button = $("#confirm-payment");
  button.disabled = !reviewedPayment || !walletReady || !acknowledgementsReady || isSendingPayment || Boolean(paymentSignature);
  if (paymentSignature) button.textContent = "Transfer submitted";
  else if (isSendingPayment) button.textContent = "Sending on Mainnet…";
  else if (!walletReady) button.textContent = "Connect Phantom to continue";
  else if (!acknowledgementsReady) button.textContent = "Confirm both acknowledgements";
  else button.textContent = "Confirm and send SOL with Phantom";
}

function showPaymentError(message) {
  const error = $("#payment-error");
  error.textContent = message;
  error.hidden = false;
}

async function reviewPayment(event) {
  event.preventDefault();
  if (paymentSignature || isSendingPayment) {
    showPaymentError("A transfer has already been submitted in this session. Check its explorer status before taking further action.");
    return;
  }
  const requestId = ++paymentReviewRequestId;
  const error = $("#payment-error");
  error.hidden = true;
  reviewedPayment = null;
  paymentFeeEstimate = null;
  try {
    const lamports = parseSolAmount($("#payment-amount").value);
    const provider = getWalletProvider();
    if (!provider?.isPhantom || !walletPublicKey) {
      throw new Error("Connect Phantom before reviewing a payment.");
    }
    const currentKey = provider.publicKey && new PublicKey(provider.publicKey.toString());
    if (!currentKey?.equals(walletPublicKey)) throw new Error("Phantom account changed. Reconnect and review again.");
    if (currentKey.equals(paymentRecipient)) throw new Error("The connected wallet is the recipient address. Connect a different payer wallet.");

    reviewedPayment = { lamports, payer: walletPublicKey.toBase58() };
    const latestBlockhash = await mainnetConnection.getLatestBlockhash("confirmed");
    const feeTransaction = new Transaction({
      feePayer: walletPublicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }).add(createSolPaymentInstruction(walletPublicKey, lamports));
    const feeResponse = await mainnetConnection.getFeeForMessage(feeTransaction.compileMessage(), "confirmed");
    if (requestId !== paymentReviewRequestId) return;
    const currentReviewWallet = provider.publicKey && new PublicKey(provider.publicKey.toString());
    if (!currentReviewWallet?.equals(walletPublicKey) || currentReviewWallet.toBase58() !== reviewedPayment.payer) {
      reviewedPayment = null;
      throw new Error("Phantom account changed while preparing the review. Review the payment again.");
    }
    paymentFeeEstimate = feeResponse.value;
    $("#review-amount").textContent = `${formatSolAmount(lamports)} SOL`;
    $("#review-payer").textContent = reviewedPayment.payer;
    $("#review-recipient").textContent = paymentRecipient.toBase58();
    $("#review-network-fee").textContent = paymentFeeEstimate === null
      ? "Shown in Phantom"
      : `${formatSolAmount(BigInt(paymentFeeEstimate))} SOL est. · Phantom shows final fee`;
    $("#payment-status").textContent = "Verify the address and amount. Phantom will show the final network fee before signing.";
    $("#payment-review").hidden = false;
    $("#ack-transfer").checked = false;
    $("#ack-no-return").checked = false;
    updatePaymentControls();
  } catch (error) {
    if (requestId !== paymentReviewRequestId) return;
    reviewedPayment = null;
    showPaymentError(error.message || "Could not prepare the payment review.");
  }
}

async function sendPayment() {
  if (!reviewedPayment || isSendingPayment || paymentSignature) return;
  if (!$("#ack-transfer").checked || !$("#ack-no-return").checked) return;
  const provider = getWalletProvider();
  const currentKey = provider?.publicKey && new PublicKey(provider.publicKey.toString());
  if (!provider?.isPhantom || !walletPublicKey || !currentKey?.equals(walletPublicKey) || currentKey.toBase58() !== reviewedPayment.payer) {
    reviewedPayment = null;
    $("#payment-review").hidden = true;
    $("#payment-status").textContent = "Phantom account changed. Reconnect and review the payment again.";
    updatePaymentControls();
    return;
  }

  isSendingPayment = true;
  $("#payment-status").textContent = "Requesting your Phantom signature for a Solana Mainnet transfer…";
  updatePaymentControls();
  let signature = null;
  try {
    const latestBlockhash = await mainnetConnection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
      feePayer: walletPublicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }).add(createSolPaymentInstruction(walletPublicKey, reviewedPayment.lamports));
    const signingKey = provider.publicKey && new PublicKey(provider.publicKey.toString());
    if (!signingKey?.equals(walletPublicKey)) throw new Error("Phantom account changed. No transfer was sent.");

    const result = await provider.signAndSendTransaction(transaction);
    signature = result.signature;
    paymentSignature = signature;
    updatePaymentControls();
    $("#payment-status").textContent = "Transfer submitted. Waiting for Solana Mainnet confirmation…";
    const explorer = $("#payment-explorer");
    explorer.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
    explorer.hidden = false;

    const confirmation = await mainnetConnection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
    if (confirmation.value.err) {
      $("#payment-status").textContent = "The transaction was confirmed as failed on-chain. No payment was made; review the explorer details before trying again.";
      paymentSignature = null;
      signature = null;
      reviewedPayment = null;
      $("#payment-review").hidden = true;
      $("#ack-transfer").checked = false;
      $("#ack-no-return").checked = false;
      return;
    }
    $("#payment-status").textContent = "Transfer confirmed on Solana Mainnet. This is a payment only; no tokens or returns were issued.";
  } catch (error) {
    if (signature) {
      $("#payment-status").textContent = `Transfer was submitted but confirmation is unavailable. Do not send again until you check the explorer. ${error.message || ""}`;
    } else {
      $("#payment-status").textContent = error.code === 4001
        ? "Transfer cancelled in Phantom. No payment was sent."
        : error.message || "Could not send payment.";
    }
  } finally {
    isSendingPayment = false;
    $("#payment-amount").disabled = Boolean(paymentSignature);
    $("#payment-form").querySelector("button[type='submit']").disabled = Boolean(paymentSignature);
    updatePaymentControls();
  }
}

rowContainer.addEventListener("click", (event) => {
  const watchButton = event.target.closest("[data-watch-address]");
  if (watchButton) {
    const { watchAddress } = watchButton.dataset;
    if (watchlist.has(watchAddress)) watchlist.delete(watchAddress);
    else watchlist.add(watchAddress);
    saveWatchlist();
    renderMarkets();
    return;
  }
  const row = event.target.closest("[data-address]");
  if (row) selectMarket(row.dataset.address);
});

rowContainer.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr[data-address]")) {
    event.preventDefault();
    selectMarket(event.target.dataset.address);
  }
});

$("#market-search").addEventListener("input", (event) => {
  searchText = event.target.value.trim();
  renderMarkets();
});

$("#market-search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.currentTarget.value = "";
    searchText = "";
    renderMarkets();
    event.currentTarget.blur();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    $("#market-search").focus();
  }
});

for (const button of document.querySelectorAll(".filter-button")) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("active", item === button));
    renderMarkets();
  });
}

for (const button of document.querySelectorAll(".sort-button")) {
  button.addEventListener("click", () => setSort(button.dataset.sort));
}

for (const button of document.querySelectorAll(".interval-button")) {
  button.addEventListener("click", () => {
    if (button.dataset.interval === selectedInterval) return;
    selectedInterval = button.dataset.interval;
    document.querySelectorAll(".interval-button").forEach((item) => item.classList.toggle("active", item === button));
    pendingTrendPoint = null;
    loadCandles();
  });
}

for (const button of document.querySelectorAll(".tool-button[data-tool]")) {
  button.addEventListener("click", () => setDrawingTool(button.dataset.tool));
}

$("#clear-drawings").addEventListener("click", () => {
  drawings = [];
  pendingTrendPoint = null;
  renderDrawings();
  persistDrawings();
  setDrawingTool("cursor");
});

$("#refresh-button").addEventListener("click", () => refreshMarkets());
$("#wallet-button").addEventListener("click", connectWallet);
$("#payment-form").addEventListener("submit", reviewPayment);
$("#payment-amount").addEventListener("input", () => {
  if (paymentSignature || isSendingPayment) return;
  paymentReviewRequestId += 1;
  reviewedPayment = null;
  paymentFeeEstimate = null;
  $("#payment-review").hidden = true;
  $("#payment-error").hidden = true;
  $("#ack-transfer").checked = false;
  $("#ack-no-return").checked = false;
  updatePaymentControls();
});
for (const acknowledgement of [$("#ack-transfer"), $("#ack-no-return")]) {
  acknowledgement.addEventListener("change", updatePaymentControls);
}
$("#confirm-payment").addEventListener("click", sendPayment);
$("#cancel-payment").addEventListener("click", () => {
  paymentReviewRequestId += 1;
  reviewedPayment = null;
  $("#payment-review").hidden = true;
  $("#ack-transfer").checked = false;
  $("#ack-no-return").checked = false;
  updatePaymentControls();
});
$("#copy-recipient").addEventListener("click", async (event) => {
  try {
    await navigator.clipboard.writeText(paymentRecipient.toBase58());
    event.currentTarget.textContent = "✓";
    window.setTimeout(() => { event.currentTarget.textContent = "▢"; }, 1500);
  } catch {
    $("#payment-status").textContent = "Clipboard access is unavailable. Select and copy the displayed recipient address.";
  }
});
updatePaymentControls();

refreshMarkets({ initial: true });
window.setInterval(() => {
  if (document.visibilityState === "visible") refreshMarkets();
}, REFRESH_INTERVAL_MS);