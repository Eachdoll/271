import { frozenBeatCount } from "./schemas.js";
/* An explicitly selected, authored demonstration. Never an API-error fallback. */
const clone = (value) => JSON.parse(JSON.stringify(value));
const sentences = (text) =>
  String(text || "")
    .match(/[^.!?。！？]+[.!?。！？]*(?:[”’"']|$)?/gu)
    ?.map((s) => s.trim())
    .filter(Boolean) || [];
const splitParagraphs = (text) =>
  String(text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const actions = [
  "The two friends walk beside tall trees while carrying a small picnic bag.",
  "The child opens the picnic bag beside a tree and points toward distant stones.",
  "The child taps a large stone with a small stick beside the forest path.",
  "The companion touches the dusty stone with its nose and sneezes beside the child.",
  "The child lifts a small stone while tiny ants walk across the forest path.",
  "The friends place the stone back and step aside to let the ants pass.",
  "The companion raises a hollow stick while the child listens beside a tree.",
  "The wind lifts a yellow leaf beside a metal lunch box wedged between stones.",
  "The friends point toward the lunch box as air whistles through its open lid.",
  "The child pulls the lunch box from the stones and blows across its rim.",
  "The friends carry the lunch box along the homeward path beneath an orange sky.",
  "The child places the lunch box beside the bed and hugs a soft pillow.",
];
const rows = [
  ["아침 햇살이 길을 비춰요. 두 친구가 소풍을 가요.", "I see our green path."],
  [
    "가방 안에서 소리가 나요. “노래하는 돌을 찾고 싶어!”",
    "We want a singing stone.",
  ],
  ["큰 돌을 톡톡 두드려요. 낮은 소리만 쿵쿵 울려요.", "Tap, tap, a big stone."],
  [
    "코가 돌에 살짝 닿아요. “에취, 이건 아닌 것 같아!”",
    "My friend has a funny sneeze.",
  ],
  [
    "작은 돌들을 하나씩 들어요. 작은 개미들이 줄줄이 나와요.",
    "I see little ants go.",
  ],
  [
    "돌을 다시 살며시 놓아요. 개미에게 작은 길을 내줘요.",
    "We give the ants room.",
  ],
  [
    "친구가 긴 나뭇가지를 들어요. 바람은 가지를 그냥 지나가요.",
    "No song in this stick.",
  ],
  [
    "노란 잎이 공중으로 올라요. 돌 틈에서 후우 소리가 나요.",
    "I hear a new song.",
  ],
  [
    "도시락 통이 바람을 받아요. “아하, 통이 노래하고 있었어!”",
    "Our little box sings in the wind.",
  ],
  [
    "통을 빼자 소리가 멈춰요. 입으로 불자 노래가 나요.",
    "We blow and make our song.",
  ],
  [
    "노랫소리를 따라 집으로 걸어요. 붉은 하늘에 새들이 날아요.",
    "We take our song home.",
  ],
  [
    "통은 침대 옆에 놓아요. 작은 베개를 꼭 안아요.",
    "My soft bed waits for me.",
  ],
];
function typesFor(count) {
  return [
    "setup",
    "want",
    ...Array.from({ length: count - 5 }, () => "attempt"),
    "turn",
    "resolution",
    "close",
  ];
}
const plan = {
  8: [1, 2, 3, 3, 4, 4, 5, 6],
  12: [1, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7],
  16: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8],
  24: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
};
const summaries = {
  setup:
    "아침에 두 친구가 도시락 통을 챙겨 숲길로 소풍을 가요. 바람이 나뭇잎을 흔들어요.",
  want: "주인공은 숲에 있다는 노래하는 돌을 찾고 싶어요. 친구가 돌을 살펴보자고 해요.",
  first:
    "큰 돌을 톡톡 두드리지만 쿵쿵 소리만 나요. 친구는 돌에 코를 대다가 먼지 때문에 에취 재채기를 해요.",
  second:
    "작은 돌을 들자 개미들만 줄줄이 나와요. 둘은 돌을 다시 놓고 개미에게 길을 내줘요.",
  third:
    "빈 나뭇가지를 불어 보아도 소리가 나지 않아요. 둘이 바람을 따라 듣자 돌 틈에서 후우 소리가 나요.",
  turn: "바람이 돌 틈에 낀 빈 도시락 통으로 들어가요. 노래하는 것은 돌이 아니라 도시락 통이었어요.",
  resolution:
    "둘이 통을 꺼내자 노래가 멈춰요. 주인공이 통 가장자리에 입을 대고 불자 같은 소리가 나요.",
  close:
    "두 친구가 직접 만든 노랫소리와 함께 집으로 돌아와요. 통을 침대 옆에 놓고 작은 베개를 안고 잠들어요.",
};
export function demoOutline(input) {
  const count = frozenBeatCount(input),
    types = typesFor(count),
    cast = input.characters.map((c) => c.id),
    background = input.backgrounds?.[0]?.id;
  let attempt = 0;
  const beats = types.map((type, i) => ({
    index: i + 1,
    type,
    summary:
      type === "attempt"
        ? count === 6
          ? `${summaries.first} ${summaries.second} ${summaries.third}`
          : attempt++ === 0
            ? summaries.first
            : attempt === 2
              ? summaries.second
              : summaries.third
        : summaries[type],
    characters: cast,
    settingKey: background || "forest-path",
  }));
  beats[0].summary = `${input.characters.map((c) => c.name).join(", ")}의 소풍날이에요. ${beats[0].summary}`;
  if (input.endingType === "open")
    beats.at(-1).summary +=
      " 잠들기 전에 “내일은 노래하는 나무를 찾아보자!”라고 말해요.";
  return {
    titleCandidates: [
      "바람이 부는 도시락 통",
      "노래하는 돌은 어디에?",
      "숲길에서 찾은 작은 노래",
    ],
    logline:
      "노래하는 돌을 찾던 두 친구가 바람을 담은 도시락 통으로 직접 노래를 만들어요.",
    want: "숲길에서 노래하는 돌을 찾고 싶어요.",
    problem: "돌과 나뭇가지를 살펴보아도 노래가 나지 않아요.",
    beats,
    twist:
      "노래하는 돌 소리는 돌 틈에 낀 빈 도시락 통에 바람이 들어가는 소리였어요.",
    newWordsKo: ["도시락", "가장자리", "바람"],
    newWordsEn: ["stone", "box", "wind"],
    settings: beats.map((b) => ({
      beatIndex: b.index,
      ...(background
        ? { backgroundId: background }
        : {
            newPlace:
              b.type === "close" ? "집 안의 침실" : "나무와 돌이 있는 숲길",
          }),
    })),
    emotionArc: types.map(
      (type) =>
        ({
          setup: "기대",
          want: "호기심",
          attempt: "궁금",
          turn: "놀람",
          resolution: "기쁨",
          close: "편안",
        })[type],
    ),
    endingType: input.endingType,
  };
}
function authoredUnits(count) {
  if (count === 12)
    return rows.map((r, i) => ({
      ko: r[0],
      en: r[1],
      action: actions[i],
      source: i,
    }));
  if (count === 8) {
    const picks = [0, 1, 2, 4, 7, 8, 9, 11];
    return picks.map((i) => ({
      ko: rows[i][0],
      en: rows[i][1],
      action: actions[i],
      source: i,
    }));
  }
  const extras = [
    [
      "가방 끈을 어깨에 걸어요. 작은 통이 달그락 소리를 내요.",
      "The box goes clink in our bag.",
      "The child adjusts the picnic bag strap while a metal box rests inside.",
      1,
    ],
    [
      "개미들이 돌 아래로 들어가요. 두 친구가 조용히 지켜봐요.",
      "The little ants go under a stone.",
      "The friends kneel beside the path and watch ants disappear beneath a stone.",
      5,
    ],
    [
      "바람에 머리카락이 살랑 움직여요. 둘은 귀를 활짝 기울여요.",
      "The wind moves my soft hair.",
      "The child raises a hand beside one ear while wind moves the companion scarf.",
      7,
    ],
    [
      "통의 가장자리에 입을 대요. 친구가 두 손을 들어요.",
      "My friend waves to our song.",
      "The companion raises both hands while the child blows across the lunch box rim.",
      9,
    ],
  ];
  const result = rows.map((r, i) => ({
    ko: r[0],
    en: r[1],
    action: actions[i],
    source: i,
  }));
  for (const e of extras) {
    const where = result.findIndex((u) => u.source === e[3]);
    result.splice(where + 1, 0, {
      ko: e[0],
      en: e[1],
      action: e[2],
      source: e[3],
    });
  }
  if (count === 16) return result;
  const more = [
    [
      "작은 돌이 길에 놓여요. 햇살이 돌 위로 내려요.",
      "The sun makes our stone warm.",
      "The child points at a small stone illuminated by sunlight on the forest path.",
      0,
    ],
    [
      "친구가 큰 돌을 가리켜요. 둘은 돌 앞으로 다가가요.",
      "We go to a big stone.",
      "The companion points toward a large stone while the child steps closer with a stick.",
      2,
    ],
    [
      "친구가 코를 손으로 닦아요. 먼지가 바람을 따라 날아요.",
      "My friend wipes a dusty nose.",
      "The companion wipes its nose while the child holds a cloth beside the dusty stone.",
      3,
    ],
    [
      "숲길 끝에서 바람이 불어요. 가지들이 머리 위에서 흔들려요.",
      "We look at the moving leaves.",
      "The friends stand beneath swaying branches and look up at yellow leaves.",
      6,
    ],
    [
      "통의 뚜껑이 살짝 열려요. 바람이 작은 틈으로 들어가요.",
      "The wind goes into our box.",
      "The child points at the open lunch box lid wedged between two stones.",
      8,
    ],
    [
      "통을 두 손으로 잡아요. 친구가 옆에서 가만히 들어요.",
      "We hold the box up high.",
      "The child holds the metal box with both hands while the companion listens nearby.",
      9,
    ],
    [
      "집 앞에서 문을 열어요. 작은 통을 선반에 올려요.",
      "We open our little home door.",
      "The friends open the home door and place the metal lunch box on a shelf.",
      10,
    ],
    [
      "창문 밖으로 달이 떠올라요. 통의 뚜껑도 살며시 닫아요.",
      "I see the moon at home.",
      "The child closes the lunch box lid beside a bedroom window under moonlight.",
      11,
    ],
  ];
  for (const e of more) {
    const where = result.findLastIndex((u) => u.source === e[3]);
    result.splice(where + 1, 0, {
      ko: e[0],
      en: e[1],
      action: e[2],
      source: e[3],
    });
  }
  return result;
}
export function demoProse(outline, input) {
  const units = authoredUnits(input.pageCount),
    baseline = demoOutline(input),
    mapping = plan[input.pageCount];
  // Direct parent edits are quoted verbatim into the relevant demo beat. No
  // template rewriting silently erases an edited event.
  outline.beats.forEach((beat) => {
    if (
      beat.summary !==
      baseline.beats.find((b) => b.index === beat.index)?.summary
    ) {
      const index = mapping.indexOf(beat.index);
      if (index >= 0) units[index].ko = beat.summary;
    }
  });
  if (input.endingType === "open") {
    units.at(-1).ko += " “내일은 노래하는 나무를 찾자!”";
    units.at(-1).en = "What song can we find tomorrow?";
  }
  const beatIds = outline.beats.map((b) => b.index),
    labels = mapping.every((id) => beatIds.includes(id))
      ? mapping
      : units.map(
          (_, i) =>
            beatIds[
              Math.min(
                beatIds.length - 1,
                Math.floor((i * beatIds.length) / units.length),
              )
            ],
        );
  return {
    ko: units.map((u) => u.ko).join("\n\n"),
    en: units.map((u) => u.en).join("\n\n"),
    usedRefrainAt: [],
    paragraphBeats: { ko: [...labels], en: [...labels] },
  };
}
function spreadProse(text, count) {
  const blocks = splitParagraphs(text);
  if (blocks.length === count) return blocks;
  let units = blocks.flatMap(sentences);
  if (!units.length)
    return Array.from({ length: count }, () => String(text || ""));
  // A shorter approved English prose can have fewer sentences than the new
  // page count. Preserve every word instead of producing empty pages or adding
  // newly authored prose. These shorter fragments remain visible to the checks.
  while (units.length < count) {
    const lengths = units.map((s) => s.split(/\s+/).length),
      index = lengths.indexOf(Math.max(...lengths));
    if (lengths[index] < 2)
      throw new Error(
        "데모 전문이 너무 짧아요. 쪽 수를 줄이거나 전문을 더 작성해 주세요.",
      );
    const words = units[index].split(/\s+/),
      middle = Math.ceil(words.length / 2);
    units.splice(
      index,
      1,
      words.slice(0, middle).join(" "),
      words.slice(middle).join(" "),
    );
  }
  const result = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * units.length) / count),
      end = Math.floor(((i + 1) * units.length) / count);
    result.push(units.slice(start, end).join(" ") || "");
  }
  return result;
}
function wardrobeFor(input, pageNo) {
  const result = {};
  for (const c of input.characters) {
    let id = input.variantByCharacter?.[c.id] || null;
    const rows = Array.isArray(input.variantPageRanges)
      ? input.variantPageRanges.filter((r) => r.characterId === c.id)
      : input.variantPageRanges?.[c.id] || [];
    for (const r of rows)
      if (
        pageNo >= Number(r.from ?? r.fromPage) &&
        pageNo <= Number(r.to ?? r.toPage)
      )
        id = r.variantId || null;
    result[c.id] = id;
  }
  return result;
}
export function demoPagination(outline, prose, input) {
  const count = input.pageCount,
    ko = spreadProse(prose.ko, count),
    en = spreadProse(prose.en, count),
    units = authoredUnits(count),
    beatCount = outline.beats.length;
  // Re-pagination keeps ORIGINAL prose and original outline even after changing
  // count. It never calls the demo prose author again.
  const map =
    beatCount === { 8: 6, 12: 7, 16: 8, 24: 8 }[count]
      ? plan[count]
      : Array.from({ length: count }, (_, i) =>
          Math.min(beatCount, Math.floor((i * beatCount) / count) + 1),
        );
  const turn = outline.beats.find((b) => b.type === "turn");
  if (turn) {
    const first = Math.floor((count * 2) / 3);
    for (let i = 0; i < count; i++) {
      if (i + 1 < first && map[i] >= turn.index) map[i] = turn.index - 1;
      else if (i + 1 === first) map[i] = turn.index;
    }
  }
  map[count - 1] = beatCount;
  const cast = input.characters.map((c) => c.id),
    background = input.backgrounds?.[0]?.id;
  return {
    cover: {
      title: input.title || outline.titleCandidates[0],
      sceneAction:
        "The two friends hold a metal lunch box beside forest stones beneath swaying leaves.",
    },
    pages: Array.from({ length: count }, (_, i) => ({
      pageNo: i + 1,
      beatIndex: map[i],
      textKo: ko[i],
      textEn: en[i],
      scene: {
        who: cast,
        where:
          i === count - 1
            ? "A quiet bedroom at home"
            : background || "A forest path beside trees and stones",
        action: units[i].action,
        emotion:
          i === count - 1
            ? "calm"
            : i >= Math.floor((count * 2) / 3) - 1
              ? "surprised"
              : "curious",
        timeOfDay:
          i === count - 1
            ? "night"
            : i >= count - 3
              ? "evening"
              : i < 2
                ? "morning"
                : "day",
        props:
          i === count - 1
            ? ["metal lunch box", "soft pillow"]
            : ["metal lunch box", i < 6 ? "stone" : "yellow leaf"],
      },
      variantByCharacter: wardrobeFor(input, i + 1),
      isRefrainPage: false,
    })),
  };
}
