import { clusterApiUrl, Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createSolPaymentInstruction, CREATOR_PROFILE_ADDON_LAMPORTS, COIN_REQUEST_BASE_PAYMENT_LAMPORTS, COIN_REQUEST_SECURITY_FEE_LAMPORTS, FIXED_COIN_REQUEST_PAYMENT_LAMPORTS, formatSolAmount, parsePoolContribution, PAYMENT_RECIPIENT_ADDRESS } from "./payment.js";
import { normalizeJpegUrl } from "./logo-url.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#token-form");
const nameInput = $("#token-name");
const symbolInput = $("#token-symbol");
const supplyInput = $("#token-supply");
const imageUrlInput = $("#token-image-url");
const imageFileInput = $("#token-image-file");
const marketCapInput = $("#market-cap-target");
const decimalsInput = $("#token-decimals");
const mintAuthorityInput = $("#mint-authority");
const freezeAuthorityInput = $("#freeze-authority");
const creatorExtrasToggle = $("#creator-extras");
const creatorExtrasFields = $("#creator-extras-fields");
const creatorExtrasInputs = {
  creatorName: $("#creator-name"),
  websiteUrl: $("#creator-website"),
  xUrl: $("#creator-x"),
  telegramUrl: $("#creator-telegram"),
  discordUrl: $("#creator-discord"),
  description: $("#creator-description"),
};
const feePaymentButton = $("#confirm-fee-payment");
const mainnetConnection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
const draftKey = "ait-token-studio-draft-v1";
const receiptKey = "ait-token-private-request-v1";
const pendingKey = "ait-token-pending-payment-v1";

let walletPublicKey = null;
let observedWalletProvider = null;
let localLogoObjectUrl = null;
let currentPlan = null;
let reviewedPayment = null;
let activeRequest = null;
let pendingPayment = null;
let isSubmittingPayment = false;
let statusFetchActive = false;
let statusTimer = null;

const preview = {
  name: $("#preview-name"),
  symbol: $("#preview-symbol"),
  supply: $("#preview-supply"),
  marketCap: $("#preview-market-cap"),
  impliedPrice: $("#preview-implied-price"),
  decimals: $("#preview-decimals"),
  avatarInitial: $("#token-avatar-initial"),
  avatarImage: $("#token-avatar-image"),
  logoImage: $("#token-logo-preview"),
  glyph: $("#art-glyph"),
  network: $("#preview-network"),
};

function getWalletProvider() {
  return window.phantom?.solana || window.solana;
}

function getPaymentLamports(extrasEnabled) {
  return FIXED_COIN_REQUEST_PAYMENT_LAMPORTS + (extrasEnabled ? CREATOR_PROFILE_ADDON_LAMPORTS : 0n);
}

function getPaymentBreakdown(extrasEnabled) {
  const base = formatSolAmount(COIN_REQUEST_BASE_PAYMENT_LAMPORTS);
  const securityFee = formatSolAmount(COIN_REQUEST_SECURITY_FEE_LAMPORTS);
  const extras = extrasEnabled ? ` + ${formatSolAmount(CREATOR_PROFILE_ADDON_LAMPORTS)} SOL creator profile bundle` : "";
  return `${base} SOL request + ${securityFee} SOL security fee (30%)${extras}`;
}

function getDraft() {
  const extrasEnabled = creatorExtrasToggle.checked;
  return {
    name: nameInput.value.trim(),
    symbol: symbolInput.value.trim().toUpperCase(),
    imageUrl: imageUrlInput.value.trim(),
    supply: supplyInput.value,
    marketCapTarget: marketCapInput.value,
    poolContributionSol: formatSolAmount(getPaymentLamports(extrasEnabled)),
    decimals: decimalsInput.value,
    mintAuthority: mintAuthorityInput.checked,
    freezeAuthority: freezeAuthorityInput.checked,
    creatorExtras: {
      enabled: extrasEnabled,
      creatorName: creatorExtrasInputs.creatorName.value.trim(),
      websiteUrl: creatorExtrasInputs.websiteUrl.value.trim(),
      xUrl: creatorExtrasInputs.xUrl.value.trim(),
      telegramUrl: creatorExtrasInputs.telegramUrl.value.trim(),
      discordUrl: creatorExtrasInputs.discordUrl.value.trim(),
      description: creatorExtrasInputs.description.value.trim(),
    },
    network: "devnet",
  };
}

function updatePaymentSummary() {
  const enabled = creatorExtrasToggle.checked;
  creatorExtrasFields.hidden = !enabled;
  for (const input of Object.values(creatorExtrasInputs)) input.disabled = !enabled;
  $("#creator-extras-charge").hidden = !enabled;
  $("#payment-total").textContent = `${formatSolAmount(getPaymentLamports(enabled))} SOL`;
}

function updateWalletControls() {
  const provider = getWalletProvider();
  $("#phantom-install").hidden = Boolean(provider?.isPhantom);
  if (!walletPublicKey) $("#wallet-label").textContent = provider?.isPhantom ? "Connect Phantom" : "Phantom not detected";
}

function updatePreview() {
  const draft = getDraft();
  const firstCharacter = draft.name.charAt(0).toUpperCase() || "A";
  preview.name.textContent = draft.name || "Your coin";
  preview.symbol.textContent = draft.symbol || "TICKER";
  preview.supply.textContent = Number(draft.supply || 0).toLocaleString("en-US");
  const targetMarketCap = Number(draft.marketCapTarget || 0);
  preview.marketCap.textContent = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(targetMarketCap);
  preview.impliedPrice.textContent = `~${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(targetMarketCap / Number(draft.supply || 1))} / token`;
  preview.decimals.textContent = draft.decimals;
  preview.avatarInitial.textContent = firstCharacter;
  preview.glyph.textContent = firstCharacter;
  preview.network.textContent = "DEVNET";
  $("#mint-tag").textContent = draft.mintAuthority ? "RETAINED" : "REVOKED";
  $("#freeze-tag").textContent = draft.freezeAuthority ? "RETAINED" : "REVOKED";
  $("#mint-tag").classList.toggle("retained", draft.mintAuthority);
  $("#freeze-tag").classList.toggle("retained", draft.freezeAuthority);
  $("#authority-warning").hidden = !(draft.mintAuthority || draft.freezeAuthority);

  let logoUrl = localLogoObjectUrl;
  if (!logoUrl && draft.imageUrl) {
    try {
      logoUrl = normalizeJpegUrl(draft.imageUrl);
      $("#logo-status").textContent = "Public JPG preview loaded. It is not uploaded to the token.";
    } catch (error) { $("#logo-status").textContent = error.message; }
  }
  preview.logoImage.hidden = !logoUrl;
  preview.avatarImage.hidden = !logoUrl;
  preview.glyph.hidden = Boolean(logoUrl);
  if (logoUrl) {
    preview.logoImage.src = logoUrl;
    preview.avatarImage.src = logoUrl;
  } else {
    preview.logoImage.removeAttribute("src");
    preview.avatarImage.removeAttribute("src");
  }
  $("#clear-logo").disabled = !logoUrl;
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey));
    if (!saved || typeof saved !== "object") return;
    nameInput.value = typeof saved.name === "string" ? saved.name.slice(0, 32) : "";
    symbolInput.value = typeof saved.symbol === "string" ? saved.symbol.slice(0, 10) : "";
    imageUrlInput.value = typeof saved.imageUrl === "string" ? saved.imageUrl.slice(0, 2000) : "";
    supplyInput.value = String(saved.supply || "1000000000");
    marketCapInput.value = String(saved.marketCapTarget || "1000000000");
    decimalsInput.value = ["0", "2", "6", "9"].includes(String(saved.decimals)) ? String(saved.decimals) : "6";
    mintAuthorityInput.checked = saved.mintAuthority === true;
    freezeAuthorityInput.checked = saved.freezeAuthority === true;
    const savedExtras = saved.creatorExtras && typeof saved.creatorExtras === "object" ? saved.creatorExtras : {};
    creatorExtrasToggle.checked = savedExtras.enabled === true;
    creatorExtrasInputs.creatorName.value = typeof savedExtras.creatorName === "string" ? savedExtras.creatorName.slice(0, 64) : "";
    creatorExtrasInputs.websiteUrl.value = typeof savedExtras.websiteUrl === "string" ? savedExtras.websiteUrl.slice(0, 500) : "";
    creatorExtrasInputs.xUrl.value = typeof savedExtras.xUrl === "string" ? savedExtras.xUrl.slice(0, 500) : "";
    creatorExtrasInputs.telegramUrl.value = typeof savedExtras.telegramUrl === "string" ? savedExtras.telegramUrl.slice(0, 500) : "";
    creatorExtrasInputs.discordUrl.value = typeof savedExtras.discordUrl === "string" ? savedExtras.discordUrl.slice(0, 500) : "";
    creatorExtrasInputs.description.value = typeof savedExtras.description === "string" ? savedExtras.description.slice(0, 280) : "";
    $("#draft-status-text").textContent = "Draft restored";
  } catch {
    $("#draft-status-text").textContent = "Draft storage unavailable";
  }
}

function validateDraft() {
  const draft = getDraft();
  const errors = [];
  for (const input of [nameInput, symbolInput, supplyInput, marketCapInput, imageUrlInput, ...Object.values(creatorExtrasInputs)]) input.removeAttribute("aria-invalid");
  if (!draft.name || draft.name.length > 32) {
    errors.push("Coin name must be 1–32 characters.");
    nameInput.setAttribute("aria-invalid", "true");
  }
  if (!/^[A-Z0-9]{1,10}$/.test(draft.symbol)) {
    errors.push("Ticker must contain 1–10 letters or numbers.");
    symbolInput.setAttribute("aria-invalid", "true");
  }
  if (draft.imageUrl) {
    try { normalizeJpegUrl(draft.imageUrl); } catch (error) {
      errors.push(error.message);
      imageUrlInput.setAttribute("aria-invalid", "true");
    }
  }
  if (draft.creatorExtras.enabled) {
    const extras = draft.creatorExtras;
    if (!extras.creatorName && !extras.websiteUrl && !extras.xUrl && !extras.telegramUrl && !extras.discordUrl && !extras.description) {
      errors.push("Enter at least one creator detail for the selected add-on.");
      creatorExtrasInputs.creatorName.setAttribute("aria-invalid", "true");
    }
    for (const [key, label] of [["websiteUrl", "Website"], ["xUrl", "X profile"], ["telegramUrl", "Telegram link"], ["discordUrl", "Discord link"]]) {
      const value = extras[key];
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error();
      } catch {
        errors.push(`${label} must be a valid HTTPS URL.`);
        creatorExtrasInputs[key].setAttribute("aria-invalid", "true");
      }
    }
  }
  if (localLogoObjectUrl && !draft.imageUrl) errors.push("A local logo preview cannot be sent to the creator. Add a public JPG URL or clear the local image.");
  const supply = Number(draft.supply);
  if (!Number.isSafeInteger(supply) || supply < 1 || supply > 1_000_000_000_000) {
    errors.push("Supply must be a whole number from 1 to 1 trillion.");
    supplyInput.setAttribute("aria-invalid", "true");
  } else if (BigInt(supply) * 10n ** BigInt(draft.decimals) > 18_446_744_073_709_551_615n) {
    errors.push("Supply multiplied by decimals exceeds Solana's 64-bit token amount limit.");
    supplyInput.setAttribute("aria-invalid", "true");
  }
  const marketCapTarget = Number(draft.marketCapTarget);
  if (!Number.isSafeInteger(marketCapTarget) || marketCapTarget < 1 || marketCapTarget > 1_000_000_000_000_000) {
    errors.push("Market cap target must be a whole USD amount from 1 to 1 quadrillion.");
    marketCapInput.setAttribute("aria-invalid", "true");
  }
  return errors;
}

function readPending() {
  try { return JSON.parse(sessionStorage.getItem(pendingKey) || "null"); } catch { return null; }
}

function readReceipt() {
  try { return JSON.parse(localStorage.getItem(receiptKey) || "null"); } catch { return null; }
}

function setFeeStatus(message, isError = false) {
  $("#fee-status").textContent = message;
  $("#fee-status").classList.toggle("negative", isError);
}

function showQueueProgress(title, message, loading) {
  $("#queue-result-panel").hidden = false;
  $("#queue-spinner").hidden = !loading;
  $("#queue-result-title").textContent = title;
  $("#queue-result-title").classList.remove("negative");
  $("#queue-result-copy").textContent = message;
  $("#queue-receipt").hidden = true;
  $("#queue-private-note").hidden = true;
  $("#retry-queue").hidden = true;
  $("#refresh-queue-status").hidden = true;
}

function statusLabel(status) {
  if (status === "ready") return "Ready";
  if (status === "in_progress") return "Creator is working on it";
  return "Waiting for creator";
}

function showReceipt(receipt) {
  activeRequest = receipt;
  try { localStorage.setItem(receiptKey, JSON.stringify(receipt)); } catch { /* receipt still shown for this page session */ }
  try { sessionStorage.removeItem(pendingKey); } catch { /* private status remains available from the server */ }
  reviewedPayment = null;
  $("#fee-review-panel").hidden = true;
  $("#queue-result-panel").hidden = false;
  $("#queue-spinner").hidden = true;
  $("#queue-result-title").classList.remove("negative");
  $("#queue-result-title").textContent = "Payment confirmed";
  const paymentAmount = formatSolAmount(BigInt(receipt.poolContributionLamports));
  const extrasCopy = receipt.creatorExtrasEnabled ? " Your creator profile bundle is included." : "";
  $("#queue-result-copy").textContent = `Your ${paymentAmount} SOL payment is confirmed.${extrasCopy} ${receipt.name} (${receipt.symbol}) is in the creator's queue. Track its progress here.`;
  $("#queue-receipt").hidden = false;
  $("#queue-private-note").hidden = false;
  $("#queue-request-id").textContent = receipt.requestId;
  $("#queue-coin-name").textContent = `${receipt.name} (${receipt.symbol})`;
  $("#queue-pool-contribution").textContent = `${formatSolAmount(BigInt(receipt.poolContributionLamports))} SOL`;
  $("#queue-request-status").textContent = statusLabel(receipt.status);
  $("#refresh-queue-status").hidden = false;
  $("#retry-queue").hidden = true;
  $("#queue-payment-explorer").href = `https://explorer.solana.com/tx/${encodeURIComponent(receipt.paymentSignature)}`;
  $("#queue-payment-explorer").hidden = false;
  if (!statusTimer) statusTimer = window.setInterval(refreshRequestStatus, 30_000);
}

async function refreshRequestStatus() {
  if (statusFetchActive) return;
  const receipt = activeRequest || readReceipt();
  if (!receipt?.receiptToken) return;
  statusFetchActive = true;
  try {
    const response = await fetch("/api/coin-requests/status", { headers: { Authorization: `Bearer ${receipt.receiptToken}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not refresh request status.");
    showReceipt(payload);
  } catch (error) {
    $("#queue-result-copy").textContent = `${error.message} Your private receipt remains saved in this browser.`;
  } finally { statusFetchActive = false; }
}

async function connectWallet() {
  const provider = getWalletProvider();
  const label = $("#wallet-label");
  if (!provider?.isPhantom) {
    label.textContent = "Phantom not found";
    $("#phantom-install").hidden = false;
    return;
  }
  try {
    const response = await provider.connect();
    walletPublicKey = new PublicKey(response.publicKey.toString());
    const address = walletPublicKey.toBase58();
    label.textContent = `${address.slice(0, 4)}…${address.slice(-4)}`;
    $("#phantom-install").hidden = true;
    $("#draft-status-text").textContent = "Phantom connected · fee paid on Mainnet";
    if (observedWalletProvider !== provider) {
      provider.on?.("accountChanged", (publicKey) => {
        walletPublicKey = publicKey ? new PublicKey(publicKey.toString()) : null;
        label.textContent = walletPublicKey ? `${walletPublicKey.toBase58().slice(0, 4)}…${walletPublicKey.toBase58().slice(-4)}` : "Connect Phantom";
        updateFeeControls();
      });
      observedWalletProvider = provider;
    }
  } catch (error) {
    label.textContent = error?.code === 4001 ? "Connect Phantom" : "Connection failed";
  }
  updateFeeControls();
  if (walletPublicKey && !$("#fee-review-panel").hidden && reviewedPayment && !reviewedPayment.payer) {
    await prepareFeeReview();
  }
}

function updateFeeControls() {
  const provider = getWalletProvider();
  const connected = Boolean(provider?.isPhantom && walletPublicKey);
  const acknowledged = $("#ack-fee-transfer").checked && $("#ack-creator-queue").checked;
  feePaymentButton.disabled = !reviewedPayment || !connected || !acknowledged || isSubmittingPayment;
  feePaymentButton.textContent = isSubmittingPayment
    ? "Waiting for Mainnet confirmation…"
    : !connected
      ? "Connect Phantom to continue"
      : !reviewedPayment
        ? "Review the contribution first"
      : !acknowledged
        ? "Confirm both acknowledgements"
        : `Finish your coin · Pay ${formatSolAmount(BigInt(reviewedPayment.poolContributionLamports))} SOL`;
}

async function prepareFeeReview() {
  if (!currentPlan || JSON.stringify(currentPlan) !== JSON.stringify(getDraft())) {
    setFeeStatus("Coin details changed. Review the request again before paying.", true);
    return;
  }
  const pending = readPending();
  if (pending?.signature) {
    showQueueProgress("Payment verification pending", "A payment was submitted. Retrying verification for that same transaction; do not pay again.", true);
    await submitQueueRequest(pending);
    return;
  }
  if (activeRequest && activeRequest.status !== "ready") {
    await refreshRequestStatus();
    return;
  }
  const provider = getWalletProvider();
  const payer = provider?.publicKey && new PublicKey(provider.publicKey.toString());
  if (!provider?.isPhantom || !walletPublicKey || !payer?.equals(walletPublicKey)) {
    const amount = parsePoolContribution(currentPlan.poolContributionSol);
    reviewedPayment = { payer: "", coin: { ...currentPlan }, poolContributionLamports: amount.toString() };
    $("#fee-payer").textContent = "Connect Phantom to identify payer";
    $("#fee-recipient").textContent = PAYMENT_RECIPIENT_ADDRESS;
    $("#fee-pool-amount").textContent = `${formatSolAmount(amount)} SOL`;
    $("#fee-payment-breakdown").textContent = getPaymentBreakdown(currentPlan.creatorExtras.enabled);
    $("#fee-network-cost").textContent = "Connect Phantom for estimate";
    $("#fee-review-panel").hidden = false;
    $("#ack-fee-transfer").checked = false;
    $("#ack-creator-queue").checked = false;
    setFeeStatus("Review the amount and recipient, then connect Phantom in the header to continue.");
    updateFeeControls();
    return;
  }
  if (payer.toBase58() === PAYMENT_RECIPIENT_ADDRESS) {
    setFeeStatus("Connect a different payer wallet; the recipient cannot pay itself.", true);
    return;
  }
  try {
    $("#fee-status").textContent = "Checking current Mainnet network fee…";
    const blockhash = await mainnetConnection.getLatestBlockhash("confirmed");
    const poolContributionLamports = parsePoolContribution(currentPlan.poolContributionSol);
    const transaction = new Transaction({ feePayer: payer, ...blockhash }).add(createSolPaymentInstruction(payer, poolContributionLamports));
    const fee = await mainnetConnection.getFeeForMessage(transaction.compileMessage(), "confirmed");
    reviewedPayment = { payer: payer.toBase58(), coin: { ...currentPlan }, poolContributionLamports: poolContributionLamports.toString() };
    $("#fee-payer").textContent = payer.toBase58();
    $("#fee-recipient").textContent = PAYMENT_RECIPIENT_ADDRESS;
    $("#fee-pool-amount").textContent = `${formatSolAmount(poolContributionLamports)} SOL`;
    $("#fee-payment-breakdown").textContent = getPaymentBreakdown(currentPlan.creatorExtras.enabled);
    $("#fee-network-cost").textContent = fee.value === null ? "Shown in Phantom" : `${formatSolAmount(BigInt(fee.value))} SOL estimated; Phantom shows final fee`;
    $("#fee-review-panel").hidden = false;
    $("#ack-fee-transfer").checked = false;
    $("#ack-creator-queue").checked = false;
    setFeeStatus("Verify the address and amount. Phantom will display the transfer before signing.");
    updateFeeControls();
  } catch (error) {
    reviewedPayment = null;
    setFeeStatus(error.message || "Could not prepare the Mainnet payment review.", true);
  }
}

async function submitQueueRequest(pending) {
  showQueueProgress("Verifying your payment…", "Confirming the Mainnet transfer and saving your request to the private creator queue.", true);
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch("/api/coin-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentSignature: pending.signature,
          payer: pending.payer,
          poolContributionLamports: pending.poolContributionLamports,
          coin: pending.coin,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        showReceipt(payload);
        return true;
      }
      lastError = new Error(payload.error || `Queue verification failed (${response.status}).`);
      if (![425, 429].includes(response.status) && response.status < 500) break;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  $("#queue-spinner").hidden = true;
  $("#queue-result-title").textContent = "Payment sent; verification is still pending";
  $("#queue-result-title").classList.add("negative");
  $("#queue-result-copy").textContent = `${lastError?.message || "Queue service is temporarily unavailable."} Do not send another contribution. Retry verification for this same transaction.`;
  $("#retry-queue").hidden = false;
  return false;
}

async function retryQueueVerification() {
  const pending = readPending();
  if (pending?.signature) await submitQueueRequest(pending);
  else await refreshRequestStatus();
}

async function payServiceFee() {
  if (!reviewedPayment || isSubmittingPayment || !$("#ack-fee-transfer").checked || !$("#ack-creator-queue").checked) return;
  if (JSON.stringify(reviewedPayment.coin) !== JSON.stringify(getDraft())) {
    setFeeStatus("Coin details changed. Review the request again before paying.", true);
    return;
  }
  const provider = getWalletProvider();
  const payer = provider?.publicKey && new PublicKey(provider.publicKey.toString());
  if (!provider?.isPhantom || !walletPublicKey || !payer?.equals(walletPublicKey) || payer.toBase58() !== reviewedPayment.payer) {
    reviewedPayment = null;
    $("#fee-review-panel").hidden = true;
    setFeeStatus("Phantom account changed. Reconnect and review the transfer again.", true);
    return;
  }
  try {
    sessionStorage.setItem("ait-coin-payment-storage-check", "1");
    sessionStorage.removeItem("ait-coin-payment-storage-check");
  } catch {
    setFeeStatus("Enable browser session storage so a submitted payment can be recovered safely.", true);
    return;
  }

  isSubmittingPayment = true;
  updateFeeControls();
  $("#fee-review-panel").setAttribute("aria-busy", "true");
  let signature = "";
  try {
    const latestBlockhash = await mainnetConnection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: payer, ...latestBlockhash }).add(createSolPaymentInstruction(payer, BigInt(reviewedPayment.poolContributionLamports)));
    const signingKey = provider.publicKey && new PublicKey(provider.publicKey.toString());
    if (!signingKey?.equals(payer)) throw new Error("Phantom account changed. No payment was sent.");
    const result = await provider.signAndSendTransaction(transaction);
    signature = result.signature;
    pendingPayment = { signature, payer: payer.toBase58(), coin: reviewedPayment.coin, poolContributionLamports: reviewedPayment.poolContributionLamports, submittedAt: new Date().toISOString() };
    sessionStorage.setItem(pendingKey, JSON.stringify(pendingPayment));
    $("#fee-explorer").href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
    $("#fee-explorer").hidden = false;
    $("#fee-review-panel").hidden = true;
    $("#queue-result-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    const confirmation = await mainnetConnection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
    if (confirmation.value.err) {
      sessionStorage.removeItem(pendingKey);
      pendingPayment = null;
      showQueueProgress("Payment transaction failed", "Mainnet confirmed that this transaction failed. No creator request was created. Review the explorer before deciding what to do next.", false);
      return;
    }
    await submitQueueRequest(pendingPayment);
  } catch (error) {
    if (signature && pendingPayment) {
      await submitQueueRequest(pendingPayment);
    } else {
      setFeeStatus(error?.code === 4001 ? "Payment cancelled in Phantom. No request was submitted." : error.message || "Payment was not submitted.", true);
    }
  } finally {
    isSubmittingPayment = false;
    $("#fee-review-panel").removeAttribute("aria-busy");
    updateFeeControls();
  }
}

function validateCoinRequest() {
  const errors = validateDraft();
  $("#form-error").hidden = errors.length === 0;
  $("#form-error").textContent = errors.join(" ");
  if (errors.length) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return false;
  }
  currentPlan = getDraft();
  $("#fee-review-panel").hidden = true;
  $("#queue-result-panel").hidden = true;
  return true;
}

for (const input of [nameInput, symbolInput, supplyInput, marketCapInput, imageUrlInput, decimalsInput, mintAuthorityInput, freezeAuthorityInput]) {
  input.addEventListener("input", updatePreview);
  input.addEventListener("change", updatePreview);
}

imageUrlInput.addEventListener("input", () => {
  if (localLogoObjectUrl && imageUrlInput.value.trim()) {
    URL.revokeObjectURL(localLogoObjectUrl);
    localLogoObjectUrl = null;
    imageFileInput.value = "";
    $("#logo-file-name").textContent = "No local image selected";
  }
  updatePreview();
});

imageFileInput.addEventListener("change", () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;
  const isJpeg = file.type === "image/jpeg" || (!file.type && /\.jpe?g$/i.test(file.name));
  if (!isJpeg || file.size > 5 * 1024 * 1024) {
    imageFileInput.value = "";
    $("#logo-status").textContent = !isJpeg ? "Choose a JPG or JPEG image." : "Image must be 5 MB or smaller.";
    return;
  }
  if (localLogoObjectUrl) URL.revokeObjectURL(localLogoObjectUrl);
  localLogoObjectUrl = URL.createObjectURL(file);
  imageUrlInput.value = "";
  $("#logo-file-name").textContent = `${file.name} · local preview`;
  $("#logo-status").textContent = "Local image preview only; it is not uploaded or attached to the request. Paste a public JPG URL if you want the creator to receive it.";
  updatePreview();
});

$("#clear-logo").addEventListener("click", () => {
  if (localLogoObjectUrl) URL.revokeObjectURL(localLogoObjectUrl);
  localLogoObjectUrl = null;
  imageUrlInput.value = "";
  imageFileInput.value = "";
  $("#logo-file-name").textContent = "No local image selected";
  $("#logo-status").textContent = "The image is previewed only. It is not uploaded or attached to the request.";
  updatePreview();
});

for (const image of [preview.logoImage, preview.avatarImage]) {
  image.addEventListener("error", () => {
    image.hidden = true;
    preview.glyph.hidden = false;
    preview.avatarImage.hidden = true;
    $("#logo-status").textContent = "This image could not be loaded. Check that the JPG URL is public and direct.";
  });
}

symbolInput.addEventListener("input", () => {
  const start = symbolInput.selectionStart;
  const end = symbolInput.selectionEnd;
  symbolInput.value = symbolInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  symbolInput.setSelectionRange(start, end);
});

$("#save-button").addEventListener("click", () => {
  try {
    localStorage.setItem(draftKey, JSON.stringify(getDraft()));
    $("#draft-status-text").textContent = "Draft saved locally";
  } catch {
    $("#draft-status-text").textContent = "Could not save draft";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (validateCoinRequest()) await prepareFeeReview();
});

creatorExtrasToggle.addEventListener("change", updatePaymentSummary);
$("#wallet-button").addEventListener("click", connectWallet);
$("#copy-payment-address").addEventListener("click", async (event) => {
  try {
    await navigator.clipboard.writeText(PAYMENT_RECIPIENT_ADDRESS);
    event.currentTarget.textContent = "Copied";
    window.setTimeout(() => { event.currentTarget.textContent = "Copy"; }, 1500);
  } catch {
    setFeeStatus("Clipboard is unavailable. Select and copy the displayed payment address.", true);
  }
});
$("#cancel-fee-review").addEventListener("click", () => {
  reviewedPayment = null;
  $("#fee-review-panel").hidden = true;
  updateFeeControls();
});
for (const checkbox of [$("#ack-fee-transfer"), $("#ack-creator-queue")]) checkbox.addEventListener("change", updateFeeControls);
feePaymentButton.addEventListener("click", payServiceFee);
$("#retry-queue").addEventListener("click", retryQueueVerification);
$("#refresh-queue-status").addEventListener("click", refreshRequestStatus);

loadDraft();
updatePaymentSummary();
updatePreview();
updateWalletControls();
updateFeeControls();

const existingReceipt = readReceipt();
if (existingReceipt?.receiptToken) {
  activeRequest = existingReceipt;
  showReceipt(existingReceipt);
  refreshRequestStatus();
} else {
  pendingPayment = readPending();
  if (pendingPayment?.signature) submitQueueRequest(pendingPayment);
}