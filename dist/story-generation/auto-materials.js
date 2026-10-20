/* An automatic plan refers to existing material IDs; it never rewrites the drawer. */
const isHomeBackground = (b) =>
  /^(?:home|house|bedroom|livingroom|living_room|room|집|방|집·방)$/iu.test(
    String(b?.type || b?.kind || "").trim(),
  ) ||
  /(?:집|침실|거실|주방|아이\s*방|의\s*방|우리\s*방|\b(?:home|house|bedroom|living\s*room|kitchen)\b)/iu.test(
    [b?.name, b?.nameEn].filter(Boolean).join(" "),
  );
const string = { type: "string", minLength: 1, maxLength: 700 };
export const AUTO_MATERIAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reuseCharacterIds",
    "newCharacters",
    "reuseBackgroundIds",
    "newBackgrounds",
    "reason",
  ],
  properties: {
    reuseCharacterIds: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
    newCharacters: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "nameEn",
          "kind",
          "description",
          "traits",
          "catchphrase",
          "color",
        ],
        properties: {
          name: string,
          nameEn: string,
          kind: string,
          description: string,
          traits: { type: "array", items: string, maxItems: 5 },
          catchphrase: string,
          color: { type: "string" },
        },
      },
    },
    reuseBackgroundIds: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
    newBackgrounds: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "nameEn", "type", "description", "layout"],
        properties: {
          name: string,
          nameEn: string,
          type: string,
          description: string,
          layout: string,
        },
      },
    },
    reason: string,
  },
};
const norm = (value) =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
const rows = (value) => (Array.isArray(value) ? value : []);
/** Protagonist + companions (picked or planned) in one story. */
export const MAX_CAST = 7;
export function inspectAutoMaterialPlan(
  plan,
  {
    characters = [],
    backgrounds = [],
    pinnedCharacterIds = [],
    allowNew = true,
  } = {},
) {
  const errors = [],
    validString = (value) =>
      typeof value === "string" && value.trim() && value.length <= 700;
  if (!plan || typeof plan !== "object")
    return { valid: false, errors: ["재료 계획 JSON이 필요해요."] };
  for (const key of [
    "reuseCharacterIds",
    "newCharacters",
    "reuseBackgroundIds",
    "newBackgrounds",
  ])
    if (!Array.isArray(plan[key])) errors.push(`${key} 배열이 필요해요.`);
  for (const id of rows(plan.reuseCharacterIds))
    if (!characters.some((c) => c.id === id))
      errors.push("서랍에 있는 캐릭터 ID만 골라 주세요.");
  for (const id of rows(plan.reuseBackgroundIds))
    if (!backgrounds.some((b) => b.id === id))
      errors.push("서랍에 있는 배경 ID만 골라 주세요.");
  const charIds = [
    ...new Set([...pinnedCharacterIds, ...rows(plan.reuseCharacterIds)]),
  ];
  // 2026-10-20 variety: up to seven (the parent picks six companions at most).
  if (charIds.length + rows(plan.newCharacters).length > MAX_CAST)
    errors.push(`주인공을 포함해 등장인물은 ${MAX_CAST}명 이하로 골라 주세요.`);
  if (
    rows(plan.newCharacters).length > 2 ||
    rows(plan.newBackgrounds).length > 3
  )
    errors.push("새 조연은 최대 2명, 새 배경은 최대 3곳이에요.");
  if (
    !allowNew &&
    (rows(plan.newCharacters).length || rows(plan.newBackgrounds).length)
  )
    errors.push("이번에는 기존 재료만 사용해 주세요.");
  const names = new Set(characters.map((c) => norm(c.name))),
    places = new Set(backgrounds.map((b) => norm(b.name)));
  for (const c of rows(plan.newCharacters)) {
    if (
      !c ||
      !["name", "nameEn", "kind", "description", "catchphrase"].every((k) =>
        validString(c[k]),
      ) ||
      !Array.isArray(c.traits) ||
      c.traits.some((t) => !validString(t))
    )
      errors.push("새 조연의 이름·모습·성격·말버릇을 적어 주세요.");
    if (names.has(norm(c?.name)))
      errors.push(
        "이미 있는 이름의 캐릭터는 새로 만들지 말고 기존 ID를 사용해 주세요.",
      );
    names.add(norm(c?.name));
  }
  for (const b of rows(plan.newBackgrounds)) {
    if (
      !b ||
      !["name", "nameEn", "type", "description", "layout"].every((k) =>
        validString(b[k]),
      )
    )
      errors.push("새 배경의 이름·종류·특징·고정 구조를 적어 주세요.");
    if (places.has(norm(b?.name)))
      errors.push("이미 있는 이름의 배경은 기존 ID를 사용해 주세요.");
    places.add(norm(b?.name));
  }
  const selected = [...new Set(rows(plan.reuseBackgroundIds))]
    .map((id) => backgrounds.find((b) => b.id === id))
    .filter(Boolean)
    .concat(rows(plan.newBackgrounds).filter(Boolean));
  if (selected.length > 5) errors.push("사용할 배경은 최대 5곳이에요.");
  if (!selected.some(isHomeBackground))
    errors.push("출발과 귀가에 사용할 집·방 배경을 골라 주세요.");
  if (selected.filter((b) => !isHomeBackground(b)).length < 2)
    errors.push("집·방 외에 주제에 맞는 서로 다른 배경 2곳이 필요해요.");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
export function materializeAutoPlan(
  plan,
  job,
  { characters = [], backgrounds = [] } = {},
) {
  const now = new Date().toISOString(),
    uid = (prefix) => prefix + "-" + crypto.randomUUID();
  const newCharacters = plan.newCharacters.map((c) => ({
    ...structuredClone(c),
    id: uid("character"),
    role: "조연",
    version: 1,
    color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "#a8bb91",
    appearance: c.description,
    clothes: c.description,
    hairColor: "#493b34",
    skinColor: "#edceb3",
    wardrobe: [],
    characterSheets: [],
    source: "full-auto",
    autoRunId: job.id,
    autoReviewPending: true,
    createdAt: now,
  }));
  const newBackgrounds = plan.newBackgrounds.map((b) => ({
    ...structuredClone(b),
    id: uid("background"),
    version: 1,
    source: "full-auto",
    autoRunId: job.id,
    autoReviewPending: true,
    createdAt: now,
  }));
  return {
    ...structuredClone(plan),
    newCharacters,
    newBackgrounds,
    characterIds: [
      ...new Set([
        ...job.wizard.characterIds,
        ...plan.reuseCharacterIds,
        ...newCharacters.map((c) => c.id),
      ]),
    ],
    backgroundIds: [
      ...new Set([
        ...plan.reuseBackgroundIds,
        ...newBackgrounds.map((b) => b.id),
      ]),
    ],
    existingSignatures: Object.fromEntries(
      [
        ...characters.filter(
          (c) =>
            job.wizard.characterIds.includes(c.id) ||
            plan.reuseCharacterIds.includes(c.id),
        ),
        ...backgrounds.filter((b) => plan.reuseBackgroundIds.includes(b.id)),
      ].map((item) => [item.id, materialSignature(item)]),
    ),
  };
}
export function materialSignature(item) {
  return JSON.stringify({
    name: item.name,
    nameEn: item.nameEn,
    version: item.version || 1,
    description: item.description || item.features || "",
    kind: item.kind,
    type: item.type,
    layout: item.layout,
    traits: item.traits,
    clothes: item.clothes,
    archivedAt: item.archivedAt || null,
  });
}
