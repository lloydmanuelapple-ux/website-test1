import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJpegUrl } from "./logo-url.js";

test("accepts direct JPG URLs with query strings", () => {
  assert.equal(
    normalizeJpegUrl("https://cdn.example.com/coin.JPG?width=256"),
    "https://cdn.example.com/coin.JPG?width=256",
  );
  assert.equal(normalizeJpegUrl("https://images.example.com/coin.jpeg"), "https://images.example.com/coin.jpeg");
});

test("allows an empty logo URL", () => {
  assert.equal(normalizeJpegUrl("  "), "");
});

test("rejects unsafe protocols and non-JPEG URLs", () => {
  assert.throws(() => normalizeJpegUrl("javascript:alert(1)"), /HTTP or HTTPS/);
  assert.throws(() => normalizeJpegUrl("https://example.com/coin.png"), /\.jpg or \.jpeg/);
  assert.throws(() => normalizeJpegUrl("not-a-url"), /valid public JPG or JPEG/);
});