import { frozenBeatCount } from "./schemas.js";
import { buildOpeningPlan, normalizeOpenings } from "../book-layout.js";
import { splitSentences } from "../story-quality/dist/util.js";
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
/*
 * R12 openings demo (펼침 구성): one authored paragraph per beat, written for
 * K2/E2 — Korean 12 sentences of 5-7 eojeol, English 4 sentences of 5-9 words
 * from the E2 list — so a pair splits into 6 + 6 and 2 + 2. Other levels reuse
 * this text; the demo is free and is not a quality claim.
 */
const OPENING_DEMO = Object.freeze({
  setup: [
    "아침 햇살이 숲길 위에 반짝 내려요. 두 친구가 작은 가방을 메고 나와요. 가방 안에는 빈 도시락 통이 있어요. 친구가 통을 손가락으로 톡톡 두드려요. 길가의 나뭇잎이 바람에 살랑살랑 흔들려요. 두 친구는 나란히 숲으로 걸어가요. 새 한 마리가 나무 위에서 노래해요. “오늘은 숲에서 멋진 걸 찾자!” 친구가 손을 흔들며 크게 외쳐요. 다른 친구도 활짝 웃으며 고개를 끄덕여요. 두 친구의 발소리가 사뿐사뿐 울려요. 숲길 끝에서 시원한 바람이 불어와요.",
    "The sun is up over the woods. We put a little box in my bag. “We will look for a stone,” I said. The wind makes a whoosh in the tree.",
  ],
  want: [
    "숲 입구에 커다란 나무가 서 있어요. 나무 옆에 작은 팻말이 붙어 있어요. 팻말에는 노래하는 돌 그림이 있어요. “노래하는 돌을 꼭 찾고 싶어!” 친구가 팻말을 손으로 가리켜요. 다른 친구가 팻말을 가만히 들여다봐요. 두 친구는 귀를 쫑긋 세워요. 멀리서 후우 하는 소리가 들려요. 소리는 금방 다시 조용해져요. 친구가 가방 끈을 꼭 잡아요. 두 친구는 소리 나는 쪽으로 걸어요. 발밑의 흙이 촉촉하고 부드러워요.",
    "A picture is on the big tree. It is a picture of a little stone. “I want to find that stone,” my friend said. A song comes from the woods.",
  ],
  attempt1: [
    "길 위에 큰 돌 하나가 있어요. 친구가 막대기로 돌을 톡톡 쳐요. 돌에서는 쿵쿵 낮은 소리만 나요. “이 돌은 노래를 안 해.” 다른 친구가 돌에 코를 대 봐요. 돌 위의 먼지가 코를 간질여요. 친구가 에취 하고 재채기를 해요. 먼지가 햇빛 속에서 반짝 날아요. 두 친구는 돌을 한 번 더 봐요. 큰 돌은 아무 소리도 내지 않아요. 친구가 막대기를 가방에 다시 넣어요. 두 친구는 다음 돌을 찾아 걸어요.",
    "A big stone is on the path. My friend hits it with a stick. “No song in this stone,” I said. The big stone is wet from the rain.",
  ],
  attempt2: [
    "풀숲 옆에 작은 돌들이 모여 있어요. 친구가 작은 돌 하나를 들어 올려요. 돌 아래에서 개미들이 줄줄이 나와요. 개미들은 빵 부스러기를 등에 업고 가요. “개미야, 미안해. 길을 비켜 줄게.” 다른 친구가 돌을 살며시 내려놓아요. 개미들이 돌 사이로 바쁘게 지나가요. 두 친구는 무릎을 꿇고 가만히 지켜봐요. 개미 한 마리가 풀잎 위로 올라가요. 풀잎 끝이 아래로 살짝 휘어요. 바람이 다시 후우 하고 지나가요. 두 친구는 소리를 따라 고개를 돌려요.",
    "We look under a little stone. Little ants come out from under it. “Here is your way, ants,” I said. We put the stone down in the sand.",
  ],
  attempt3: [
    "친구가 긴 나뭇가지 하나를 주워요. 나뭇가지 안은 텅 비어 있어요. 친구가 나뭇가지에 입을 대고 불어요. 나뭇가지에서는 아무 소리도 나지 않아요. “이상하다, 여기서는 노래가 안 나.” 다른 친구가 나뭇가지를 귀에 대 봐요. 나뭇가지 속은 조용하기만 해요. 그때 바람이 머리카락을 살랑 흔들어요. 바위 틈에서 후우 소리가 다시 들려요. 두 친구는 서로 눈을 맞춰요. 친구가 바위 쪽을 손가락으로 가리켜요. 두 친구는 살금살금 바위로 다가가요.",
    "My friend finds a long old stick. My friend puts it to her lips. I said, “Where is the song?” The soft wind is by the big stones.",
  ],
  attempts: [
    "길 위에 큰 돌 하나가 있어요. 친구가 막대기로 돌을 톡톡 쳐요. 돌에서는 쿵쿵 낮은 소리만 나요. “이 돌은 노래를 안 해.” 친구가 작은 돌 하나를 들어 올려요. 돌 아래에서 개미들이 줄줄이 나와요. 다른 친구가 돌을 살며시 내려놓아요. 친구가 빈 나뭇가지에 입을 대고 불어요. 나뭇가지에서는 아무 소리도 나지 않아요. 그때 바위 틈에서 후우 소리가 들려요. 두 친구는 서로 눈을 맞춰요. 두 친구는 살금살금 바위로 다가가요.",
    "My friend hits a big stone with a stick. Little ants come out from under a stone. My friend said, “Where is the song?” The soft rain is on the big stones.",
  ],
  turn: [
    "바위 사이에 무언가 반짝 빛나요. 친구가 바위 틈을 가만히 들여다봐요. 바위 틈에 빈 도시락 통이 끼어 있어요. 통 뚜껑이 조금 열려 있어요. 바람이 통 안으로 후우 들어가요. 통이 휘이 하고 노래를 불러요. “아하, 통이 노래하고 있었어!” 다른 친구가 입을 동그랗게 벌려요. 노래하는 것은 돌이 아니었어요. 두 친구는 통을 한참 바라봐요. 바람이 멈추자 노래도 뚝 그쳐요. 친구가 통을 두 손으로 살살 당겨요.",
    "A wet box is in the big stones. It is an old box with an open lid. “The box sings a song,” my friend said. The wind comes into the box.",
  ],
  resolution: [
    "두 친구가 통을 바위에서 꺼내요. 통은 차갑고 조금 무거워요. 통을 꺼내자 노래가 멈춰요. “이제 우리가 노래를 만들어 보자.” 친구가 통 가장자리에 입을 대요. 친구가 통에 후우 바람을 불어요. 통에서 휘이 노래가 다시 나와요. 다른 친구도 차례로 통을 불어요. 두 친구의 노래가 숲에 퍼져요. 새들이 나뭇가지 위에서 짹짹 따라 해요. 친구가 통 뚜껑을 살며시 닫아요. 두 친구는 통을 가방에 넣어요.",
    "We take the box out of the stones. My friend puts the box to her lips. We blow, and a song comes out. “We can make it again,” I said.",
  ],
  close: [
    "해가 숲 너머로 천천히 내려가요. 두 친구가 집으로 걸어와요. 하늘이 주황빛으로 곱게 물들어요. 친구가 현관문을 살며시 열어요. 집 안에서 따뜻한 빵 냄새가 나요. 친구가 통을 침대 옆에 놓아요. 창밖으로 둥근 달이 떠올라요. “잘 자, 노래하는 도시락 통아.” 친구가 작은 베개를 꼭 안아요. 다른 친구는 이불을 폭신폭신 덮어요. 방 안이 조용하고 포근해져요. 두 친구는 스르르 눈을 감아요.",
    "We walk home under the red sky. I put the box by my soft bed. “Thank you, little box,” I said. The moon is up over my home.",
  ],
});
/** The demo paragraph key of every beat: attempts in order, or one combined attempt. */
function openingDemoKeys(outline) {
  const attempts = outline.beats.filter((beat) => beat.type === "attempt").length;
  let attempt = 0;
  return outline.beats.map((beat) =>
    beat.type === "attempt"
      ? attempts === 1
        ? "attempts"
        : `attempt${Math.min(3, ++attempt)}`
      : OPENING_DEMO[beat.type]
        ? beat.type
        : "setup",
  );
}
/** Openings demo prose: one paragraph per approved beat (a beat is an opening). */
function demoOpeningsProse(outline, input) {
  const baseline = demoOutline(input),
    keys = openingDemoKeys(outline),
    ko = keys.map((key) => OPENING_DEMO[key][0]),
    en = keys.map((key) => OPENING_DEMO[key][1]);
  // A parent's beat edit is quoted verbatim into that beat, as in page demos.
  outline.beats.forEach((beat, index) => {
    if (
      beat.summary !==
      baseline.beats.find((b) => b.index === beat.index)?.summary
    )
      ko[index] = beat.summary;
  });
  if (input.endingType === "open") {
    ko[ko.length - 1] += " “내일은 노래하는 나무를 찾자!”";
    const last = sentences(en.at(-1));
    en[en.length - 1] = [...last.slice(0, -1), "What song can we find tomorrow?"].join(" ");
  }
  const labels = outline.beats.map((beat) => beat.index);
  return {
    ko: ko.join("\n\n"),
    en: en.join("\n\n"),
    usedRefrainAt: [],
    paragraphBeats: { ko: [...labels], en: [...labels] },
  };
}
export function demoProse(outline, input) {
  if (input.layoutPolicy?.kind === "openings")
    return demoOpeningsProse(outline, input);
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
export function wardrobeFor(input, pageNo) {
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
/* Openings demo scenes per demo paragraph: [spread, left page, right page]. */
const OPENING_ACTIONS = Object.freeze({
  setup: [
    "The two friends walk along the sunny forest path while one carries a small picnic bag.",
    "The child taps a metal lunch box inside a picnic bag beside the open front door.",
    "The two friends walk side by side into the forest while leaves sway above them.",
  ],
  want: [
    "The friends stand beneath a big tree and point at a small sign with a stone picture.",
    "The companion points at a small wooden sign nailed beside a big tree trunk.",
    "The two friends lift their heads and listen while walking toward the distant sound.",
  ],
  attempt1: [
    "The child taps a large stone with a small stick while the companion leans closer.",
    "The child taps a large stone on the path with a small stick and listens.",
    "The companion touches the dusty stone with its nose and sneezes beside the child.",
  ],
  attempt2: [
    "The friends lift a small stone while tiny ants march out along the grass.",
    "The child lifts a small stone while tiny ants walk out from underneath it.",
    "The friends kneel beside the grass and watch the ants pass between the stones.",
  ],
  attempt3: [
    "The companion blows into a hollow stick while the child listens beside the rocks.",
    "The companion picks up a long hollow stick and blows into one end of it.",
    "The two friends walk on tiptoe toward the big rocks while wind moves their hair.",
  ],
  attempts: [
    "The friends tap a big stone, lift a small one and blow a hollow stick on the path.",
    "The child taps a large stone with a stick while ants walk from a small stone.",
    "The companion blows into a hollow stick and both friends tiptoe toward the rocks.",
  ],
  turn: [
    "The friends kneel by the big rocks and find a metal lunch box wedged between them.",
    "The child peeks between two big rocks at a shiny metal lunch box with an open lid.",
    "The companion points at the lunch box as wind blows across its open lid.",
  ],
  resolution: [
    "The friends pull the lunch box from the rocks and blow across its metal rim.",
    "The two friends pull the metal lunch box out from between the rocks together.",
    "The child blows across the lunch box rim while birds sit on a branch above.",
  ],
  close: [
    "The child places the lunch box beside the bed and hugs a soft pillow under moonlight.",
    "The friends walk home along the path beneath an orange evening sky.",
    "The child places the lunch box beside the bed and hugs a soft pillow.",
  ],
});
/**
 * R12 openings demo pagination: openings 1, the turn and the close are spreads,
 * the others are pairs split at the middle sentence. The app derives kind,
 * side, opening number and entry id through normalizeOpenings.
 */
function demoOpeningsPagination(outline, prose, input) {
  const count = outline.beats.length,
    plan = buildOpeningPlan(outline, count),
    keys = openingDemoKeys(outline),
    turn = outline.beats.findIndex((beat) => beat.type === "turn"),
    spreads = new Set([0, turn, count - 1]),
    cast = input.characters.map((c) => c.id),
    background = input.backgrounds?.[0]?.id,
    beatText = (language, beatIndex) => {
      const labels = prose.paragraphBeats?.[language] || [],
        rows = splitParagraphs(prose[language]);
      return rows.filter((_, i) => labels[i] === beatIndex).join(" ");
    };
  const entries = [];
  outline.beats.forEach((beat, k) => {
    const actions = OPENING_ACTIONS[keys[k]] || OPENING_ACTIONS.setup,
      last = k === count - 1,
      scene = (action) => ({
        who: cast,
        where: last
          ? "A quiet bedroom at home"
          : background || "A forest path beside trees and stones",
        action,
        emotion: last ? "calm" : k >= turn && turn >= 0 ? "surprised" : "curious",
        timeOfDay: last ? "night" : k >= count - 2 ? "evening" : k < 1 ? "morning" : "day",
        props: last
          ? ["metal lunch box", "soft pillow"]
          : ["metal lunch box", k < 3 ? "stone" : "yellow leaf"],
      }),
      ko = beatText("ko", beat.index),
      en = beatText("en", beat.index),
      base = {
        beatIndex: beat.index,
        variantByCharacter: wardrobeFor(input, plan[k].printedPages[0]),
        isRefrainPage: false,
      };
    if (spreads.has(k))
      entries.push({
        ...base,
        textKo: ko,
        textEn: en,
        scene: scene(actions[0]),
        cue: k === 0 ? "arrival" : last ? "ending" : "turn",
      });
    else {
      const koRows = splitSentences(ko),
        enRows = splitSentences(en),
        koCut = Math.ceil(koRows.length / 2),
        enCut = Math.ceil(enRows.length / 2);
      entries.push(
        {
          ...base,
          textKo: koRows.slice(0, koCut).join(" "),
          textEn: enRows.slice(0, enCut).join(" "),
          scene: scene(actions[1]),
          cue: "two-moments",
        },
        {
          ...base,
          variantByCharacter: wardrobeFor(input, plan[k].printedPages[1]),
          textKo: koRows.slice(koCut).join(" "),
          textEn: enRows.slice(enCut).join(" "),
          scene: scene(actions[2]),
          cue: "two-moments",
        },
      );
    }
  });
  entries.forEach((entry, index) => (entry.pageNo = index + 1));
  const fixed = normalizeOpenings(entries, plan, input.specs);
  return {
    cover: {
      title: input.title || outline.titleCandidates[0],
      sceneAction:
        "The two friends hold a metal lunch box beside forest stones beneath swaying leaves.",
    },
    pages: fixed.pages,
    openingAdjustments: fixed.openingAdjustments,
    mixNote: fixed.mixNote,
  };
}
export function demoPagination(outline, prose, input) {
  if (input.layoutPolicy?.kind === "openings")
    return demoOpeningsPagination(outline, prose, input);
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
