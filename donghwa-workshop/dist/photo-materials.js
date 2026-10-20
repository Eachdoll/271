/* Photos stay in this modal's memory. Only a parent's approved drawing is saved. */
import {
  generateImage,
  ENGINE_METADATA,
} from "./image-generation/providers.js";
import { getCredential } from "./image-generation/vault.js";
import {
  getActiveWorld,
  markCharacterSheetConfirmed,
  getWorldStyleReferences,
} from "./image-generation/world.js";
import {
  getStylePreset,
  validateStylePreset,
} from "./image-generation/styles.js";
import { saveImage } from "./image-generation/assets.js";
import { backgroundSettingsKey } from "./background-sheets.js";
import { identityLine, GENDER_CHOICES } from "./image-generation/identity.js";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_ENGINES = new Set(["google", "openai", "bfl", "fal", "local"]);
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`}`;
const abortError = () =>
  new DOMException("사진으로 만들기를 취소했어요.", "AbortError");
let api;
let flow = null;
let configured = false;

export function validatePhotoFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_PHOTOS)
    throw new Error("사진은 1~3장을 골라 주세요.");
  if (files.some((file) => !PHOTO_TYPES.has(file.type)))
    throw new Error("JPG, PNG, WebP 사진만 사용할 수 있어요.");
  if (files.some((file) => !file.size || file.size > MAX_PHOTO_BYTES))
    throw new Error("사진 한 장은 10MB 이하로 골라 주세요.");
  return true;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function decodePhoto(file, signal) {
  throwIfAborted(signal);
  if (globalThis.createImageBitmap) {
    try {
      // Apply the camera's EXIF orientation before flattening the pixels.
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      if (signal?.aborted) {
        bitmap.close();
        throw abortError();
      }
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw abortError();
    }
  }
  const sourceURL = URL.createObjectURL(file);
  const image = new Image();
  image.style.imageOrientation = "from-image";
  try {
    await new Promise((resolve, reject) => {
      const abort = () => {
        image.src = "";
        reject(abortError());
      };
      const finish = (handler) => (value) => {
        signal?.removeEventListener("abort", abort);
        handler(value);
      };
      image.onload = finish(resolve);
      image.onerror = finish(() =>
        reject(
          new Error(
            "사진을 열 수 없어요. 다른 JPG, PNG, WebP 파일을 골라 주세요.",
          ),
        ),
      );
      signal?.addEventListener("abort", abort, { once: true });
      image.src = sourceURL;
    });
    throwIfAborted(signal);
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => {
        image.src = "";
        URL.revokeObjectURL(sourceURL);
      },
    };
  } catch (error) {
    image.src = "";
    URL.revokeObjectURL(sourceURL);
    throw error;
  }
}

/** Local pixel re-encoding removes EXIF/GPS and limits the longest edge to 1600px. */
export async function normalizePhoto(file, { signal } = {}) {
  const decoded = await decodePhoto(file, signal);
  const canvas = document.createElement("canvas");
  try {
    if (!decoded.width || !decoded.height)
      throw new Error("사진의 크기를 읽을 수 없어요.");
    const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이 브라우저에서는 사진을 처리할 수 없어요.");
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    throwIfAborted(signal);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    throwIfAborted(signal);
    if (!blob?.size)
      throw new Error("사진을 처리하지 못했어요. 다른 파일로 시도해 주세요.");
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    decoded.dispose();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The provider receives the exact six common fields, including photos AND style refs. */
export function createPhotoGenerationRequest({
  kind,
  fields,
  photos,
  stylePreset,
  seed,
}) {
  const validation = validateStylePreset(stylePreset);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_PHOTOS)
    throw new Error("사진은 1~3장이 필요해요.");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("시드는 0~2147483647 사이 정수여야 해요.");
  const photoCount = photos.length;
  const prompt =
    kind === "character"
      ? `Create an original illustrated children's storybook character reference sheet inspired by the person or animal in the first ${photoCount} reference photos. Parent-supplied character settings: ${JSON.stringify(fields)}. ${identityLine(fields) ? `${identityLine(fields)} ` : ""}Retain broad recognizable illustrated features such as hairstyle, glasses, clothing and colors, with the parent's written appearance as the final guide. Transform into a clearly stylized drawn character with simplified facial details; do not recreate an actual photographic face or use photorealistic skin. Show the SAME character in a front full-body view, side full-body view, back full-body view, four face expressions (joy, surprise, sadness, upset), and two action poses (walking and waving), on one clean neutral background. Keep the character's identity, proportions, clothes and colors consistent in every view. Only the first ${photoCount} images are identity photos; all later references define the visual style. No labels, captions, names, words, watermarks or logos.`
      : `Create one reusable environment reference sheet of the photographed place for an original children's picture book. References labeled source place layout photo define the photographed place and its geometry, regardless of attachment order. Parent-supplied place facts and fixed layout: ${JSON.stringify(fields)}. Preserve the visible geometry, wall and floor colors, window and door positions, furniture arrangement, paths, trees, building shapes, materials, and recognizable fixed objects from these photos. Use a wide establishing view plus closer detail panels of the SAME exact photographed place and its visible objects. Do not invent unobserved rooms, hidden furniture, additional windows or doors, or an unrelated reverse view. If the photos do not establish a detail, omit that detail rather than guessing. The parent's written fixed layout clarifies the photos and explicitly requested changes. Empty environment: remove people, animals, faces, addresses, license plates, private text, signs and logos. Translate the photographed setting into the active World's illustrated visual style; do not reproduce a photograph. References labeled authoritative style define painting medium and palette only, never place geometry. Keep the same place, colors and layout in every panel for later story scenes. No words, captions, labels, arrows, watermarks or logos.`;
  return {
    prompt,
    stylePreset: clone(stylePreset),
    referenceImages: [
      ...photos.map((imageUrl, index) => ({
        ...(imageUrl instanceof Blob ? { blob: imageUrl } : { imageUrl }),
        role: kind === "character" ? "character_front" : "background",
        label: `source ${kind === "character" ? "identity" : "place layout"} photo ${index + 1}`,
      })),
      ...stylePreset.styleRefImages.map((imageUrl, index) => ({
        imageUrl,
        role: "style_sheet",
        label: "authoritative style " + (index + 1),
      })),
    ],
    seed,
    size: "1536x1024",
    quality: "draft",
  };
}

/** Store only an approved drawing; source-photo blobs and object URLs never enter the library. */
export function createPhotoBackgroundMaterial({
  fields,
  candidate,
  world,
  mode = "photo",
  confirmedAt = new Date().toISOString(),
}) {
  if (!candidate?.imageAssetId) throw new Error("저장할 배경 그림이 없어요.");
  if (mode !== "import" && candidate.meta?.quality !== "final")
    throw new Error("최종 화질 배경을 생성한 뒤 확정해 주세요.");
  if (
    candidate.meta?.worldId !== world.id ||
    candidate.meta.worldRevision !== world.revision ||
    candidate.meta.engine !== world.imageEngine ||
    candidate.meta.stylePresetId !== world.stylePresetId
  )
    throw new Error(
      "현재 World와 같은 엔진·화풍으로 만든 배경을 확정해 주세요.",
    );
  const item = {
    name: fields.name,
    nameEn: fields.nameEn || "",
    type: fields.type,
    description: fields.description || fields.features || "",
    features: fields.description || fields.features || "",
    layout: fields.layout || "",
    id: uid("background"),
    worldId: world.id,
    photoBased: mode === "photo",
    importedIllustration: mode === "import",
    imageAssetId: candidate.imageAssetId,
    imageUrl: `asset:${candidate.imageAssetId}`,
    imageSeed: candidate.meta.requestedSeed ?? null,
    effectiveImageSeed: candidate.seed ?? null,
    createdAt: confirmedAt,
  };
  const meta = {
    ...clone(candidate.meta),
    imageEngine: world.imageEngine,
    worldId: world.id,
    worldRevision: world.revision,
    stylePresetId: world.stylePresetId,
    quality: mode === "import" ? "imported" : candidate.meta.quality,
    kind: "background-sheet",
    returnedSeed: candidate.seed ?? null,
  };
  const settings = backgroundSettingsKey(item);
  const sheet = {
    id: candidate.imageAssetId,
    imageAssetId: candidate.imageAssetId,
    imageUrl: item.imageUrl,
    seed: candidate.seed ?? null,
    meta: clone(meta),
    settings,
    confirmedAt,
  };
  return {
    ...item,
    imageMeta: clone(meta),
    backgroundSheets: [sheet],
    backgroundSheetMeta: clone(meta),
    backgroundSheetSettingsKey: settings,
    backgroundSheetSeed: sheet.seed,
    backgroundSheetConfirmedAt: confirmedAt,
  };
}

function current(session) {
  return (
    flow === session &&
    !session.controller.signal.aborted &&
    api.getState() === session.state &&
    api.isParent() &&
    !!document.querySelector(`[data-photo-flow="${session.id}"]`)
  );
}

function assertCurrent(session) {
  if (!current(session)) throw abortError();
}

function releasePhotos(session) {
  session.photoVersion++;
  for (const photo of session.photos) URL.revokeObjectURL(photo.url);
  session.photos.length = 0;
  const input = document.querySelector("#photo-files");
  if (input) input.value = "";
}

async function discardCandidate(candidate) {
  if (!candidate?.imageAssetId) return;
  // The asset store owns its cached object URLs as well as the durable blob.
  const assets = await import("./image-generation/assets.js");
  if (assets.deleteImageAsset)
    await assets.deleteImageAsset(candidate.imageAssetId);
}

/** Safe for host closeModal(), mode switches, Escape, and replacement modals. */
export function cleanupPhotoFlow() {
  const session = flow;
  if (!session) return;
  flow = null;
  session.controller.abort();
  releasePhotos(session);
  const candidate = session.candidate;
  session.candidate = null;
  if (candidate && !session.committed)
    void discardCandidate(candidate).catch(() => {});
}

function closePhotoModal() {
  cleanupPhotoFlow();
  api.closeModal();
}

function showPhotoModal(session, content) {
  api.showModal(
    `<div data-photo-flow="${session.id}">${content}</div>`,
    "wide photo-modal",
  );
}

function photoButton(label, action, className = "outline", extra = "") {
  return `<button type="button" class="btn btn-${className}" data-photo-action="${action}"${extra ? ` ${extra}` : ""}>${label}</button>`;
}

function selectField(id, label, options, selected) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options.map(([value, name]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${name}</option>`).join("")}</select></div>`;
}

function characterFields() {
  return `<div class="field"><label for="photo-name">이름 · 한글</label><input id="photo-name" required maxlength="30" placeholder="예: 유하"></div><div class="field"><label for="photo-name-en">이름 · 영어</label><input id="photo-name-en" required maxlength="40" placeholder="예: Yuha"></div>${selectField(
    "photo-role",
    "역할",
    [
      ["주인공", "주인공"],
      ["가족", "가족"],
      ["친구", "친구"],
      ["동물", "동물"],
      ["상상 친구", "상상 친구"],
    ],
    "주인공",
  )}${selectField(
    "photo-kind",
    "캐릭터 모습",
    [
      ["child", "아이"],
      ["adult", "어른"],
      ["rabbit", "토끼"],
      ["dinosaur", "공룡"],
    ],
    "child",
  )}${selectField("photo-gender", "성별 · 그림에 그대로 유지", GENDER_CHOICES, "")}<div class="field"><label for="photo-age">나이</label><input id="photo-age" type="number" min="1" max="99" step="1" value="4" required></div>${selectField(
    "photo-relation",
    "사진 속 사람",
    [
      ["family", "본인 또는 우리 가족"],
      ["nonfamily-minor", "가족이 아닌 아이 · 친구나 사촌"],
      ["nonfamily-adult", "가족이 아닌 어른"],
      ["animal", "동물 또는 상상 친구"],
    ],
    "family",
  )}<div class="field"><label for="photo-color">옷 · 몸 색상</label><input id="photo-color" type="color" value="#efc954" style="height:45px"></div><div class="field"><label for="photo-hair">머리 색상</label><input id="photo-hair" type="color" value="#3c3027" style="height:45px"></div><div class="field"><label for="photo-skin">피부 색상</label><input id="photo-skin" type="color" value="#f1cfad" style="height:45px"></div><div class="field field-wide"><label for="photo-appearance">외모 · 고정 특징 · 늘 입는 옷</label><textarea id="photo-appearance" maxlength="500" required placeholder="사진을 보며 직접 적어 주세요. 예: 짧은 곱슬머리, 둥근 안경, 노란 티셔츠"></textarea><small>자동으로 추출한 설정이 아닙니다. 적어 주신 특징과 사진을 함께 참조해 닮은 그림 캐릭터를 만들어요.</small></div><div class="field field-wide"><label for="photo-traits">성격 · 좋아하는 것</label><input id="photo-traits" maxlength="150" placeholder="예: 호기심 많음, 공룡을 좋아함"></div>`;
}

function backgroundFields() {
  return `<div class="field"><label for="photo-name">장소 이름 · 한글</label><input id="photo-name" required maxlength="50" placeholder="예: 우리 집 놀이터"></div><div class="field"><label for="photo-name-en">장소 이름 · 영어</label><input id="photo-name-en" maxlength="70" placeholder="예: Our Playground"></div>${selectField(
    "photo-type",
    "장소 종류",
    [
      ["home", "집"],
      ["school", "유치원 · 학교"],
      ["forest", "숲 · 정원"],
      ["space", "우주"],
      ["sea", "바다"],
    ],
    "home",
  )}<div class="field field-wide"><label for="photo-appearance">장소 특징 · 꼭 남길 것</label><textarea id="photo-appearance" required maxlength="500" placeholder="예: 창가에 작은 책장이 있고, 초록 소파 옆에 노란 쿠션이 있어요."></textarea><small>사진을 보며 장소의 특징을 직접 적어 주세요. 인물과 주소 등은 그림에서 제외하도록 요청합니다.</small></div><div class="field field-wide"><label for="photo-layout">고정할 배치 · 선택</label><textarea id="photo-layout" maxlength="1000" placeholder="예: 왼쪽 벽에 창문 하나, 창 아래 침대, 오른쪽 문 옆에 책장"></textarea><small>문·창문 위치와 가구 배치를 적으면 이후 장면과 다음 편에서도 같은 장소를 참조해요. 사진에 없는 방이나 가구는 새로 만들지 않도록 요청합니다.</small></div>`;
}

function openPhotoFlow(kind, mode = "photo") {
  if (!api.isParent()) return;
  cleanupPhotoFlow();
  const state = api.getState();
  const world = getActiveWorld(state);
  const session = {
    id: uid("photo"),
    kind,
    mode,
    state,
    worldId: world.id,
    controller: new AbortController(),
    photos: [],
    photoVersion: 0,
    normalizing: false,
    busy: false,
    candidate: null,
    committed: false,
  };
  flow = session;
  if (mode === "import") {
    showPhotoModal(
      session,
      `${api.modalHeader(kind === "character" ? "완성된 캐릭터 시트 가져오기" : "완성된 배경 그림 가져오기")}<p class="modal-intro">이미 만든 그림 1장을 무료로 가져와 이 World의 재료로 사용해요.<br><a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">Gemini에서 그림 만들기 ↗</a>로 이동해 무료 사용 한도 안에서 직접 만든 그림을 내려받고, 여기에서 선택할 수 있어요. Google 계정별 한도와 이용 가능 모델이 적용됩니다.</p><form id="photo-material-form"><div class="field field-wide"><label for="photo-files">완성된 ${kind === "character" ? "캐릭터 시트" : "배경 그림"} 1장 · JPG, PNG, WebP · 10MB 이하</label><input id="photo-files" type="file" accept="image/jpeg,image/png,image/webp"><small id="photo-file-status" aria-live="polite">원본 사진을 그림으로 바꾸는 기능이 아닙니다. 완성된 그림을 골라 주세요.</small></div><div id="photo-previews" class="photo-previews" aria-label="가져올 그림 미리보기" style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0"></div><fieldset id="photo-fields" style="border:0;padding:0;margin:0"><div class="form-grid">${kind === "character" ? characterFields() : backgroundFields()}</div><div class="notice" style="margin-top:20px">현재 World · ${escape(world.name)} · ${escape(getStylePreset(world.stylePresetId).name)}<br>${kind === "character" ? (world.imageEngine === "sample" ? "그림은 보관되지만 무료 샘플 장면은 고정 템플릿입니다. 가져온 그림의 외모·화풍을 반영하려면 AI 엔진을 선택하고 시트를 다시 확정해 주세요." : "정면·측면·뒷모습과 표정이 담긴 시트를 권장합니다. 이후 장면은 가져온 시트를 참조해요.") : "장소의 구조와 중요한 특징이 담긴 대표 그림을 골라 주세요."}<br>이미지 생성 API를 호출하지 않습니다. 확인 후 그림 파일과 설정을 이 기기에 저장해요.</div><label style="display:flex;gap:10px;align-items:flex-start;margin-top:18px"><input id="photo-import-consent" type="checkbox" required><span>사진이 아니라 완성된 캐릭터·배경 그림입니다. 이 그림을 사용할 권리가 있으며, World의 참조 그림으로 저장하는 데 동의합니다.</span></label></fieldset><p id="photo-error" class="pin-error" role="status" aria-live="polite"></p><div class="modal-actions"><span id="photo-progress" class="small-label" aria-live="polite"></span>${photoButton("취소", "cancel")}<button id="photo-generate" type="submit" class="btn btn-primary">가져올 그림 확인</button></div></form>`,
    );
    // Person-photo consent belongs to photo conversion, not finished art import.
    document.querySelector("#photo-relation")?.closest(".field")?.remove();
    const details =
      document.querySelector("#photo-appearance")?.nextElementSibling;
    if (details)
      details.textContent =
        "가져오는 그림의 외모와 특징을 직접 적어 주세요. 이 설정을 함께 저장합니다.";
    return;
  }
  showPhotoModal(
    session,
    `${api.modalHeader(kind === "character" ? "사진으로 등장인물 만들기" : "사진으로 배경 시트 만들기")}<p class="modal-intro">사진 1~3장을 참고해 우리 집 화풍의 ${kind === "character" ? "닮은 그림 캐릭터" : "고정 배경 시트"}를 만들어요.<br>사진은 이 화면의 메모리에서만 사용하고, 확정하거나 닫으면 지웁니다.</p><form id="photo-material-form"><div class="field field-wide"><label for="photo-files">참고할 사진 · JPG, PNG, WebP · 한 장당 10MB 이하</label><input id="photo-files" type="file" accept="image/jpeg,image/png,image/webp" multiple><small id="photo-file-status" aria-live="polite">선택만 하면 서버에 보내지 않고 이 기기에서 미리 봅니다.</small></div><div id="photo-previews" class="photo-previews" aria-label="선택한 사진 미리보기" style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0"></div><fieldset id="photo-fields" style="border:0;padding:0;margin:0"><div class="form-grid">${kind === "character" ? characterFields() : backgroundFields()}</div><div class="notice" style="margin-top:20px"><strong>생성할 엔진: ${escape(ENGINE_METADATA[world.imageEngine]?.name || world.imageEngine)}</strong> · ${escape(getStylePreset(world.stylePresetId).name)}<br>${PHOTO_ENGINES.has(world.imageEngine) ? "아래 생성 버튼을 누르면 처리한 사진과 화풍 참조가 이 엔진으로 전송됩니다. 제공자의 이용 요금과 보관 정책이 적용됩니다." : "무료 샘플 엔진은 사진을 그림으로 바꾸지 못해요. 부모 설정에서 Google, OpenAI, BFL, fal 또는 참조 이미지를 연결한 ComfyUI를 선택해 주세요."}</div>${!PHOTO_ENGINES.has(world.imageEngine) ? `<p style="margin-top:12px">${photoButton("완성된 그림을 무료로 가져오기", kind === "character" ? "import-character" : "import-background", "outline")}</p>` : ""}<label style="display:flex;gap:10px;align-items:flex-start;margin-top:18px"><input id="photo-consent" type="checkbox" required><span>사진을 사용할 권리가 있고, 사진 속 사람 또는 보호자의 동의를 받았습니다. 선택한 이미지 엔진에 사진을 보내는 데 동의합니다.</span></label><label id="photo-guardian-label" hidden style="gap:10px;align-items:flex-start;margin-top:12px"><input id="photo-guardian-consent" type="checkbox"><span>가족이 아닌 아이의 보호자에게 이 사진의 사용과 이미지 엔진 전송 동의를 따로 받았습니다.</span></label></fieldset><p id="photo-error" class="pin-error" role="status" aria-live="polite"></p><div class="modal-actions"><span id="photo-progress" class="small-label" aria-live="polite"></span>${photoButton("취소", "cancel")}<button id="photo-generate" type="submit" class="btn btn-primary" ${PHOTO_ENGINES.has(world.imageEngine) ? "" : "disabled"}>${kind === "character" ? "사진으로 그림 만들기" : "사진으로 배경 시트 미리 생성"}</button></div></form>`,
  );
}

async function choosePhotos(input) {
  const session = flow;
  if (!session || session.busy || !current(session)) {
    input.value = "";
    return;
  }
  const files = [...input.files];
  releasePhotos(session);
  const version = session.photoVersion;
  const previews = document.querySelector("#photo-previews");
  const status = document.querySelector("#photo-file-status");
  previews.innerHTML = "";
  session.normalizing = false;
  if (!files.length) {
    status.textContent = "사진 1~3장을 골라 주세요.";
    return;
  }
  session.normalizing = true;
  status.textContent = "사진을 이 기기에서 처리하고 있어요…";
  const photos = [];
  try {
    validatePhotoFiles(files);
    if (session.mode === "import" && files.length !== 1)
      throw new Error("완성된 그림은 한 번에 1장씩 가져와 주세요.");
    for (const file of files) {
      const photo = await normalizePhoto(file, {
        signal: session.controller.signal,
      });
      if (!current(session) || version !== session.photoVersion)
        throw abortError();
      photos.push({ ...photo, url: URL.createObjectURL(photo.blob) });
    }
    assertCurrent(session);
    if (version !== session.photoVersion) throw abortError();
    session.photos = photos;
    previews.innerHTML = photos
      .map(
        (photo, i) =>
          `<figure style="margin:0"><img src="${escape(photo.url)}" alt="참고 사진 ${i + 1}" style="width:128px;height:128px;object-fit:contain;border-radius:12px;background:#f2f0eb"><figcaption class="small-label">사진 ${i + 1} · ${photo.width} × ${photo.height}</figcaption></figure>`,
      )
      .join("");
    status.textContent = `${photos.length}장 준비됨 · 위치 정보 등 메타데이터 제거 · 최대 1600px · ${session.mode === "import" ? "API 전송 없음" : "아직 전송하지 않았어요."}`;
    document.querySelector("#photo-error").textContent = "";
  } catch (error) {
    for (const photo of photos) URL.revokeObjectURL(photo.url);
    if (current(session) && version === session.photoVersion) {
      status.textContent =
        error.name === "AbortError" ? "사진 처리를 취소했어요." : error.message;
    }
  } finally {
    if (flow === session && version === session.photoVersion)
      session.normalizing = false;
  }
}

function readFields(session) {
  const value = (id) => document.getElementById(id)?.value.trim() || "";
  const name = value("photo-name");
  const nameEn = value("photo-name-en");
  const description = value("photo-appearance");
  if (!name || !description || (session.kind === "character" && !nameEn))
    throw new Error("이름과 사진에서 남길 특징을 적어 주세요.");
  if (session.kind === "background")
    return {
      name,
      nameEn,
      type: value("photo-type"),
      description,
      features: description,
      layout: value("photo-layout"),
    };
  const age = Number(value("photo-age"));
  if (!Number.isInteger(age) || age < 1 || age > 99)
    throw new Error("나이는 1~99 사이 정수로 적어 주세요.");
  return {
    name,
    nameEn,
    role: value("photo-role"),
    kind: value("photo-kind"),
    gender: value("photo-gender"),
    age,
    color: value("photo-color"),
    hairColor: value("photo-hair"),
    skinColor: value("photo-skin"),
    description,
    appearance: description,
    traits: value("photo-traits")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function consentGiven(session) {
  if (session.mode === "import") {
    if (!document.querySelector("#photo-import-consent")?.checked)
      throw new Error(
        "사진이 아닌 완성된 그림인지 확인하고 저장에 동의해 주세요.",
      );
    return;
  }
  if (!document.querySelector("#photo-consent")?.checked)
    throw new Error("사진 사용과 이미지 엔진 전송에 동의해 주세요.");
  if (
    session.kind === "character" &&
    document.querySelector("#photo-relation")?.value === "nonfamily-minor" &&
    !document.querySelector("#photo-guardian-consent")?.checked
  )
    throw new Error("가족이 아닌 아이는 보호자의 별도 동의가 필요해요.");
}

function showFormError(session, error) {
  if (!current(session)) return;
  const errorPanel = document.querySelector("#photo-error");
  if (errorPanel)
    errorPanel.textContent =
      error.message || "사진으로 그림을 만들지 못했어요.";
}

function setBusy(session, busy) {
  session.busy = busy;
  for (const element of document.querySelectorAll(
    "#photo-fields input, #photo-fields textarea, #photo-fields select, #photo-files, #photo-generate",
  ))
    element.disabled = busy;
  const progress = document.querySelector("#photo-progress");
  if (progress)
    progress.textContent = busy
      ? session.mode === "import"
        ? "완성된 그림을 준비하는 중…"
        : "사진과 화풍을 참고해 그림을 만드는 중…"
      : "";
}

async function runPhotoGeneration(session) {
  if (!current(session) || session.busy) return;
  let candidate;
  try {
    if (session.normalizing)
      throw new Error("사진 처리가 끝나면 다시 눌러 주세요.");
    if (!session.photos.length)
      throw new Error("사진 1~3장을 먼저 골라 주세요.");
    consentGiven(session); // No credential access, fetch, or provider call precedes this check.
    const fields = readFields(session);
    const world = getActiveWorld(session.state);
    if (world.id !== session.worldId)
      throw new Error(
        "선택한 World가 바뀌었어요. 사진 만들기를 다시 열어 주세요.",
      );
    const engine = world.imageEngine;
    const stylePreset = {
      ...getStylePreset(world.stylePresetId),
      styleRefImages: getWorldStyleReferences(session.state, world).map(
        (reference) => reference.imageUrl,
      ),
    };
    if (session.mode === "import") {
      setBusy(session, true);
      const asset = await saveImage(session.photos[0].blob, {
        signal: session.controller.signal,
      });
      candidate = {
        imageAssetId: asset.assetId,
        imageUrl: asset.imageUrl,
        seed: null,
        meta: {
          worldId: world.id,
          worldRevision: world.revision,
          engine,
          stylePresetId: world.stylePresetId,
          source: "imported-illustration",
          requestedSeed: 0,
          seedSupported: false,
          seedNote: "완성된 그림을 가져왔으므로 생성 시드는 알 수 없어요.",
          referenceCount: 0,
          stylePreset: clone(stylePreset),
          importedAt: new Date().toISOString(),
        },
      };
      assertCurrent(session);
      session.fields = fields;
      session.candidate = candidate;
      session.busy = false;
      showPhotoCandidate(session);
      return;
    }
    if (!PHOTO_ENGINES.has(engine))
      throw new Error(
        "무료 샘플은 사진 변환을 지원하지 않아요. 부모 설정에서 사진 참조를 지원하는 엔진을 선택해 주세요.",
      );
    const seed = globalThis.crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
      : Math.floor(Math.random() * 2147483647);
    const request = (session.generationRequest = createPhotoGenerationRequest({
      kind: session.kind,
      fields,
      photos: session.photos.map((photo) => photo.blob),
      stylePreset,
      seed,
    }));
    const worldContext = {
      worldId: world.id,
      worldRevision: world.revision,
      engine,
      stylePresetId: world.stylePresetId,
    };
    setBusy(session, true);
    document.querySelector("#photo-error").textContent = "";
    const config = {
      ...(session.state.settings?.imageProviderConfig?.[engine] || {}),
      ...(world.providerConfig?.[engine] || {}),
    };
    delete config.apiKey;
    delete config.key;
    delete config.token;
    const proxy = config.proxyEndpoint || config.transport === "proxy";
    const apiKey = proxy ? null : await getCredential(engine);
    assertCurrent(session);
    consentGiven(session);
    if (ENGINE_METADATA[engine]?.requiresKey && !apiKey && !proxy)
      throw new Error(
        `${ENGINE_METADATA[engine].name} API 키를 부모 설정에 먼저 등록해 주세요.`,
      );
    const result = await generateImage(request, {
      engine,
      config: {
        ...config,
        apiKey: apiKey || undefined,
        signal: session.controller.signal,
      },
    });
    assertCurrent(session);
    if (!result?.imageUrl) throw new Error("엔진이 그림을 반환하지 않았어요.");
    const asset = await saveImage(result.imageUrl, {
      signal: session.controller.signal,
    });
    candidate = {
      imageAssetId: asset.assetId,
      imageUrl: asset.imageUrl,
      seed: result.seed ?? null,
      meta: {
        ...clone(result.meta || {}),
        ...worldContext,
        quality: "draft",
        source: "photo-stylized",
        requestedSeed: seed,
        returnedSeed: result.seed ?? null,
        photoReferenceCount: session.photos.length,
        referenceCount: request.referenceImages.length,
        stylePreset: clone(stylePreset),
        generatedAt: new Date().toISOString(),
      },
    };
    assertCurrent(session);
    session.fields = fields;
    session.candidate = candidate;
    session.busy = false;
    showPhotoCandidate(session);
  } catch (error) {
    if (candidate && session.candidate !== candidate)
      await discardCandidate(candidate).catch(() => {});
    if (!current(session)) return;
    setBusy(session, false);
    showFormError(session, error);
  }
}

/**
 * 2026-10-20: the candidate screen also shows its own progress. The final
 * quality render took a minute with no change on screen, so the button
 * looked dead; now the buttons are disabled and a line says what is
 * happening, and an error re-renders the screen with the buttons back.
 */
export function photoCandidateContent(session, { busy = "", error = "" } = {}) {
  const result = session.candidate;
  const name = session.fields.name;
  const draft = session.mode === "photo" && result.meta.quality === "draft";
  const disabled = busy ? "disabled" : "";
  const title = session.kind === "character" ? `${escape(name)}의 시트를 확인해 주세요` : `${escape(name)}의 배경 시트를 확인해 주세요`;
  return `${api?.modalHeader ? api.modalHeader(title) : `<h3>${title}</h3>`}<img class="ig-sheet-preview" src="${escape(result.imageUrl)}" alt="${escape(name)}의 후보 그림"><p class="modal-intro">${session.kind === "character" ? "모든 모습에서 얼굴과 옷이 같은지 확인해 주세요." : "사진 속 장소의 문·창·가구 배치와 색상이 모든 칸에서 같은지 확인해 주세요. 확정한 시트는 이후 장면과 다음 편에서 같은 장소의 참조로 사용해요."}<br>World v${result.meta.worldRevision} · ${escape(ENGINE_METADATA[result.meta.engine]?.name)} · ${session.mode === "import" ? "완성된 그림 가져오기 · API 호출 없음 · 생성 시드 알 수 없음" : `요청 시드 ${result.meta.requestedSeed} · 결과 시드 ${result.seed ?? "미지원"}`}<br>확정하면 그림과 직접 적은 설정만 저장하고 ${session.mode === "import" ? "이 화면의 입력 파일을 지웁니다." : "참고 사진은 지웁니다."}</p>${busy ? `<p id="photo-progress" class="notice" role="status" aria-live="polite">${escape(busy)}</p>` : ""}<p id="photo-error" class="pin-error" aria-live="polite">${escape(error)}</p><div class="modal-actions">${photoButton("확정하지 않고 닫기", "cancel", "outline", disabled)}${photoButton(draft ? "최종 화질 생성 · 추가 요청 요금 적용" : session.kind === "character" ? "이 캐릭터 시트로 확정" : "이 배경 시트로 확정", "confirm", "primary", disabled)}</div>`;
}
function showPhotoCandidate(session, options = {}) {
  showPhotoModal(session, photoCandidateContent(session, options));
}

async function confirmPhotoCandidate(session) {
  if (!current(session) || !session.candidate || session.busy) return;
  const state = session.state;
  const world = getActiveWorld(state);
  const candidate = session.candidate;
  let item;
  const previousCharacterIds = [...world.characterIds];
  const previousStale = world.characterSheetsStale;
  try {
    if (
      candidate.meta.worldId !== world.id ||
      candidate.meta.worldRevision !== world.revision ||
      candidate.meta.engine !== world.imageEngine ||
      candidate.meta.stylePresetId !== world.stylePresetId
    )
      throw new Error(
        "생성 중 World 설정이 바뀌었어요. 현재 엔진과 화풍으로 사진 그림을 다시 만들어 주세요.",
      );
    if (session.mode === "photo" && candidate.meta.quality === "draft") {
      session.busy = true;
      showPhotoCandidate(session, {
        busy: "최종 화질 그림을 만드는 중이에요. 엔진에 따라 1~2분 걸려요. 이 창을 닫지 말고 기다려 주세요.",
      });
      const config = {
        ...(state.settings?.imageProviderConfig?.[world.imageEngine] || {}),
        ...(world.providerConfig?.[world.imageEngine] || {}),
      };
      delete config.apiKey;
      delete config.key;
      delete config.token;
      const apiKey =
        config.proxyEndpoint || config.transport === "proxy"
          ? null
          : await getCredential(world.imageEngine);
      const result = await generateImage(
        { ...session.generationRequest, quality: "final" },
        {
          engine: world.imageEngine,
          config: { ...config, apiKey, signal: session.controller.signal },
        },
      );
      assertCurrent(session);
      const asset = await saveImage(result.imageUrl, {
        signal: session.controller.signal,
      });
      const finalCandidate = {
        imageAssetId: asset.assetId,
        imageUrl: asset.imageUrl,
        seed: result.seed ?? null,
        meta: {
          ...candidate.meta,
          ...result.meta,
          worldId: world.id,
          worldRevision: world.revision,
          engine: world.imageEngine,
          stylePresetId: world.stylePresetId,
          quality: "final",
          returnedSeed: result.seed ?? null,
          stylePreset: candidate.meta.stylePreset,
        },
      };
      if (!current(session)) {
        await discardCandidate(finalCandidate);
        return;
      }
      session.candidate = finalCandidate;
      session.busy = false;
      await discardCandidate(candidate);
      showPhotoCandidate(session);
      return;
    }
    session.busy = true;
    if (session.kind === "character") {
      item = {
        ...clone(session.fields),
        id: uid("char"),
        worldId: world.id,
        photoBased: session.mode === "photo",
        importedIllustration: session.mode === "import",
        version: 1,
        variant: 0,
        characterSheets: [],
        wardrobe: [],
        approved: true,
        createdAt: new Date().toISOString(),
      };
      state.characters.push(item);
      markCharacterSheetConfirmed(state, item.id, {
        ...candidate,
        meta: {
          ...candidate.meta,
          characterSnapshot: clone({ ...item, characterSheets: undefined }),
        },
      });
    } else {
      item = createPhotoBackgroundMaterial({
        fields: session.fields,
        candidate,
        world,
        mode: session.mode,
      });
      state.backgrounds ||= [];
      state.backgrounds.push(item);
    }
    if (api.save() === false)
      throw new Error(
        "그림 설정을 저장하지 못했어요. 저장 공간을 확인해 주세요.",
      );
    session.committed = true;
    cleanupPhotoFlow();
    api.closeModal();
    api.render();
    api.toast(
      `${item.name}${session.kind === "character" ? "의 캐릭터 시트" : "의 고정 배경 시트"}를 저장했어요.${session.mode === "photo" ? " 참고 사진을 지웠어요." : ""}`,
    );
  } catch (error) {
    if (item) {
      const list =
        session.kind === "character" ? state.characters : state.backgrounds;
      const index = list.indexOf(item);
      if (index !== -1) list.splice(index, 1);
      if (session.kind === "character") {
        world.characterIds = previousCharacterIds;
        world.characterSheetsStale = previousStale;
      }
    }
    session.busy = false;
    if (!current(session)) return;
    // The candidate screen may be in its busy state: draw it again with the buttons back.
    if (session.candidate)
      showPhotoCandidate(session, {
        error: error.message || "그림을 만들지 못했어요.",
      });
    else showFormError(session, error);
  }
}

export function configurePhotoUI(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("click", (event) => {
    const element = event.target.closest?.("[data-photo-action]");
    if (!element) return;
    event.preventDefault();
    const action = element.dataset.photoAction;
    if (action === "cancel") {
      closePhotoModal();
      return;
    }
    if (
      [
        "new-character",
        "new-background",
        "import-character",
        "import-background",
      ].includes(action)
    ) {
      api.protectedAction(() =>
        openPhotoFlow(
          action.endsWith("character") ? "character" : "background",
          action.startsWith("import") ? "import" : "photo",
        ),
      );
      return;
    }
    const session = flow;
    if (!session || !current(session)) {
      // 2026-10-20: a dead screen (parent mode locked, another screen opened
      // over it) closes with a word instead of ignoring the click.
      cleanupPhotoFlow();
      api.closeModal();
      api.toast?.("사진으로 만들기 창이 닫혔어요. 처음부터 다시 열어 주세요.");
      return;
    }
    if (action === "confirm") {
      if (session.busy) {
        api.toast?.("그림을 만드는 중이에요. 잠시만 기다려 주세요.");
        return;
      }
      void confirmPhotoCandidate(session);
    }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "photo-material-form") return;
    event.preventDefault();
    const session = flow;
    if (session) void runPhotoGeneration(session);
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "photo-files") void choosePhotos(event.target);
    if (event.target.id === "photo-relation") {
      const guardian = document.querySelector("#photo-guardian-label");
      const checkbox = document.querySelector("#photo-guardian-consent");
      const needsGuardian = event.target.value === "nonfamily-minor";
      guardian.hidden = !needsGuardian;
      guardian.style.display = needsGuardian ? "flex" : "none";
      checkbox.required = needsGuardian;
      checkbox.checked = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && flow) cleanupPhotoFlow();
  });
  // Host close/replacement paths cannot leave a photo job or its inputs alive.
  const observer = new MutationObserver(() => {
    if (flow && !current(flow)) cleanupPhotoFlow();
  });
  observer.observe(document.querySelector("#modal-root") || document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("pagehide", cleanupPhotoFlow);
}
