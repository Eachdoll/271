import {createImageGenerator,generateImage as generateWithProvider} from './providers.js';
import {getActiveWorld} from './world.js';
import {getCredential} from './vault.js';

export {createImageGenerator,ENGINE_IDS,ENGINE_METADATA} from './providers.js';
export {STYLE_PRESETS,getStylePreset} from './styles.js';

/** The bound plugin exposes exactly generateImage({prompt,stylePreset,referenceImages,seed,size,quality}). */
export function createWorldImagePlugin(getState) {
  return {
    async generateImage(request) {
      const state=getState();
      const world=getActiveWorld(state);
      const engine=world.imageEngine;
      const config={...(world.providerConfig?.[engine]||{})};
      delete config.apiKey;delete config.key;delete config.token;
      const apiKey=await getCredential(engine);
      return generateWithProvider(request,{engine,config:{...config,apiKey:apiKey||undefined}});
    }
  };
}
