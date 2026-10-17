import { missingCredentialError } from "../credential-errors.js";
import {
  createImageGenerator,
  generateImage as generateWithProvider,
} from "./providers.js";
import { getActiveWorld } from "./world.js";
import { getCredential } from "./vault.js";

export {
  createImageGenerator,
  createImageEngine,
  imageEngineCapabilities,
  ENGINE_IDS,
  ENGINE_METADATA,
} from "./providers.js";
export {
  ENGINE_MODELS,
  getEngineModel,
  estimateImageCost,
  estimateBookCost,
} from "./models.js";
export { StoryRenderer, renderImageRequest } from "./story-renderer.js";
export { STYLE_PRESETS, getStylePreset } from "./styles.js";

/** The bound plugin exposes exactly generateImage({prompt,stylePreset,referenceImages,seed,size,quality}). */
export function createWorldImagePlugin(getState) {
  return {
    async generateImage(request) {
      const state = getState();
      const world = getActiveWorld(state);
      const engine = world.imageEngine;
      const config = { ...(world.providerConfig?.[engine] || {}) };
      delete config.apiKey;
      delete config.key;
      delete config.token;
      const apiKey =
        engine === "sample" ||
        config.transport === "proxy" ||
        config.proxyEndpoint
          ? null
          : await getCredential(engine);
      if (
        !["sample", "local"].includes(engine) &&
        !apiKey &&
        !config.proxyEndpoint &&
        config.transport !== "proxy"
      )
        throw missingCredentialError(
          "부모 설정에서 그림 엔진의 API 키를 등록해 주세요.",
          engine,
          "image",
        );
      return generateWithProvider(request, {
        engine,
        config: { ...config, apiKey: apiKey || undefined },
      });
    },
  };
}
