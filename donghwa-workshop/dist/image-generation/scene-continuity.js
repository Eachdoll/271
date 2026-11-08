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
/**
 * Earlier pages at the same place: the first (canonical) and the latest. R55d:
 * with `shotOf` (a function page → shot name) the latest page drawn from the
 * same camera as this page is preferred for the recent-scene slot — a page
 * from the same angle is a better layout reference than the newest page from
 * any angle. Without `shotOf` the choice is the old one, byte for byte.
 */
export function previousSceneReferences(book, snapshot, index, { shotOf = null } = {}) {
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
  const shot = typeof shotOf === "function" ? String(shotOf(book.pages[index]) || "") : "",
    sameShot = shot ? candidates.filter(({ page }) => String(shotOf(page) || "") === shot) : [],
    first = candidates[0],
    latest = sameShot.length ? sameShot.at(-1) : candidates.at(-1),
    matched = sameShot.length > 0 && latest !== first;
  return [first, ...(first !== latest ? [latest] : [])].map(
    ({ page, index: i }, position) => ({
      imageAssetId: page.imageAssetId || null,
      imageUrl: page.imageAssetId
        ? `asset:${page.imageAssetId}`
        : page.imageUrl,
      role: "background",
      required: position === 0,
      label: `${position === 0 ? "CANONICAL first scene" : matched ? `Recent scene from the SAME camera (${shot})` : "Recent scene"} at SAME place, page ${i + 1}; architecture/layout only${matched ? " — the closest layout reference for this page: keep what it shows where it shows it" : ""}, do not copy cast, pose or temporary props`,
      sourcePageIndex: i,
      placeKey: place.key,
    }),
  );
}
