// Node's fetch cannot read the file: URLs used for browser-served quality data.
// Install a CLI-only file reader and preload before any paid step. HTTP calls
// still use Node's original fetch; browser code and prompts are unchanged.
import { readFile } from "node:fs/promises";
import { loadStoryQualityData } from "../dist/story-generation/quality-adapter.js";

export async function preloadQualityDataForNode() {
  const originalFetch = globalThis.fetch;
  const assetRoot = new URL("../dist/story-quality/", import.meta.url).href;
  const localFetch = async (input, options) => {
    const url = input instanceof URL ? input :
      typeof input === "string" ? new URL(input) : null;
    if (url?.protocol !== "file:") return originalFetch(input, options);
    if (!url.href.startsWith(assetRoot)) {
      throw new Error("The A/B runner only reads local quality assets.");
    }
    return new Response(await readFile(url, {signal: options?.signal}), {
      headers: { "Content-Type": "application/json" },
    });
  };
  globalThis.fetch = localFetch;
  try {
    return await loadStoryQualityData(localFetch, { includeDistilled: true });
  } catch (error) {
    globalThis.fetch = originalFetch;
    throw error;
  }
}
