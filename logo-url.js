export function normalizeJpegUrl(value) {
  const source = value.trim();
  if (!source) return "";

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Enter a valid public JPG or JPEG URL.");
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Logo URLs must use HTTP or HTTPS.");
  }
  if (!/\.jpe?g$/i.test(url.pathname)) {
    throw new Error("Logo URLs must point directly to a .jpg or .jpeg image.");
  }
  return url.href;
}