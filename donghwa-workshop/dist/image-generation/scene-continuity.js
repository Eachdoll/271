/* Place identity and already-rendered pages, without provider or storage dependencies. */
const norm = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
export function pagePlace(book, snapshot, index) {
  const page = book.pages?.[index] || {},
    backgrounds = snapshot.backgrounds || [];
  const values = [
    page.backgroundId,
    page.scene?.backgroundId,
    page.scene?.where,
    page.scene?.setting,
  ].filter(Boolean);
  const setting = book.outline?.settings?.find(
    (row) =>
      Number(row.beatIndex) === Number(page.beatIndex ?? page.scene?.beatIndex),
  );
  const direct = values
    .map(
      (value) =>
        backgrounds.find((bg) => bg.id === value) ||
        backgrounds.find((bg) =>
          [bg.name, bg.nameEn, ...(bg.aliases || [])].some(
            (alias) => norm(alias) && norm(alias) === norm(value),
          ),
        ),
    )
    .find(Boolean);
  const bound =
    direct ||
    backgrounds.find((bg) => bg.id === setting?.backgroundId) ||
    backgrounds.find((bg) =>
      snapshot.backgroundReferenceByPage?.[index]?.includes(bg.id),
    );
  const location =
    values[0] ||
    setting?.newPlace ||
    book.outline?.beats?.find(
      (beat) => beat.index === (page.beatIndex ?? page.scene?.beatIndex),
    )?.settingKey;
  return {
    key: bound
      ? `background:${bound.id}`
      : location
        ? `place:${norm(location)}`
        : null,
    background: bound || null,
  };
}
export function previousSceneReferences(book, snapshot, index) {
  const place = pagePlace(book, snapshot, index);
  if (!place.key) return [];
  const candidates = (book.pages || [])
    .slice(0, index)
    .map((page, i) => ({ page, index: i }))
    .filter(({ page, index: i }) => {
      const image = page.imageAssetId || page.imageUrl;
      // A text-edit stale mark covers only the image it was set on; a redrawn page is a reference again.
      if (
        !image ||
        (page.imageStale === true &&
          (page.imageStaleAssetId === undefined ||
            page.imageStaleAssetId === image))
      )
        return false;
      const captured = page.imageSceneSnapshot;
      if (
        captured?.scene &&
        JSON.stringify(captured.scene) !== JSON.stringify(page.scene || {})
      )
        return false;
      return (
        (captured?.placeKey || pagePlace(book, snapshot, i).key) === place.key
      );
    });
  if (!candidates.length) return [];
  const first = candidates[0],
    latest = candidates.at(-1);
  return [first, ...(first !== latest ? [latest] : [])].map(
    ({ page, index: i }, position) => ({
      imageAssetId: page.imageAssetId || null,
      imageUrl: page.imageAssetId
        ? `asset:${page.imageAssetId}`
        : page.imageUrl,
      role: "background",
      required: position === 0,
      label: `${position === 0 ? "CANONICAL first scene" : "Recent scene"} at SAME place, page ${i + 1}; architecture/layout only, do not copy cast, pose or temporary props`,
      sourcePageIndex: i,
      placeKey: place.key,
    }),
  );
}
