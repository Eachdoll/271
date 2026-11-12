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
  // R63: a clear book's page at a place that is not a supplied place stays there (its stage or its own words) — it never
  // falls back to the beat's place (the paid book's village gate became "유하네 집" with its architecture lock).
  const where = String(page.scene?.where || "").trim();
  if (!direct && Number(book.storyInput?.writersRoom?.weave) >= 7 && where && !page.backgroundId && !page.scene?.backgroundId) {
    const name = page.scene?.stage?.name || where;
    return { key: `place:${norm(name)}`, background: null };
  }
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
 * R59: with `rides` only the earlier pages it accepts are candidates.
 */
export function previousSceneReferences(book, snapshot, index, { shotOf = null, rides = null, canonicalAlways = false } = {}) {
  const place = pagePlace(book, snapshot, index);
  if (!place.key) return [];
  // R64: with `canonicalAlways` the first picture of this place is the place's reference whoever is in it (a later page with
  // fewer people lost its stage when page 1 had a friend in it); `rides` then only chooses the recent-scene slot.
  const drawnHere = (book.pages || [])
    .slice(0, index)
    .map((page, i) => ({ page, index: i }))
    .filter(({ page, index: i }) => {
      if (!canonicalAlways && typeof rides === "function" && !rides(page)) return false;
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
  if (!drawnHere.length) return [];
  const candidates = canonicalAlways && typeof rides === "function" ? drawnHere.filter(({ page }) => rides(page)) : drawnHere;
  const shot = typeof shotOf === "function" ? String(shotOf(book.pages[index]) || "") : "",
    sameShot = shot ? candidates.filter(({ page }) => String(shotOf(page) || "") === shot) : [],
    first = drawnHere[0],
    latest = sameShot.length ? sameShot.at(-1) : candidates.at(-1) || first,
    matched = sameShot.length > 0 && latest !== first,
    // R64: the canonical picture rode along although someone in it is not on this page.
    peopled = canonicalAlways && typeof rides === "function" && !rides(first.page);
  return [first, ...(first !== latest ? [latest] : [])].map(
    ({ page, index: i }, position) => ({
      imageAssetId: page.imageAssetId || null,
      imageUrl: page.imageAssetId
        ? `asset:${page.imageAssetId}`
        : page.imageUrl,
      role: "background",
      required: position === 0,
      label: `${position === 0 ? "CANONICAL first scene" : matched ? `Recent scene from the SAME camera (${shot})` : "Recent scene"} at SAME place, page ${i + 1}; architecture/layout only${matched ? " — the closest layout reference for this page: keep what it shows where it shows it" : ""}, do not copy cast, pose or temporary props${position === 0 && peopled ? " — PLACE ONLY: the people in this image are not in this picture unless they are in \"Everyone in this picture\"" : ""}`,
      sourcePageIndex: i,
      placeKey: place.key,
    }),
  );
}
