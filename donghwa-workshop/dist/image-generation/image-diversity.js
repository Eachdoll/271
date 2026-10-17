/** Browser-only visual heuristics. An unavailable check never blocks a saved picture. */
export function fingerprintPixels(data, width = 9, height = 8) {
  if (width !== 9 || height !== 8 || !data || data.length < width * height * 4)
    throw new Error("dHash requires 9 × 8 RGBA pixels.");
  const gray = [],
    hues = [];
  let brightness = 0,
    saturation = 0,
    hueX = 0,
    hueY = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (data[i + 3] ?? 255) / 255,
      r = (data[i] * alpha + 255 * (1 - alpha)) / 255,
      g = (data[i + 1] * alpha + 255 * (1 - alpha)) / 255,
      b = (data[i + 2] * alpha + 255 * (1 - alpha)) / 255;
    gray.push(0.299 * r + 0.587 * g + 0.114 * b);
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min,
      s = max ? delta / max : 0;
    let hue = 0;
    if (delta) {
      hue =
        max === r
          ? ((g - b) / delta + 6) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
      hue *= Math.PI / 3;
    }
    hueX += Math.cos(hue) * s;
    hueY += Math.sin(hue) * s;
    saturation += s;
    brightness += max;
    hues.push(hue);
  }
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      hash =
        (hash << 1n) | BigInt(gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
  return {
    hash: hash.toString(16).padStart(16, "0"),
    brightness: brightness / 72,
    saturation: saturation / 72,
    hue: ((((Math.atan2(hueY, hueX) * 180) / Math.PI) % 360) + 360) % 360,
    algorithm: "dhash-9x8-v1",
  };
}
export function hammingDistance(left, right) {
  if (!/^[\da-f]{16}$/i.test(left || "") || !/^[\da-f]{16}$/i.test(right || ""))
    return null;
  let value = BigInt("0x" + left) ^ BigInt("0x" + right),
    count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}
export function compareImageFingerprints(left, right) {
  const distance = hammingDistance(left?.hash, right?.hash);
  return {
    supported: distance !== null,
    distance,
    tooSimilar: distance !== null && distance < 10,
    threshold: 10,
    estimated: true,
  };
}
export function timeProgressWarning(first, last) {
  if (
    !first ||
    !last ||
    ![first.brightness, last.brightness, first.hue, last.hue].every(
      Number.isFinite,
    )
  )
    return null;
  const brightnessDifference = Math.abs(first.brightness - last.brightness),
    raw = Math.abs(first.hue - last.hue),
    hueDifference = Math.min(raw, 360 - raw);
  const hueComparable =
    Math.min(first.saturation ?? 0, last.saturation ?? 0) > 0.08;
  return brightnessDifference < 0.08 && (!hueComparable || hueDifference < 15)
    ? {
        code: "similar-time-lighting",
        message:
          "첫 쪽과 마지막 쪽의 색·밝기가 비슷해요. 시간대가 달라 보이는지 확인해 주세요.",
        brightnessDifference,
        hueDifference,
        estimated: true,
      }
    : null;
}
export async function analyzeImage(
  imageUrl,
  { signal, createCanvas, loadImage } = {},
) {
  if (signal?.aborted)
    throw new DOMException("그림 검사를 취소했어요.", "AbortError");
  if (
    (!createCanvas && typeof document === "undefined") ||
    (!loadImage && typeof Image === "undefined")
  )
    return { supported: false, reason: "canvas-unavailable" };
  try {
    const canvas = createCanvas
      ? createCanvas(9, 8)
      : Object.assign(document.createElement("canvas"), {
          width: 9,
          height: 8,
        });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { supported: false, reason: "canvas-unavailable" };
    const picture = loadImage
      ? await loadImage(imageUrl)
      : await new Promise((resolve, reject) => {
          const img = new Image();
          let timeout;
          const finish = (error) => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            img.onload = null;
            img.onerror = null;
            error ? reject(error) : resolve(img);
          };
          const abort = () => {
            img.src = "";
            finish(new DOMException("그림 검사를 취소했어요.", "AbortError"));
          };
          img.crossOrigin = "anonymous";
          img.onload = () => finish();
          img.onerror = () => finish(new Error("image-load-failed"));
          timeout = setTimeout(() => {
            img.src = "";
            finish(new Error("image-analysis-timeout"));
          }, 8000);
          signal?.addEventListener("abort", abort, { once: true });
          img.src = imageUrl;
        });
    if (signal?.aborted)
      throw new DOMException("그림 검사를 취소했어요.", "AbortError");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 9, 8);
    context.drawImage(picture, 0, 0, 9, 8);
    return {
      supported: true,
      ...fingerprintPixels(context.getImageData(0, 0, 9, 8).data),
    };
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) throw error;
    return {
      supported: false,
      reason:
        error?.name === "SecurityError"
          ? "canvas-cors-blocked"
          : "image-analysis-unavailable",
    };
  }
}
