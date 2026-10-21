const CACHE = "donghwa-shell-v70";
const FILES = [
  "./ui-controls.js",
  "./assets/council/watercolor-portraits.webp",
  "./story-reading-context.js",
  "./story-quality/dist/patterns.js",
  "./checks-panel.js",
  "./finalize-cleanup.js",
  "./story-quality/data/worlds.json",
  "./story-quality/dist/engines/anthropic.js",
  "./story-quality/dist/engines/openaiCompat.js",
  "./story-quality/dist/expand.js",
  "./story-quality/dist/worlds.js",
  "./story-quality/gold/bad_examples.json",
  "./story-quality/gold/gold_outlines_part1.json",
  "./story-quality/gold/gold_outlines_part2.json",
  "./story-generation/plot-contract.js",
  "./story-generation/outline-normalize.js",
  "./story-generation/book-revision.js",
  "./story-generation/craft-rules.js",
  "./story-generation/arc-rules.js",
  "./story-generation/prompt-policy.js",
  "./story-generation/orchestration.js",
  "./story-generation/council.js",
  "./story-generation/council-avatars.js",
  "./story-generation/council-room.js",
  "./story-generation/stop-report.js",
  "./story-generation/coherence.js",
  "./story-generation/book-coherence.js",
  "./story-generation/quality-adapter.js",
  "./story-generation/quality-gates.js",
  "./story-generation/quality-settings.js",
  "./story-quality/data/gesture_dictionary.json",
  "./story-quality/data/inventories.json",
  "./story-quality/data/plot_patterns.json",
  "./story-quality/dist/banList.js",
  "./story-quality/dist/beamSearch.js",
  "./story-quality/dist/catchphrase.js",
  "./story-quality/dist/childSimulator.js",
  "./story-quality/dist/composeSeed.js",
  "./story-quality/dist/gestures.js",
  "./story-quality/dist/index.js",
  "./story-quality/dist/outlinePrompt.js",
  "./story-quality/dist/pipeline.js",
  "./story-quality/dist/plotCheck.js",
  "./story-quality/dist/prompts.js",
  "./story-quality/dist/retrieval.js",
  "./story-quality/dist/richThenSimplify.js",
  "./story-quality/dist/types.js",
  "./story-quality/dist/util.js",
  "./story-quality/dist/weeklyCoach.js",
  "./full-auto-control.js",
  "./full-auto.js",
  "./full-auto-ui.js",
  "./simple-create.js",
  "./story-generation/page-tools.js",
  "./story-generation/auto-materials.js",
  "./story-generation/scene-briefs.js",
  "./story-generation/richness.js",
  "./story-generation/staging.js",
  "./image-generation/scene-prompt.js",
  "./image-generation/identity.js",
  "./place-types.js",
  "./image-generation/image-diversity.js",
  "./story-generation/vocab/sensory_en.json",
  "./story-generation/vocab/sensory_ko.json",
  "./story-generation/vocab/emotion_tell_ko.json",
  "./story-generation/vocab/onomatopoeia_ko.json",
  "./story-generation/vocab/onomatopoeia_en.json",
  "./cloud-sync.js",
  "./family-auth.js",
  "./family-auth-ui.js",
  "./library-storage.js",
  "./transient-retry.js",
  "./device-transfer.js",
  "./image-generation/scene-continuity.js",
  "./story-generation/pagination.js",
  "./world-variations.js",
  "./background-sheets.js",
  "./text-generation/models.js",
  "./text-generation/model-list.js",
  "./text-generation/providers.js",
  "./text-generation/settings-ui.js",
  "./story-generation/schemas.js",
  "./story-generation/pipeline.js",
  "./story-generation/opening-prose.js",
  "./story-generation/demo.js",
  "./story-generation/checker.js",
  "./story-generation/continuity.js",
  "./story-generation/ui.js",
  "./story-generation/story.css",
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./engine.js",
  "./output.js",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/hero.png",
  "./image-generation/index.js",
  "./image-generation/providers.js",
  "./image-generation/styles.js",
  "./image-generation/world.js",
  "./image-generation/vault.js",
  "./image-generation/credential-validation.js",
  "./image-generation/assets.js",
  "./image-generation/pipeline.js",
  "./image-generation/settings-ui.js",
  "./management.js",
  "./photo-materials.js",
  "./companions.js",
  "./reading-levels.js",
  "./book-layout.js",
  "./reading-checker.js",
  "./page-rhythm.js",
  "./reading-ui.js",
  "./reading-messages.js",
  "./credential-errors.js",
  "./levels.json",
  "./reading-vocab.js",
  "./style-studio.js",
  "./wardrobe.js",
  "./wardrobe-translation.js",
  "./audio-playback.js",
  "./image-generation/models.js",
  "./image-generation/story-renderer.js",
];
const ALLOWED = new Set(
  FILES.map((path) => new URL(path, self.registration.scope).pathname),
);
// 파일 하나가 실패해도 나머지 셸은 캐시되도록 개별 추가하고, 설치 자체는 실패시키지 않습니다.
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(
          FILES.map((path) => cache.add(path).catch(() => null)),
        ),
      )
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("donghwa-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (!ALLOWED.has(url.pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && !response.redirected && response.type !== "opaque") {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(CACHE)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {}),
          );
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || Response.error()),
      ),
  );
});
