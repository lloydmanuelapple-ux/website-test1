import { formatSolAmount } from "./payment.js";

const ownerForm = document.querySelector("#owner-auth-form");
const ownerInput = document.querySelector("#owner-token");
const queueStatus = document.querySelector("#queue-status");
const queueRows = document.querySelector("#owner-queue-rows");
const queueState = document.querySelector("#owner-queue-state");
let ownerToken = "";
let requests = [];
let knownRequestIds = null;
let queuePollTimer = null;
let queueLoadActive = false;

function setStatus(message, isError = false) {
  queueStatus.textContent = message;
  queueStatus.classList.toggle("negative", isError);
  queueStatus.classList.toggle("positive", !isError);
}

function addCell(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function formatTime(timestamp) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.valueOf()) ? "--" : parsed.toLocaleString();
}

function addCreatorExtrasCell(row, extras) {
  const cell = document.createElement("td");
  cell.className = "owner-addon-cell";
  if (!extras?.enabled) {
    cell.textContent = "Not selected";
    row.append(cell);
    return;
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "View paid bundle";
  details.append(summary);
  for (const [label, value] of [
    ["Creator", extras.creatorName],
    ["Website", extras.websiteUrl],
    ["X", extras.xUrl],
    ["Telegram", extras.telegramUrl],
    ["Discord", extras.discordUrl],
    ["Description", extras.description],
  ]) {
    if (!value) continue;
    const line = document.createElement("p");
    line.textContent = `${label}: ${value}`;
    details.append(line);
  }
  cell.append(details);
  row.append(cell);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function renderRequests() {
  queueRows.replaceChildren();
  for (const request of requests) {
    const row = document.createElement("tr");
    addCell(row, `${request.coin.name} (${request.coin.symbol})`);
    const walletCell = addCell(row, request.payer);
    walletCell.className = "owner-wallet-cell";
    addCell(row, `${formatSolAmount(BigInt(request.poolContributionLamports))} SOL · confirmed`);
    addCreatorExtrasCell(row, request.coin.creatorExtras);
    addCell(row, formatTime(request.createdAt));
    const statusCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "owner-status-select";
    select.setAttribute("aria-label", `Update ${request.coin.name} request status`);
    for (const [value, label] of [["waiting_for_creator", "Waiting for creator"], ["in_progress", "In progress"], ["ready", "Ready"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = request.status === value;
      select.append(option);
    }
    select.addEventListener("change", () => updateStatus(request, select.value, select));
    statusCell.append(select);
    row.append(statusCell);
    queueRows.append(row);
  }
  queueState.hidden = requests.length > 0;
  if (requests.length === 0) queueState.textContent = "No paid requests yet.";
}

async function loadQueue() {
  if (!ownerToken || queueLoadActive) return;
  queueLoadActive = true;
  setStatus("Loading private queue…");
  queueState.hidden = false;
  queueState.textContent = "Loading paid requests…";
  try {
    const loadedRequests = await requestJson("/api/owner/coin-requests");
    const knownIds = new Set(knownRequestIds || []);
    const newRequests = knownRequestIds ? loadedRequests.filter((request) => !knownIds.has(request.requestId)) : [];
    requests = loadedRequests;
    knownRequestIds = new Set(requests.map((request) => request.requestId));
    renderRequests();
    if (newRequests.length) {
      const names = newRequests.map((request) => `${request.coin.name} (${request.coin.symbol})`).join(", ");
      setStatus(`New confirmed payment${newRequests.length === 1 ? "" : "s"}: ${names}.`);
    } else {
      setStatus(`${requests.length} private ${requests.length === 1 ? "request" : "requests"} loaded.`);
    }
  } catch (error) {
    requests = [];
    queueRows.replaceChildren();
    queueState.hidden = false;
    queueState.textContent = "Could not load the private queue.";
    setStatus(error.message, true);
  } finally {
    queueLoadActive = false;
  }
}

async function updateStatus(request, status, select) {
  select.disabled = true;
  try {
    await requestJson(`/api/owner/coin-requests/${encodeURIComponent(request.requestId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    request.status = status;
    setStatus(`Updated ${request.coin.name} request.`);
  } catch (error) {
    select.value = request.status;
    setStatus(error.message, true);
  } finally {
    select.disabled = false;
  }
}

ownerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ownerToken = ownerInput.value.trim();
  ownerInput.value = "";
  loadQueue();
  if (queuePollTimer) window.clearInterval(queuePollTimer);
  queuePollTimer = window.setInterval(loadQueue, 30_000);
});
document.querySelector("#refresh-queue").addEventListener("click", loadQueue);