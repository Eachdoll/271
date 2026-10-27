/*
 * Deterministic clean-up of a paid outline RESPONSE before the app checks it.
 * Only the response is touched, never a request: a saved checkpoint replays the
 * same requests, and a book stopped by one of these book-keeping slips resumes
 * from its saved responses with no new paid call. A valid outline comes back
 * unchanged (deep-equal), and story content is never invented: values are
 * mapped to the ids the app already knows, trimmed to the schema's counts, or
 * carried forward from the model's own earlier state.
 */
import { PLOT_CONTRACT_SCHEMA } from "./plot-contract.js";
import { settlePicturePlans } from "./picture-plan.js";
import { settleStoryChange } from "./story-change.js";
import { settleStoryDrama, settleDramaPlans } from "./story-drama.js";
import { settlePockets } from "../text-pocket.js";
import { settleRelations } from "./story-cast.js";
import { normalizeFailureReason } from "../story-quality/dist/plotCheck.js";

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value, max) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const integer = (value) =>
  typeof value === "string" && /^\s*\d{1,3}\s*$/u.test(value)
    ? Number(value)
    : value;
const key = (value) =>
  typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const canonical = (value) => JSON.stringify(sortValue(value));
function sortValue(value) {
  if (Array.isArray(value))
    return value
      .map(sortValue)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((name) => [name, sortValue(value[name])]),
    );
  return value;
}
const sameSet = (left, right) => canonical(left) === canonical(right);
const unique = (values) => [...new Set(values)];
const BEAT_TYPES = ["setup", "want", "attempt", "turn", "resolution", "close"];
const KOREAN_BEAT_TYPES = Object.freeze({
  시작: "setup",
  도입: "setup",
  발단: "setup",
  바람: "want",
  소망: "want",
  목표: "want",
  시도: "attempt",
  반전: "turn",
  전환: "turn",
  해결: "resolution",
  마무리: "close",
  결말: "close",
  끝: "close",
});
const REASONS = ["wrong_place", "wrong_method", "interrupted"];

/** Maps a selected character's id, Korean name or English name to its id. */
export function castLookup(input = {}) {
  const map = new Map();
  for (const c of list(input.characters))
    if (object(c) && c.id)
      for (const value of [c.id, c.name, c.nameEn])
        if (key(value) && !map.has(key(value))) map.set(key(value), c.id);
  return (value) => map.get(key(value));
}
/** Maps a drawer background's id, name, English name or alias to its id. */
export function placeLookup(input = {}) {
  const map = new Map();
  for (const b of list(input.backgrounds || input.backgroundList))
    if (object(b) && b.id)
      for (const value of [b.id, b.name, b.nameEn, ...list(b.aliases)])
        if (key(value) && !map.has(key(value))) map.set(key(value), b.id);
  return (value) => map.get(key(value));
}
export const allowedPlaces = (input = {}) =>
  new Set(
    list(input.backgrounds || input.backgroundList)
      .map((b) => b?.id)
      .filter(Boolean),
  );

/**
 * Selected cast ids for a list a model wrote (ids, names or English names).
 * Entries outside the cast are returned separately: they cannot be drawn
 * (no character sheet) and the summary still mentions them.
 */
export function mapCast(values, input) {
  const castId = castLookup(input),
    kept = [],
    dropped = [];
  for (const value of list(values)) {
    const id = castId(value);
    if (id) {
      if (!kept.includes(id)) kept.push(id);
    } else if (typeof value === "string" && value.trim())
      dropped.push(value.trim());
  }
  return { kept, dropped };
}

/** Balanced-brace JSON extraction: commentary before/after the JSON or a fence anywhere. */
export function extractJsonText(source) {
  const value = String(source ?? "");
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  for (const candidate of [fenced?.[1], value]) {
    if (!candidate) continue;
    const starts = ["{", "["]
      .map((char) => candidate.indexOf(char))
      .filter((at) => at >= 0);
    if (!starts.length) continue;
    const start = Math.min(...starts),
      open = candidate[start],
      close = open === "{" ? "}" : "]";
    let depth = 0,
      inString = false,
      escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const char = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === open) depth++;
      else if (char === close && --depth === 0)
        return candidate.slice(start, i + 1);
    }
  }
  return null;
}
/** JSON.parse with the fence strip the app always used, then the balanced extraction. */
export function parseJsonLenient(source) {
  const raw = String(source ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(raw);
  } catch {
    const slice = extractJsonText(source);
    if (!slice) return null;
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
}

function pruneToSchema(schema, value) {
  if (schema.anyOf) {
    const numeric = schema.anyOf.find((option) => option.type === "integer");
    return numeric ? integer(value) : value;
  }
  if (schema.type === "object" && object(value)) {
    const out = {};
    for (const [name, item] of Object.entries(value))
      if (Object.hasOwn(schema.properties, name))
        out[name] = pruneToSchema(schema.properties[name], item);
    return out;
  }
  if (schema.type === "array" && Array.isArray(value))
    return value.map((item) => pruneToSchema(schema.items, item));
  if (schema.type === "integer") return integer(value);
  return value;
}

/**
 * Ledger book-keeping the checks require and a model often slips on: ids
 * written as names, an unknown owner, places written as names, fields outside
 * the schema, numbers as strings, the causal back-link, stateBefore = the
 * previous stateAfter, retained knowledge, props and offscene cast carried
 * forward, a prop's first name, and the openPromises arithmetic. A count
 * mismatch, a payoff without a setup or an unclosed setup are left for the
 * checks (they are story content, not book-keeping).
 */
export function normalizePlotContract(source, outline, input = {}) {
  if (!object(source)) return { contract: source, notes: [] };
  const notes = [],
    castId = castLookup(input),
    placeId = placeLookup(input),
    allowed = allowedPlaces(input),
    castIds = list(input.characters)
      .map((c) => c?.id)
      .filter(Boolean),
    contract = pruneToSchema(PLOT_CONTRACT_SCHEMA, clone(source));
  if (!same(Object.keys(contract), Object.keys(source)))
    notes.push("플롯 장부의 정해지지 않은 필드를 뺐어요.");
  if (castId(contract.protagonistId) && castId(contract.protagonistId) !== contract.protagonistId)
    contract.protagonistId = castId(contract.protagonistId);
  const beats = list(contract.beats),
    outlineBeats = list(outline?.beats),
    firstName = new Map(),
    droppedCast = new Set();
  const placeOf = (value, fallback) => {
    if (!allowed.size || allowed.has(value)) return value;
    const mapped = placeId(value);
    if (mapped && allowed.has(mapped)) return mapped;
    return allowed.has(fallback) ? fallback : value;
  };
  const cleanState = (state, here) => {
    const source = object(state) ? state : {},
      people = [],
      props = [];
    for (const row of list(source.characters)) {
      if (!object(row)) continue;
      const id = castId(row.characterId);
      if (!id) {
        if (typeof row.characterId === "string") droppedCast.add(row.characterId);
        continue;
      }
      if (people.some((person) => person.characterId === id)) continue;
      people.push({
        ...row,
        characterId: id,
        locationId: placeOf(row.locationId, here),
        knows: unique(
          list(row.knows).filter((fact) => typeof fact === "string" && fact.trim()),
        ),
      });
    }
    for (const prop of list(source.props)) {
      if (!object(prop) || typeof prop.id !== "string") continue;
      if (props.some((row) => row.id === prop.id)) continue;
      if (!firstName.has(prop.id) && text(prop.name, 100))
        firstName.set(prop.id, prop.name);
      const owner =
        prop.ownerId === null || castIds.includes(prop.ownerId)
          ? prop.ownerId
          : (castId(prop.ownerId) ?? null);
      props.push({
        ...prop,
        name: firstName.get(prop.id) ?? prop.name,
        ownerId: owner,
        locationId: placeOf(prop.locationId, here),
      });
    }
    return {
      ...source,
      characters: people,
      props,
      openPromises: unique(
        list(source.openPromises).filter((id) => typeof id === "string"),
      ),
    };
  };
  let previous = null;
  beats.forEach((beat, index) => {
    if (!object(beat)) return;
    if (
      outlineBeats.length === beats.length &&
      Number.isInteger(outlineBeats[index]?.index) &&
      beat.beatIndex !== outlineBeats[index].index
    )
      beat.beatIndex = outlineBeats[index].index;
    const because = index === 0 ? null : (beats[index - 1]?.beatIndex ?? null);
    if (beat.becauseOfBeatIndex !== because) beat.becauseOfBeatIndex = because;
    for (const name of ["setupIds", "payoffIds"])
      if (!Array.isArray(beat[name]) || new Set(beat[name]).size !== beat[name].length)
        beat[name] = unique(list(beat[name]).filter((id) => typeof id === "string"));
    const here = placeOf(outlineBeats[index]?.settingKey, null);
    let before = cleanState(beat.stateBefore, here);
    if (previous) {
      if (!sameSet(before, previous)) before = clone(previous);
    } else {
      for (const id of castIds)
        if (!before.characters.some((row) => row.characterId === id))
          before.characters.push({ characterId: id, locationId: here, knows: [] });
      if (before.openPromises.length) before.openPromises = [];
    }
    const after = cleanState(beat.stateAfter, here);
    for (const row of before.characters) {
      const next = after.characters.find(
        (person) => person.characterId === row.characterId,
      );
      if (!next) after.characters.push(clone(row));
      else {
        const lost = row.knows.filter((fact) => !next.knows.includes(fact));
        if (lost.length) next.knows = [...next.knows, ...lost];
      }
    }
    for (const prop of before.props)
      if (!after.props.some((row) => row.id === prop.id))
        after.props.push(clone(prop));
    const expected = unique([...before.openPromises, ...beat.setupIds]).filter(
      (id) => !beat.payoffIds.includes(id),
    );
    if (!sameSet(after.openPromises, expected)) after.openPromises = expected;
    beat.stateBefore = before;
    beat.stateAfter = after;
    previous = after;
  });
  if (droppedCast.size)
    notes.push(
      `플롯 장부의 선택하지 않은 인물(${[...droppedCast].slice(0, 3).join(", ")})은 상태 기록에서 뺐어요.`,
    );
  if (!same(contract, source))
    notes.push("플롯 장부의 ID·상태 이어짐 기록을 앞 비트와 맞게 정리했어요.");
  return { contract, notes: unique(notes) };
}

/**
 * Shape clean-up for an outline response, used in both the quality and the
 * plain path before the checks: counts trimmed to the schema, numbers as
 * strings, place and cast names mapped to ids, the settings rows rebuilt one
 * per beat, the twist from plan.twistReveal, an invalid endingType, refrain
 * indexes, Korean beat types and failure reasons, and the ledger
 * (normalizePlotContract). Returns { outline, notes }.
 */
export function normalizeOutlineResponse(source, input = {}) {
  if (!object(source) || !Array.isArray(source.beats))
    return { outline: source, notes: [] };
  const outline = clone(source),
    notes = [],
    placeId = placeLookup(input),
    allowed = allowedPlaces(input),
    beats = outline.beats,
    count = beats.length,
    types = [
      "setup",
      "want",
      ...Array.from({ length: Math.max(0, count - 5) }, () => "attempt"),
      "turn",
      "resolution",
      "close",
    ];
  const toPlace = (value) => {
    if (!allowed.size || allowed.has(value)) return value;
    const mapped = placeId(value);
    return mapped && allowed.has(mapped) ? mapped : value;
  };
  beats.forEach((beat, index) => {
    if (!object(beat)) return;
    const number = integer(beat.index);
    if (number !== beat.index) beat.index = number;
    if (
      !BEAT_TYPES.includes(beat.type) &&
      KOREAN_BEAT_TYPES[String(beat.type ?? "").trim()] === types[index]
    )
      beat.type = types[index];
    if (Array.isArray(beat.characters)) {
      const { kept, dropped } = mapCast(beat.characters, input);
      if (dropped.length)
        notes.push(
          `${beat.index}번 비트의 선택하지 않은 등장인물(${dropped.join(", ")})은 그림 인물 목록에서 뺐어요.`,
        );
      if (!same(kept, beat.characters)) beat.characters = kept;
    }
    const place = toPlace(beat.settingKey);
    if (place !== beat.settingKey) beat.settingKey = place;
    if (typeof beat.failureReason === "string" && !REASONS.includes(beat.failureReason)) {
      const id = normalizeFailureReason(beat.failureReason);
      if (REASONS.includes(id)) beat.failureReason = id;
    }
  });
  // settings: one row per beat, from the model's rows or the beat's own place
  const ids = beats.map((beat) => beat?.index);
  if (Array.isArray(outline.settings)) {
    outline.settings = outline.settings.map((row) => {
      if (!object(row)) return row;
      const next = { ...row },
        number = integer(row.beatIndex);
      if (number !== row.beatIndex) next.beatIndex = number;
      const place = toPlace(row.backgroundId);
      if (place !== row.backgroundId) next.backgroundId = place;
      if (
        Object.hasOwn(next, "newPlace") &&
        (next.newPlace === null ||
          next.newPlace === "" ||
          (allowed.has(next.backgroundId) && next.newPlace !== undefined))
      )
        delete next.newPlace;
      return same(next, row) ? row : next;
    });
  }
  const rows = list(outline.settings),
    onePerBeat =
      rows.length === count &&
      rows.every((row) => object(row) && ids.includes(row.beatIndex)) &&
      new Set(rows.map((row) => row.beatIndex)).size === count;
  if (!onePerBeat && count) {
    outline.settings = beats.map((beat) => {
      const row = rows.find(
          (item) => object(item) && item.beatIndex === beat?.index,
        ),
        backgroundId = allowed.has(row?.backgroundId)
          ? row.backgroundId
          : allowed.has(beat?.settingKey)
            ? beat.settingKey
            : row?.backgroundId;
      return {
        ...(row || {}),
        beatIndex: beat?.index,
        ...(backgroundId ? { backgroundId } : {}),
      };
    });
    notes.push("배경 설정을 비트마다 하나씩 맞췄어요.");
  }
  for (const beat of beats) {
    if (!object(beat) || !allowed.size) continue;
    const row = list(outline.settings).find(
      (item) => object(item) && item.beatIndex === beat.index,
    );
    if (!row) continue;
    const keyOk = allowed.has(beat.settingKey),
      rowOk = allowed.has(row.backgroundId);
    if (!keyOk && rowOk) beat.settingKey = row.backgroundId;
    else if (keyOk && !rowOk) row.backgroundId = beat.settingKey;
  }
  // titles, new words and the emotion arc: the schema's counts
  const castName = list(input.characters)[0]?.name;
  if (
    !Array.isArray(outline.titleCandidates) ||
    outline.titleCandidates.length !== 3 ||
    !outline.titleCandidates.every((title) => text(title, 100))
  ) {
    const titles = unique(
      list(outline.titleCandidates)
        .filter((title) => typeof title === "string")
        .map((title) => title.trim().slice(0, 100))
        .filter(Boolean),
    );
    const pool = [
      input.topic,
      castName ? `${castName}의 이야기` : "",
      castName ? `${castName}의 하루` : "",
    ]
      .filter((title) => typeof title === "string")
      .map((title) => title.trim().slice(0, 100))
      .filter(Boolean);
    const filled = unique([...titles, ...pool]).slice(0, 3);
    if (filled.length === 3) {
      notes.push(
        titles.length > 3
          ? "제목 후보가 3개를 넘어 앞의 3개만 남겼어요."
          : "제목 후보를 3개로 맞췄어요.",
      );
      outline.titleCandidates = filled;
    }
  }
  if (
    !Array.isArray(outline.newWordsKo) ||
    outline.newWordsKo.length < 3 ||
    outline.newWordsKo.length > 5 ||
    !outline.newWordsKo.every((word) => text(word, 500))
  ) {
    const words = unique(
      list(outline.newWordsKo)
        .filter((word) => typeof word === "string")
        .map((word) => word.trim())
        .filter((word) => word && word.length <= 500),
    );
    const extra = unique(
      beats
        .map((beat) => (typeof beat?.newElement === "string" ? beat.newElement.trim() : ""))
        .filter((word) => word && word.length <= 500),
    );
    const filled = unique([...words, ...extra]).slice(0, Math.max(3, Math.min(5, words.length)));
    if (filled.length >= 3) {
      outline.newWordsKo = filled;
      notes.push("새 낱말 수를 3~5개로 맞췄어요.");
    }
  }
  if (outline.newWordsEn === undefined || outline.newWordsEn === null) {
    outline.newWordsEn = [];
  } else if (
    Array.isArray(outline.newWordsEn) &&
    (outline.newWordsEn.length > 15 ||
      !outline.newWordsEn.every((word) => text(word, 500)))
  )
    outline.newWordsEn = unique(
      outline.newWordsEn
        .filter((word) => typeof word === "string")
        .map((word) => word.trim())
        .filter((word) => word && word.length <= 500),
    ).slice(0, 15);
  if (Array.isArray(outline.emotionArc) && outline.emotionArc.length !== count) {
    const arc = outline.emotionArc
      .filter((feeling) => text(feeling, 50))
      .map((feeling) => feeling.trim());
    if (arc.length && count >= 6 && count <= 8) {
      outline.emotionArc = Array.from(
        { length: count },
        (_, index) => arc[Math.min(index, arc.length - 1)],
      );
      notes.push("감정 흐름 수를 비트 수에 맞췄어요.");
    }
  }
  // twist (the package template shows only plan.twistReveal), endingType, refrain
  if (!text(outline.twist, 500) && text(outline.plan?.twistReveal, 100000)) {
    outline.twist = outline.plan.twistReveal.trim().slice(0, 500);
    notes.push("반전(twist)을 plan.twistReveal에서 가져왔어요.");
  }
  if (
    !["home_sleep", "open", "custom"].includes(outline.endingType) &&
    ["home_sleep", "open", "custom"].includes(input.endingType)
  )
    outline.endingType = input.endingType;
  if (object(outline.refrain)) {
    const used = outline.refrain.usedAtBeats;
    if (Array.isArray(used)) {
      const next = unique(used.map(integer).filter((at) => ids.includes(at))).slice(0, 3);
      if (!same(next, used)) outline.refrain.usedAtBeats = next;
    }
    if (!text(outline.refrain.text, 150) || !Array.isArray(outline.refrain.usedAtBeats)) {
      delete outline.refrain;
      notes.push("후렴을 읽지 못해 후렴 없이 진행해요.");
    }
  } else if (outline.refrain !== undefined && outline.refrain !== null) {
    delete outline.refrain;
    notes.push("후렴을 읽지 못해 후렴 없이 진행해요.");
  }
  if (object(outline.plan) && Array.isArray(outline.plan.failureReasons)) {
    const reasons = outline.plan.failureReasons.map((reason) =>
      REASONS.includes(reason) ? reason : normalizeFailureReason(reason),
    );
    if (reasons.every((reason) => REASONS.includes(reason)) && !same(reasons, outline.plan.failureReasons))
      outline.plan.failureReasons = reasons;
  }
  if (object(outline.plotContract)) {
    const result = normalizePlotContract(outline.plotContract, outline, input);
    outline.plotContract = result.contract;
    notes.push(...result.notes);
  }
  // R36: the picture plan is cleaned (picture-led diet drafts) or dropped; never a reason to stop.
  settlePicturePlans(outline, input);
  // R38: the change line, the expectation and the ending kind (asked-for drafts only).
  settleStoryChange(outline, input);
  // R39: the drama fields (try kinds, consequences, secret, companion, refrain flip) and the plan's focus/secret/backdrop.
  settleStoryDrama(outline, input);
  settleDramaPlans(outline, input);
  // R40: the plan's text pocket.
  settlePockets(outline, input);
  // R41: the companions' relations.
  settleRelations(outline, input);
  return { outline, notes: unique(notes) };
}
