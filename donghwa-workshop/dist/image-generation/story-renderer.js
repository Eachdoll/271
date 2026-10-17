/** Prompt assembly belongs to the renderer; adapters only speak provider APIs. */
const ROLE_ORDER = Object.freeze({
  character_front: 0,
  character_full: 1,
  character_variant: 1,
  style_sheet: 2,
  background: 3,
});
const ROLE_DESCRIPTION = Object.freeze({
  character_front:
    "character identity and face; preserve this exact face and body",
  character_full:
    "character body proportions, full outfit and distinctive identity details",
  character_variant:
    "approved outfit or appearance variant; keep the face from the front identity reference",
  style_sheet:
    "authoritative rendering style, paper texture, lighting and palette; do not copy its character identity",
  background:
    "background layout and setting; repaint in the authoritative style",
});

export class StoryRendererError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "StoryRendererError";
    this.code = code;
  }
}

export function renderImageRequest(request = {}, capabilities = {}) {
  const scenePrompt = String(
    request.scenePrompt ?? request.prompt ?? "",
  ).trim();
  if (!scenePrompt)
    throw new StoryRendererError(
      "이미지 설명을 입력해 주세요.",
      "invalid_prompt",
    );
  const stylePreset =
    request.stylePreset && typeof request.stylePreset === "object"
      ? request.stylePreset
      : {};
  const stylePrompt = String(
    request.stylePrompt ?? stylePreset.stylePrompt ?? "",
  );
  const negativePrompt = String(
    request.negativePrompt ?? stylePreset.negativePrompt ?? "",
  ).trim();
  if (!Array.isArray(request.referenceImages ?? []))
    throw new StoryRendererError(
      "참조 이미지는 배열로 전달해 주세요.",
      "invalid_references",
    );
  const input = request.referenceImages || [];
  const allTyped =
    input.length > 0 &&
    input.every((ref) => ref && Object.hasOwn(ROLE_ORDER, ref.role));
  const ordered = allTyped
    ? input
        .map((ref, index) => ({ ref, index }))
        .sort(
          (a, b) =>
            ROLE_ORDER[a.ref.role] - ROLE_ORDER[b.ref.role] ||
            a.index - b.index,
        )
        .map(({ ref }) => ref)
    : [...input];
  const limit = Number(capabilities.maxReferenceImages) || Infinity;
  const referenceImages = ordered.slice(0, limit);
  const dropped = ordered.slice(limit);
  // Legacy callers promised ALL references. Typed requests may drop optional
  // background references, but never silently lose character or style sheets.
  if (
    dropped.length &&
    (!allTyped ||
      dropped.some(
        (ref) =>
          ref.required === true ||
          (ref.required !== false && ref.role !== "background"),
      ))
  ) {
    throw new StoryRendererError(
      `이 엔진의 참조 이미지 한도(${limit}개)에 캐릭터·스타일·고정 배경 참조를 모두 넣을 수 없어요. 배경 일관성을 위해 참조를 빼지 않습니다. 등장인물을 줄이거나 참조 한도가 큰 엔진을 선택해 주세요.`,
      "reference_limit",
    );
  }
  const parts = [stylePrompt, scenePrompt];
  if (stylePreset.palette?.length)
    parts.push(`Color palette: ${stylePreset.palette.join(", ")}.`);
  if (allTyped)
    parts.push(
      referenceImages
        .map(
          (ref, index) =>
            `Image ${index + 1} is ${String(ref.label || ref.role)
              .replace(/[\r\n]/g, " ")
              .slice(0, 180)}: ${ROLE_DESCRIPTION[ref.role]}.`,
        )
        .join("\n"),
    );
  else if (referenceImages.length)
    parts.push(
      "Use ALL attached reference images together. Preserve character identities, proportions, clothing and distinctive details from character sheets. Follow the palette, materials and rendering of style references. Render a new scene matching the prompt.",
    );
  parts.push("No text, no letters, no captions, no logos, no watermarks.");
  if (negativePrompt && !capabilities.supportsNegative)
    parts.push(`Avoid: ${negativePrompt}`);
  return {
    ...request,
    prompt: scenePrompt,
    scenePrompt,
    stylePrompt,
    negativePrompt,
    stylePreset: { ...stylePreset, stylePrompt, negativePrompt },
    referenceImages,
    keptReferences: referenceImages,
    composedPrompt: parts.filter(Boolean).join("\n\n"),
    referenceMetadata: referenceImages.map((ref, index) => ({
      index: index + 1,
      role: ref?.role || "unspecified",
      label: ref?.label || null,
    })),
    droppedReferenceCount: dropped.length,
    originalReferenceCount: input.length,
  };
}

export class StoryRenderer {
  constructor(capabilities = {}) {
    this.capabilities = capabilities;
  }
  render(request) {
    return renderImageRequest(request, this.capabilities);
  }
}
