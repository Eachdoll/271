/* 동화공방: deterministic, offline picture-book samples and original SVG art. */

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
const clean = (value, max = 140) =>
  String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, max);
const color = (value, fallback) =>
  /^#[\da-f]{3,8}$/i.test(String(value)) ? value : fallback;
const hash = (value) =>
  [...String(value)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `book-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function safeTopic(topic) {
  const text = clean(topic, 160);
  if (!text)
    return {
      ok: false,
      message: "어떤 이야기를 만들까요? 주제를 한 줄 적어 주세요.",
    };
  if (
    /(자살|자해|살인|성폭력|음란|포르노|학대|고문|총으로 쏘|칼로 찌|혼자 불을|낯선 사람.*따라|suicide|porn|torture|sexual abuse)/i.test(
      text,
    )
  ) {
    return {
      ok: false,
      message:
        "어린이를 위한 포근한 주제로 바꿔 주세요. 친구, 자연, 작은 모험을 추천해요.",
    };
  }
  return { ok: true, message: "", topic: text };
}

export const themes = {
  dinosaur: {
    label: "공룡",
    title: "유하와 초록빛 공룡",
    titleEn: "Yuha and the Little Dinosaur",
    series: "유하의 숲속 친구들",
    color: "#9ab783",
    friend: "초록이",
    friendEn: "Greenie",
  },
  moon: {
    label: "달",
    title: "달까지, 사뿐사뿐",
    titleEn: "A Little Trip to the Moon",
    series: "유하의 작은 우주",
    color: "#a8adca",
    friend: "토토",
    friendEn: "Toto",
  },
  rain: {
    label: "비 오는 날",
    title: "빗방울도 친구가 돼요",
    titleEn: "Hello, Little Raindrop",
    series: "유하의 반짝이는 하루",
    color: "#a9c0c1",
    friend: "토토",
    friendEn: "Toto",
  },
  sea: {
    label: "바다",
    title: "바다가 보내 온 선물",
    titleEn: "A Little Gift from the Sea",
    series: "유하의 바다 산책",
    color: "#90bec4",
    friend: "엄마",
    friendEn: "Mom",
  },
  custom: {
    label: "작은 모험",
    title: "유하의 새로운 하루",
    titleEn: "Yuha’s Little Adventure",
    series: "우리 집 작은 이야기",
    color: "#c5b89b",
    friend: "토토",
    friendEn: "Toto",
  },
};

function detectTheme(topic = "") {
  if (/공룡|dinosaur|티라노|브라키오/i.test(topic)) return "dinosaur";
  if (
    /달(?:나라|빛|까지| 여행|에|을)|(?:^|\s)달(?:\s|$)|우주|별(?:나라|빛|을|이| 보기)|로켓|moon|space|star/i.test(
      topic,
    )
  )
    return "moon";
  if (/비.*(날|오)|빗|우비|우산|rain|장마/i.test(topic)) return "rain";
  if (/바다|해변|물고기|조개|고래|sea|ocean|beach/i.test(topic)) return "sea";
  return "custom";
}

// Each row describes one page: Korean, independently written English, scene beat, visible object.
const STORIES = {
  dinosaur: [
    [
      "아침 햇살이 반짝여요. {name}는 숲으로 걸어요.",
      "Let’s go to the woods.",
      "depart",
      "flowers",
    ],
    [
      "풀잎 뒤에서 바스락! 작은 꼬리가 보여요.",
      "I see a little tail.",
      "discover",
      "tail",
    ],
    [
      "“안녕!” {name}가 손을 흔들어요. 작은 공룡도 웃어요.",
      "Hello, little dinosaur!",
      "hello",
      "dinosaur",
    ],
    [
      "공룡의 이름은 {friend}예요. 초록빛 잎을 좋아해요.",
      "You like green leaves.",
      "friend",
      "leaves",
    ],
    [
      "높은 가지에 맛있는 잎이 있어요. {friend}는 닿지 않아요.",
      "The leaves are up high.",
      "problem",
      "high-leaves",
    ],
    [
      "{name}가 땅에 떨어진 잎을 찾아요. “여기 있어!”",
      "Here is a little leaf.",
      "search",
      "leaf",
    ],
    [
      "{name}가 잎을 건네요. {friend}는 냠냠 먹어요.",
      "One leaf for you.",
      "share",
      "leaf",
    ],
    [
      "둘은 나란히 걸어요. 쿵쿵, 사뿐사뿐!",
      "We walk together.",
      "walk",
      "path",
    ],
    [
      "작은 꽃이 길가에 피었어요. {name}도 꽃처럼 웃어요.",
      "I see a little flower.",
      "wonder",
      "flowers",
    ],
    [
      "{friend}가 예쁜 돌을 보여 줘요. {name}는 살며시 만져요.",
      "A little stone for you.",
      "gift",
      "stone",
    ],
    [
      "노을이 숲을 물들여요. “내일 또 만나!”",
      "See you tomorrow, friend.",
      "goodbye",
      "sunset",
    ],
    [
      "집에서 {name}는 눈을 감아요. 꿈에서도 사뿐사뿐.",
      "Good night, little friend.",
      "sleep",
      "home",
    ],
  ],
  moon: [
    [
      "창문에 동그란 달이 떠요. {name}가 달에게 인사해요.",
      "Hello, little moon.",
      "depart",
      "window",
    ],
    [
      "{name}와 {friend}가 상자에 앉아요. 우리만의 로켓이에요.",
      "Here is our little rocket.",
      "discover",
      "rocket",
    ],
    [
      "하나, 둘, 셋! 상자 로켓이 꿈속으로 날아요.",
      "Up, up, up we go!",
      "launch",
      "rocket",
    ],
    [
      "반짝이는 별이 따라와요. {name}도 반짝 웃어요.",
      "I see a little star.",
      "wonder",
      "stars",
    ],
    [
      "달에 사뿐 내려요. 달 먼지가 폭신해요.",
      "Hello, soft little moon.",
      "arrive",
      "moon",
    ],
    [
      "{friend}의 작은 장갑이 없어졌어요. “어디 있지?”",
      "Where is the little glove?",
      "problem",
      "glove",
    ],
    [
      "{name}가 작은 발자국을 찾아요. 둘은 천천히 따라가요.",
      "I see little footprints.",
      "search",
      "footprints",
    ],
    [
      "동그란 돌 뒤에 장갑이 있어요. “찾았다!”",
      "Here is the little glove!",
      "find",
      "glove",
    ],
    [
      "둘은 손을 잡고 폴짝 뛰어요. 달에서도 함께예요.",
      "We hop together.",
      "play",
      "moon",
    ],
    [
      "멀리 파란 지구가 보여요. 우리 집이 기다려요.",
      "I see our blue home.",
      "homeward",
      "earth",
    ],
    [
      "로켓이 사뿐 집에 내려요. 엄마가 따뜻하게 안아요.",
      "A big hug for you.",
      "return",
      "home",
    ],
    [
      "{name}는 이불을 덮어요. 달도 잘 자라고 웃어요.",
      "Good night, little moon.",
      "sleep",
      "moon",
    ],
  ],
  rain: [
    [
      "톡톡, 창문에 비가 와요. {name}가 밖을 보아요.",
      "I hear a little drip.",
      "depart",
      "window",
    ],
    [
      "{name}는 노란 우비를 입어요. 장화도 쏙 신어요.",
      "Hello, yellow boots!",
      "prepare",
      "boots",
    ],
    [
      "엄마와 함께 밖으로 나가요. 우산에 비가 톡톡.",
      "Drip, drop, on we go.",
      "walk",
      "umbrella",
    ],
    [
      "작은 물웅덩이가 반짝여요. {name}가 살짝 첨벙!",
      "Splash, splash, little boots!",
      "play",
      "puddle",
    ],
    [
      "꽃잎 아래 {friend}가 있어요. 귀가 조금 젖었어요.",
      "I see a little friend.",
      "problem",
      "rabbit",
    ],
    [
      "{name}가 우산을 옆으로 옮겨요. “같이 쓰자!”",
      "Come under my umbrella.",
      "share",
      "umbrella",
    ],
    [
      "둘은 비 소리를 들어요. 톡톡, 토독, 톡!",
      "Drip, drop, little rain.",
      "listen",
      "rain",
    ],
    [
      "목마른 꽃이 물을 마셔요. 꽃잎이 쫑긋 올라와요.",
      "A little drink for flowers.",
      "wonder",
      "flowers",
    ],
    [
      "비가 잦아들어요. 구름 사이로 햇살이 빼꼼!",
      "Hello, little sunshine.",
      "clear",
      "sun",
    ],
    [
      "하늘에 무지개가 떠요. {name}가 두 팔을 벌려요.",
      "I see a big rainbow.",
      "rainbow",
      "rainbow",
    ],
    [
      "집에 돌아와 장화를 벗어요. 따뜻한 수건이 보송보송.",
      "Warm and dry, here we are.",
      "return",
      "home",
    ],
    [
      "{name}는 포근한 꿈을 꿔요. 꿈속 빗방울도 톡톡.",
      "Good night, little rain.",
      "sleep",
      "home",
    ],
  ],
  sea: [
    [
      "아침 바람이 살랑 불어요. {name}는 엄마와 바다에 가요.",
      "Let’s go to the sea.",
      "depart",
      "beach",
    ],
    [
      "파도가 밀려와요. {name}는 모래 위에서 인사해요.",
      "Hello, little wave.",
      "hello",
      "wave",
    ],
    [
      "모래 위에 조개가 반짝여요. {name}가 살며시 보아요.",
      "I see a little shell.",
      "discover",
      "shell",
    ],
    [
      "작은 게가 옆으로 걸어요. 옆으로, 옆으로!",
      "Side to side, little crab.",
      "friend",
      "crab",
    ],
    [
      "작은 게 앞에 나뭇가지가 있어요. 길이 막혔어요.",
      "Oh, a stick in the way.",
      "problem",
      "stick",
    ],
    [
      "엄마가 나뭇가지를 옮겨요. {name}는 곁에서 응원해요.",
      "Here is a path for you.",
      "help",
      "path",
    ],
    [
      "게가 다시 옆으로 걸어요. {name}도 손을 흔들어요.",
      "On you go, little crab.",
      "goodbye",
      "crab",
    ],
    [
      "엄마와 모래성을 쌓아요. 작은 조개로 문을 만들어요.",
      "A little castle for us.",
      "build",
      "castle",
    ],
    [
      "파도가 모래성을 살짝 만져요. 물길이 하나 생겨요.",
      "A little wave comes in.",
      "wonder",
      "wave",
    ],
    [
      "{name}는 조개를 다시 놓아요. 바다 친구들의 집이에요.",
      "A little shell stays here.",
      "share",
      "shell",
    ],
    [
      "노을이 바다를 물들여요. {name}는 엄마 손을 잡아요.",
      "Hand in hand, home we go.",
      "homeward",
      "sunset",
    ],
    [
      "집에서 {name}는 눈을 감아요. 꿈속 파도가 찰랑찰랑.",
      "Good night, little sea.",
      "sleep",
      "home",
    ],
  ],
  custom: [
    [
      "{name}에게 새로운 아침이 왔어요. 오늘은 {topic} 이야기예요.",
      "A new day is here.",
      "depart",
      "home",
    ],
    [
      "{name}가 창밖을 보아요. 햇살이 살짝 인사해요.",
      "Hello, little sunshine.",
      "prepare",
      "window",
    ],
    [
      "엄마와 함께 천천히 걸어요. {name}의 발걸음은 사뿐사뿐.",
      "On we go, step by step.",
      "walk",
      "path",
    ],
    [
      "{name}는 {topic} 이야기를 꺼내요. 작은 친구가 귀를 쫑긋 세워요.",
      "Hello, little friend.",
      "discover",
      "rabbit",
    ],
    [
      "친구가 작은 가방을 열어요. 빨간 공이 보이지 않아요.",
      "Where is the little ball?",
      "problem",
      "ball",
    ],
    [
      "{name}가 나무 아래를 살펴요. “여기에 있을까?”",
      "Let’s look under the tree.",
      "search",
      "tree",
    ],
    [
      "풀잎 뒤에 빨간 공이 있어요. {name}가 살며시 꺼내요.",
      "Here is the little ball!",
      "find",
      "ball",
    ],
    [
      "{name}가 친구에게 공을 건네요. 친구가 활짝 웃어요.",
      "A little ball for you.",
      "share",
      "ball",
    ],
    [
      "둘은 공을 데굴데굴 굴려요. 같이 하니 더 재미있어요.",
      "We play together.",
      "play",
      "ball",
    ],
    [
      "{name}가 {topic} 그림을 그려요. 친구도 옆에서 끄적끄적.",
      "A little picture for us.",
      "create",
      "picture",
    ],
    [
      "저녁 햇살이 길게 누워요. {name}는 엄마 손을 잡아요.",
      "Hand in hand, home we go.",
      "homeward",
      "sunset",
    ],
    [
      "{name}는 이불을 덮어요. 새로운 하루가 꿈속에서 반짝여요.",
      "Good night, little friend.",
      "sleep",
      "home",
    ],
  ],
};

const BRIDGES = {
  dinosaur: [
    [
      "풀잎 끝에 이슬이 맺혀요. {name}가 반짝임을 보아요.",
      "I see a little drop.",
      "dew",
    ],
    [
      "꼬리가 살랑살랑 움직여요. {name}가 빙긋 웃어요.",
      "A little tail goes swish.",
      "tail",
    ],
    [
      "{friend}가 고개를 꾸벅 숙여요. 반가운 첫 인사예요.",
      "A little hello for you.",
      "dinosaur",
    ],
    [
      "초록 잎이 바람에 흔들려요. 팔랑팔랑, 팔랑팔랑.",
      "Little leaves go swish.",
      "leaves",
    ],
    [
      "{name}가 나무 아래를 살펴요. 작은 잎들이 보여요.",
      "Let’s look down here.",
      "leaves",
    ],
    [
      "잎 위에 물방울이 반짝여요. {name}가 살며시 집어요.",
      "One little leaf for you.",
      "leaf",
    ],
    [
      "{friend}가 꼬리를 흔들어요. 고마워, 고마워!",
      "Thank you, little friend.",
      "dinosaur",
    ],
    [
      "두 친구의 발자국이 남아요. 큰 발, 작은 발.",
      "Big steps, little steps.",
      "footprints",
    ],
    [
      "꽃 위에 나비가 앉아요. {name}는 조용히 바라봐요.",
      "I see a butterfly.",
      "butterfly",
    ],
    [
      "돌이 손바닥 위에서 반짝여요. {name}의 마음도 반짝.",
      "What a lovely little stone.",
      "stone",
    ],
    [
      "{name}가 숲에 손을 흔들어요. 바람도 살랑 인사해요.",
      "Bye-bye, little woods.",
      "sunset",
    ],
  ],
  moon: [
    [
      "{name}가 별을 하나 찾아요. 반짝반짝, 작은 별.",
      "One little star for you.",
      "stars",
    ],
    [
      "{friend}가 작은 창을 그려요. 상자가 더 근사해져요.",
      "A little window for us.",
      "rocket",
    ],
    [
      "구름이 발아래로 내려가요. {name}는 두 눈을 동그랗게 떠요.",
      "Bye-bye, little clouds.",
      "clouds",
    ],
    [
      "별들이 길을 밝혀요. 반짝반짝, 이쪽이야.",
      "Little stars show the way.",
      "stars",
    ],
    [
      "{name}의 발자국이 콕 남아요. 작은 점이 줄을 이어요.",
      "One little step on the moon.",
      "footprints",
    ],
    [
      "{name}가 친구 손을 잡아요. 둘이 함께 찾아보아요.",
      "We look together.",
      "glove",
    ],
    [
      "둥근 돌도 살며시 살펴요. {name}는 천천히 걸어요.",
      "Let’s look over here.",
      "stone",
    ],
    [
      "{friend}가 장갑을 쏙 껴요. 손가락도 따뜻해져요.",
      "Warm little hands again.",
      "glove",
    ],
    [
      "별빛 아래 둘이 웃어요. 폴짝폴짝, 사뿐사뿐.",
      "Hop, hop, little friends.",
      "stars",
    ],
    [
      "파란 지구가 반짝여요. {name}가 집에 인사해요.",
      "Hello, our little home.",
      "earth",
    ],
    [
      "엄마의 품이 포근해요. {name}도 꼭 안아요.",
      "A little hug for Mom.",
      "home",
    ],
  ],
  rain: [
    [
      "빗방울이 창을 타고 흘러요. {name}가 손가락으로 따라가요.",
      "Down goes a little drop.",
      "window",
    ],
    [
      "노란 모자가 머리를 덮어요. {name}는 준비됐어요.",
      "Ready, little raincoat!",
      "boots",
    ],
    [
      "우산 아래는 아늑해요. 엄마와 나란히 걸어요.",
      "We walk together.",
      "umbrella",
    ],
    [
      "물방울이 동그랗게 튀어요. {name}가 까르르 웃어요.",
      "Splash goes a little drop.",
      "puddle",
    ],
    [
      "{friend}가 코를 씰룩해요. {name}가 손을 흔들어요.",
      "Hello, little rabbit.",
      "rabbit",
    ],
    [
      "우산 아래 두 친구가 서요. 발끝이 나란히 모여요.",
      "A little space for you.",
      "umbrella",
    ],
    [
      "나뭇잎에도 비가 톡톡. 잎이 살랑 흔들려요.",
      "Drip, drop, little leaves.",
      "leaves",
    ],
    [
      "{name}가 작은 꽃을 보아요. 빗방울이 꽃에 안겨요.",
      "Hello, happy little flower.",
      "flowers",
    ],
    [
      "작은 새가 노래해요. 비가 그쳤다고 알려 줘요.",
      "Hello, little bird.",
      "bird",
    ],
    [
      "{name}가 무지개를 가리켜요. 빨강, 노랑, 파랑!",
      "A rainbow in the sky.",
      "rainbow",
    ],
    [
      "장화가 현관에서 쉬어요. {name}는 보송한 옷을 입어요.",
      "Rest here, little boots.",
      "boots",
    ],
  ],
  sea: [
    [
      "{name}의 발 아래 모래가 폭신해요. 발자국이 콕콕 남아요.",
      "Little feet in the sand.",
      "footprints",
    ],
    ["파도가 멀어져요. 다시 올게, 찰랑찰랑.", "Bye-bye, little wave.", "wave"],
    [
      "조개에 작은 줄이 있어요. {name}가 눈으로 따라가요.",
      "Look at the little shell.",
      "shell",
    ],
    [
      "게의 작은 다리가 바빠요. 옆으로, 옆으로, 사뿐!",
      "Little legs go side to side.",
      "crab",
    ],
    [
      "{name}는 엄마 곁에 서요. 게를 조용히 지켜봐요.",
      "We wait together.",
      "crab",
    ],
    [
      "모래 위 길이 다시 열려요. 작은 게가 움직여요.",
      "A little path is clear.",
      "path",
    ],
    [
      "{name}가 게에게 인사해요. 바다에서 또 만나!",
      "Bye-bye, little crab.",
      "crab",
    ],
    [
      "작은 탑이 하나 생겨요. {name}가 모래를 토닥토닥.",
      "One little tower for us.",
      "castle",
    ],
    [
      "물길이 반짝이며 흘러요. 작은 강처럼 구불구불.",
      "A little stream goes by.",
      "wave",
    ],
    [
      "조개는 모래 위에서 쉬어요. {name}는 예쁜 모습을 기억해요.",
      "Stay here, little shell.",
      "shell",
    ],
    [
      "파도 소리가 등을 토닥여요. 엄마와 천천히 걸어요.",
      "Bye-bye, little sea.",
      "sunset",
    ],
  ],
  custom: [
    [
      "{name}는 작은 가방을 메어요. 오늘의 모험을 담을 거예요.",
      "A little bag for me.",
      "bag",
    ],
    [
      "바람이 잎사귀를 흔들어요. {name}도 손을 흔들어요.",
      "Hello, little breeze.",
      "leaves",
    ],
    [
      "{name}가 꽃을 하나 찾아요. 향기가 살랑 다가와요.",
      "I see a little flower.",
      "flowers",
    ],
    [
      "친구가 {name} 옆에 앉아요. 같이 이야기를 들어요.",
      "A little space for you.",
      "rabbit",
    ],
    [
      "가방에는 작은 수건이 있어요. 공은 어디 있을까요?",
      "Where can the little ball be?",
      "bag",
    ],
    [
      "{name}가 풀잎을 살짝 젖혀요. 반짝이는 빨강이 보여요.",
      "I see a little red ball.",
      "ball",
    ],
    [
      "친구가 두 손을 벌려요. {name}가 공을 데굴 굴려요.",
      "Here it comes, little friend.",
      "ball",
    ],
    [
      "친구가 “고마워!” 말해요. {name}도 활짝 웃어요.",
      "Thank you, little friend.",
      "rabbit",
    ],
    [
      "공이 천천히 돌아와요. 두 친구가 번갈아 놀아요.",
      "Your turn, my turn.",
      "ball",
    ],
    [
      "그림에 햇살을 더해요. {name}의 하루처럼 반짝여요.",
      "A little sun in our picture.",
      "picture",
    ],
    [
      "엄마가 {name}를 꼭 안아요. 오늘 이야기를 들려 드려요.",
      "A little hug for Mom.",
      "home",
    ],
  ],
};

function particle(name, pair) {
  const last = name.charCodeAt(name.length - 1);
  const consonant =
    last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  const pairs = {
    은: ["은", "는"],
    는: ["은", "는"],
    이: ["이", "가"],
    가: ["이", "가"],
    을: ["을", "를"],
    를: ["을", "를"],
    와: ["과", "와"],
    과: ["과", "와"],
  };
  return name + (pairs[pair]?.[consonant ? 0 : 1] || pair);
}

function expandText(text, context) {
  return text
    .replace(/\{(name|friend|topic)\}([은는이가을를와과])/g, (_, key, p) =>
      particle(context[key], p),
    )
    .replace(/\{(name|friend|topic)\}/g, (_, key) => context[key]);
}

function storyContext(options, characters = []) {
  const selected = (options.characterIds || ["yuha"])
    .map((id) => characters.find((c) => c.id === id))
    .filter(Boolean);
  const primary =
    selected[0] ||
    characters.find((c) => c.id === "yuha") ||
    DEFAULT_CHARACTERS[0];
  const theme = detectTheme(options.topic);
  const species = theme === "dinosaur" ? "dinosaur" : "rabbit";
  const companion =
    selected.find((c) => c.kind === species && c.id !== primary.id) ||
    selected.find((c) => c.id !== primary.id);
  return {
    theme,
    primary,
    selected,
    name: clean(primary.name, 24) || "유하",
    nameEn: clean(primary.nameEn, 30) || "Yuha",
    friend:
      companion?.name ||
      (theme === "dinosaur" ? "아기 공룡" : themes[theme].friend),
    friendEn: companion?.nameEn || themes[theme].friendEn,
    topic: clean(options.topic, 65),
  };
}

export function makeOutline(options = {}, characters = DEFAULT_CHARACTERS) {
  const context = storyContext(options, characters);
  const desired = [8, 12, 16, 24].includes(Number(options.pageCount))
    ? Number(options.pageCount)
    : 12;
  const source = STORIES[context.theme];
  let rows;
  if (desired === 8)
    rows = [0, 1, 3, 4, 6, 8, 10, 11].map((i) => ({
      row: source[i],
      sourceIndex: i,
    }));
  else {
    rows = [];
    let inserted = 0;
    const extra = desired - 12;
    source.forEach((row, i) => {
      rows.push({ row, sourceIndex: i });
      if (i < 11) {
        const target = Math.floor(((i + 1) * extra) / 11);
        while (inserted < target) {
          const bridge =
            inserted >= 11
              ? [
                  "하늘빛이 조금씩 바뀌어요. {name}는 오늘의 친구를 떠올려요.",
                  "Thank you for this little day.",
                  "sunset",
                ]
              : BRIDGES[context.theme][i];
          rows.push({
            row: [bridge[0], bridge[1], row[2], bridge[2]],
            sourceIndex: i,
          });
          inserted++;
        }
      }
    });
  }
  const pages = rows.map(({ row, sourceIndex }, i) => ({
    ko: expandText(row[0], context),
    en: row[1],
    scene: {
      theme: context.theme,
      beat: row[2],
      index: i,
      sourceIndex,
      setting: options.backgroundIds?.[0] || context.theme,
      object: row[3],
    },
    artVariant: 0,
  }));
  const supporting = context.selected.filter(
    (character) => character.id !== context.primary.id,
  );
  if (supporting.length) {
    pages[0].ko += ` 친구 ${supporting.map((character) => clean(character.name, 24)).join(", ")}도 함께 떠나요.`;
    pages[0].en += ` ${supporting.map((character) => clean(character.nameEn || character.name, 30)).join(" and ")} ${supporting.length === 1 ? "comes" : "come"} along.`;
  }
  const level = options.englishLevel || "repeat";
  if (/short|짧/.test(level))
    pages.forEach((page, i) => {
      if (i < pages.length - 1)
        page.en +=
          " " +
          (i % 3 === 0
            ? "Come with me."
            : i % 3 === 1
              ? "Look over here."
              : "We are together.");
    });
  if (/chapter|챕터/.test(level))
    pages.forEach((page, i) => {
      page.en += ` ${context.nameEn} ${i % 2 === 0 ? "looks around with a happy smile." : "takes a small step with a friend."} There is so much to see today.`;
    });
  if (options.value && !/none|없음/.test(options.value)) {
    const index = Math.min(pages.length - 3, Math.floor(pages.length * 0.6));
    if (/나눔|sharing|share/.test(options.value)) {
      pages[index].ko = expandText(
        "{name}가 작은 선물을 나눠요. 친구의 웃음도 함께 커져요.",
        context,
      );
      pages[index].en = "A little gift for you.";
      pages[index].scene.beat = "share";
    }
    if (/용기|courage/.test(options.value)) {
      pages[index].ko = expandText(
        "{name}가 작은 걸음을 내디뎌요. 친구 손을 잡으니 든든해요.",
        context,
      );
      pages[index].en = "One little step for me.";
      pages[index].scene.beat = "walk";
    }
    if (/친절|kindness/.test(options.value)) {
      pages[index].ko = expandText(
        "{name}가 친구의 마음을 살펴요. “괜찮아, 함께할게!”",
        context,
      );
      pages[index].en = "I am here for you.";
      pages[index].scene.beat = "share";
    }
    if (/양치|teeth|brushing/.test(options.value)) {
      pages[pages.length - 2].ko = expandText(
        "집에 온 {name}가 이를 닦아요. 치카치카, 앞니도 어금니도!",
        context,
      );
      pages[pages.length - 2].en = "Brush, brush, little teeth.";
      pages[pages.length - 2].scene.beat = "brush";
      pages[pages.length - 2].scene.object = "toothbrush";
    }
  }
  if (/open|열린|다음/.test(options.ending || "")) {
    pages[pages.length - 1] = {
      ...pages[pages.length - 1],
      ko: expandText(
        "“내일은 어디로 갈까?” {name}가 웃어요. 새로운 모험이 기다려요.",
        context,
      ),
      en: "Where shall we go tomorrow?",
      scene: {
        ...pages[pages.length - 1].scene,
        beat: "tomorrow",
        object: "stars",
      },
    };
  }
  return pages;
}

export function generateBook(
  options = {},
  outline,
  characters = DEFAULT_CHARACTERS,
  existingBooks = [],
) {
  const validation = safeTopic(options.topic);
  if (!validation.ok) throw new Error(validation.message);
  const context = storyContext(options, characters);
  const previous = existingBooks.find((b) => b.id === options.previousBookId);
  const series = clean(
    options.series || previous?.series || themes[context.theme].series,
    80,
  );
  const episode =
    1 +
    existingBooks
      .filter((b) => b.series === series)
      .reduce((n, b) => Math.max(n, Number(b.episode) || 1), 0);
  const pages = (
    Array.isArray(outline) && outline.length
      ? outline
      : makeOutline(options, characters)
  ).map((p, i) => ({
    ko: clean(p.ko, 900),
    en: clean(p.en, 1200),
    scene: { theme: context.theme, beat: "walk", index: i, ...(p.scene || {}) },
    artVariant: Number(p.artVariant) || 0,
  }));
  if (previous && pages.length && !Array.isArray(outline)) {
    pages[0].ko = expandText(
      "지난 모험을 마친 {name}에게 새 아침이 왔어요. 오늘도 함께 출발해요.",
      context,
    );
    pages[0].en = "Here we go again, little friend.";
  }
  let title = themes[context.theme].title.replace("유하", context.name);
  let titleEn = themes[context.theme].titleEn.replace("Yuha", context.nameEn);
  if (context.theme === "custom") {
    title = `${context.name}의 ${clean(options.topic, 24)} 이야기`;
    titleEn = `${context.nameEn}’s Little Adventure`;
  }
  return {
    id: uid(),
    title,
    titleEn,
    series,
    episode,
    characterIds: context.selected.length
      ? context.selected.map((c) => c.id)
      : ["yuha"],
    backgroundIds: options.backgroundIds || previous?.backgroundIds || [],
    theme: context.theme,
    topic: clean(options.topic, 160),
    language: ["dual", "ko", "en", "bilingual"].includes(options.language)
      ? options.language
      : "dual",
    pageCount: pages.length,
    englishLevel: options.englishLevel || "repeat",
    value: options.value || "none",
    ending: options.ending || "home",
    pages,
    createdAt: new Date().toISOString(),
    printedAt: null,
    reads: 0,
    favorite: false,
    approved: false,
    localSample: true,
    previousBookId: previous?.id || null,
    summary: `${context.name}와 친구가 ${themes[context.theme].label}의 작은 모험을 함께했어요. 서로 돕고 따뜻한 마음으로 하루를 마쳤어요.`,
    worldMemo: clean(
      options.worldMemo ||
        previous?.worldMemo ||
        "친구들은 서로 도와요. 무서운 장면 없이 작은 모험을 하고, 하루 끝에 따뜻하게 쉬어요.",
      500,
    ),
  };
}

export function regenerateText(book, pageIndex) {
  const page = book.pages[pageIndex];
  if (!page) return null;
  const revision = (Number(page.textVariant) || 0) + 1;
  const baseEn = page.baseEn || page.en;
  const baseKo = page.baseKo || page.ko;
  const endings = [
    "사뿐사뿐, 함께해요.",
    "친구와 함께 웃어요.",
    "마음이 포근해져요.",
  ];
  const ko =
    baseKo.split(/(?<=[.!?])\s+/)[0] +
    " " +
    endings[(revision - 1) % endings.length];
  let en = baseEn;
  if (revision % 2 === 1) {
    if (/^I see a /i.test(baseEn))
      en = baseEn.replace(/^I see a /i, "Look, a ");
    else if (/^Here is /i.test(baseEn))
      en = baseEn.replace(/^Here is /i, "Look at ");
    else if (/^Where is /i.test(baseEn))
      en = baseEn.replace(/^Where is /i, "Can you see ");
    else if (/^We /i.test(baseEn))
      en = baseEn.replace(/^We /i, "Together, we ");
    else if (/^Let’s go /i.test(baseEn))
      en = baseEn.replace(/^Let’s go /i, "Off we go ");
    else if (/^Good night,/i.test(baseEn))
      en = baseEn.replace(/^Good night,/i, "Sleep well,");
    else if (/^Hello,/i.test(baseEn))
      en = baseEn.replace(/^Hello,/i, "Hello there,");
    else en = baseEn.replace(/[.!?]$/, revision % 3 === 1 ? "!" : ".");
  }
  return { ...page, ko, en, textVariant: revision, baseEn, baseKo };
}

const DEFAULT_CHARACTERS = [
  {
    id: "yuha",
    name: "유하",
    nameEn: "Yuha",
    role: "주인공",
    kind: "child",
    age: 4,
    gender: "남자아이",
    color: "#e9bb4e",
    hairColor: "#393735",
    skinColor: "#f0cfb5",
    description: "짧은 검은 머리, 동그란 얼굴, 노란 티셔츠와 초록 반바지",
    appearance: "짧은 검은 머리 · 동그란 얼굴",
    clothes: "노란 티셔츠 · 초록 반바지",
    traits: ["호기심 많음", "씩씩함", "다정함"],
    likes: "공룡, 별, 딸기",
    catchphrase: "같이 가자!",
    wardrobe: [
      { id: "default", name: "기본 모습", color: "#e9bb4e" },
      { id: "raincoat", name: "노란 우비", color: "#e9bb4e" },
      { id: "spacesuit", name: "우주복", color: "#ece9df" },
    ],
  },
  {
    id: "greenie",
    name: "초록이",
    nameEn: "Greenie",
    role: "상상 친구",
    kind: "dinosaur",
    color: "#8da984",
    hairColor: "#8da984",
    skinColor: "#8da984",
    description: "작고 순한 초록 공룡, 둥근 코와 말랑한 꼬리",
    appearance: "초록빛 몸 · 둥근 코",
    clothes: "기본 모습",
    traits: ["순함", "다정함", "잎을 좋아함"],
    likes: "초록 잎, 산책",
    catchphrase: "쿵쿵, 같이 가!",
    wardrobe: [{ id: "default", name: "기본 모습", color: "#8da984" }],
  },
  {
    id: "toto",
    name: "토토",
    nameEn: "Toto",
    role: "동물 친구",
    kind: "rabbit",
    color: "#e8e0cc",
    hairColor: "#e8e0cc",
    skinColor: "#e8e0cc",
    description: "크림색 토끼, 분홍 귀와 초록 스카프",
    appearance: "크림색 털 · 분홍 귀",
    clothes: "초록 스카프",
    traits: ["상냥함", "꼼꼼함", "수줍음"],
    likes: "당근, 달",
    catchphrase: "사뿐사뿐!",
    wardrobe: [
      { id: "default", name: "기본 모습", color: "#e8e0cc" },
      { id: "scarf", name: "포근한 목도리", color: "#8da984" },
    ],
  },
  {
    id: "mom",
    name: "엄마",
    nameEn: "Mom",
    role: "가족",
    kind: "adult",
    color: "#b88372",
    hairColor: "#493b34",
    skinColor: "#edceb3",
    description: "다정한 눈, 갈색 단발머리, 살구색 원피스",
    appearance: "갈색 단발머리 · 다정한 눈",
    clothes: "살구색 원피스",
    traits: ["다정함", "차분함", "잘 들어줌"],
    likes: "산책, 따뜻한 포옹",
    catchphrase: "천천히, 함께 가자.",
    wardrobe: [{ id: "default", name: "기본 모습", color: "#b88372" }],
  },
];

export function seedState() {
  const characters = JSON.parse(JSON.stringify(DEFAULT_CHARACTERS));
  const backgroundData = [
    {
      id: "home",
      name: "유하네 집",
      kind: "집",
      theme: "custom",
      description: "큰 창문, 노란 대문, 포근한 이불",
      mood: "아늑함",
      color: "#d8b995",
    },
    {
      id: "forest",
      name: "초록빛 숲",
      kind: "숲·바다",
      theme: "dinosaur",
      description: "둥근 나무, 작은 꽃, 햇살 드는 숲길",
      mood: "모험",
      color: "#9ab783",
    },
    {
      id: "moon",
      name: "반짝이는 달",
      kind: "우주·상상 세계",
      theme: "moon",
      description: "말랑한 달 언덕과 반짝이는 작은 별",
      mood: "밤",
      color: "#a8adca",
    },
    {
      id: "garden",
      name: "빗방울 정원",
      kind: "동네·놀이터",
      theme: "rain",
      description: "물웅덩이와 꽃밭, 무지개가 뜨는 산책길",
      mood: "포근함",
      color: "#a9c0c1",
    },
    {
      id: "beach",
      name: "조개빛 바닷가",
      kind: "숲·바다",
      theme: "sea",
      description: "잔잔한 물결, 폭신한 모래, 작은 조개",
      mood: "평온함",
      color: "#90bec4",
    },
  ];
  const samples = [
    {
      topic: "공룡 친구와 나누는 하루",
      characterIds: ["yuha", "greenie"],
      backgroundIds: ["forest"],
      favorite: true,
      reads: 8,
      printedAt: "2026-10-12T09:00:00Z",
    },
    {
      topic: "달나라로 떠나는 여행",
      characterIds: ["yuha", "toto"],
      backgroundIds: ["moon"],
      favorite: true,
      reads: 5,
      printedAt: "2026-10-10T09:00:00Z",
    },
    {
      topic: "비 오는 날의 작은 모험",
      characterIds: ["yuha", "toto", "mom"],
      backgroundIds: ["garden"],
      reads: 3,
    },
    {
      topic: "바다에서 발견한 선물",
      characterIds: ["yuha", "mom"],
      backgroundIds: ["beach"],
      reads: 2,
    },
  ];
  const books = samples.map((options, i) => ({
    ...generateBook(
      { ...options, pageCount: 12, language: "dual" },
      null,
      characters,
      [],
    ),
    id: `seed-${["dinosaur", "moon", "rain", "sea"][i]}`,
    approved: true,
    createdAt: `2026-10-${String(13 - i).padStart(2, "0")}T09:00:00Z`,
    ...options,
  }));
  return {
    version: 1,
    books,
    characters,
    backgrounds: backgroundData,
    settings: {
      pin: null,
      language: "dual",
      defaultLanguage: "dual",
      pageCount: 12,
      englishLevel: "repeat",
      printLayout: "booklet",
      dailyLimit: 3,
      speechRate: 0.85,
      style: "watercolor",
      worldName: "우리 집 작은 세계",
      worldMemo: "친구들은 서로 도와요. 작은 모험 뒤에는 집으로 돌아와요.",
    },
    readingLog: [],
  };
}

// Reusable original drawing components. All palettes are validated before interpolation.
function person(
  c = DEFAULT_CHARACTERS[0],
  x = 370,
  y = 345,
  scale = 1,
  pose = "stand",
) {
  const shirt = color(c.color, "#e9bb4e"),
    hair = color(c.hairColor, "#393735"),
    skin = color(c.skinColor, "#f0cfb5");
  const adult = c.kind === "adult";
  const sleepy = pose === "sleep";
  return `<g transform="translate(${x} ${y}) scale(${scale})" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="0" cy="126" rx="53" ry="10" fill="#726759" opacity=".12"/>
    ${adult ? `<path d="M-29 15 Q-49 46-48 91 Q0 105 48 91 Q45 40 28 15Z" fill="${shirt}"/><path d="M-16 93V121M17 93V121" stroke="${skin}" stroke-width="16"/>` : `<path d="M-36 15 Q-45 38-37 68 Q0 76 37 68 Q45 37 34 15Z" fill="${shirt}"/><path d="M-35 69L-29 94L-7 94L0 75L8 94L31 94L36 69Z" fill="#789480"/><path d="M-20 96V115M20 96V115" stroke="${skin}" stroke-width="17"/>`}
    <path d="M-21 119L-38 121Q-43 130-33 131L-11 131Q-5 124-11 119Z M20 119L10 121Q4 130 14 131L36 131Q44 125 35 120Z" fill="#806b59"/>
    <path d="M-34 27Q-47 41-53 65" stroke="${skin}" stroke-width="17" fill="none"/>
    <path d="M34 27Q51 ${pose === "wave" ? "1" : "41"} 57 ${pose === "wave" ? "-17" : "63"}" stroke="${skin}" stroke-width="17" fill="none"/>
    <circle cx="-53" cy="65" r="10" fill="${skin}"/><circle cx="57" cy="${pose === "wave" ? "-17" : "63"}" r="10" fill="${skin}"/>
    <path d="M-13 8V20Q0 30 13 20V8" fill="${skin}"/>
    ${adult ? `<path d="M-47-49Q-49-87 0-91Q54-85 49-45L53 3Q29 20 0 14Q-36 18-54 2Z" fill="${hair}"/>` : ""}
    <ellipse cx="0" cy="-39" rx="43" ry="48" fill="${skin}"/>
    <ellipse cx="-43" cy="-30" rx="8" ry="13" fill="${skin}"/><ellipse cx="43" cy="-30" rx="8" ry="13" fill="${skin}"/>
    <path d="M-44-45Q-58-83-19-92Q16-108 43-77Q50-62 43-44L30-61Q8-52-8-64L-14-52L-29-63Z" fill="${hair}"/>
    <path d="M-28-76Q-16-86-4-86" stroke="#ffffff" stroke-width="5" opacity=".09" fill="none"/>
    ${sleepy ? '<path d="M-21-33Q-15-28-9-33M10-33Q16-28 22-33" fill="none" stroke="#504538" stroke-width="3"/>' : '<ellipse cx="-15" cy="-34" rx="3.4" ry="4.4" fill="#433d35"/><ellipse cx="16" cy="-34" rx="3.4" ry="4.4" fill="#433d35"/>'}
    <ellipse cx="-26" cy="-19" rx="9" ry="5.7" fill="#d99884" opacity=".45"/><ellipse cx="27" cy="-19" rx="9" ry="5.7" fill="#d99884" opacity=".45"/>
    <path d="M-7-12Q0-4 9-12" stroke="#976c5b" stroke-width="2.6" fill="none"/>
  </g>`;
}

function dinosaur(c = {}, x = 525, y = 380, scale = 1, pose = "stand") {
  const green = color(c.color, "#91aa86");
  return `<g transform="translate(${x} ${y}) scale(${scale})" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="14" cy="97" rx="90" ry="11" fill="#486649" opacity=".12"/>
    <path d="M39 34Q80 58 104 38Q123 24 132 42Q120 86 52 71Z" fill="${green}"/>
    <path d="M77 50L82 26L96 45M107 44L112 19L126 39" fill="#6c936c"/>
    <path d="M-27-5Q12-30 53 14Q77 48 52 77Q8 97-33 73Q-58 40-27-5Z" fill="${green}"/>
    <ellipse cx="5" cy="42" rx="28" ry="32" fill="#cad5a9"/>
    <path d="M-28 63L-39 85Q-49 97-34 98L-5 97Q4 90-7 82L-7 62M29 69L27 89Q22 99 37 99L60 98Q68 93 55 84L51 63" fill="${green}"/>
    <path d="M-31-6Q-69-6-77-39Q-85-78-49-91Q-13-102 12-73Q31-52 5-21L-8 0Z" fill="${green}"/>
    <ellipse cx="-59" cy="-42" rx="35" ry="26" fill="${green}"/>
    <circle cx="-59" cy="-66" r="4.3" fill="#344634"/><circle cx="-80" cy="-40" r="2.3" fill="#557a50"/>
    <ellipse cx="-66" cy="-30" rx="10" ry="5.5" fill="#b98777" opacity=".48"/>
    <path d="M-78-24Q-64-14-51-23" stroke="#54704e" stroke-width="3" fill="none"/>
    <path d="M-6 7Q-27 17-37 31" fill="none" stroke="${green}" stroke-width="16"/>
    <path d="M17-48L31-51L19-65M34-1L48-11L34-23" fill="#6c936c"/>
    <path d="M-23 87V95M-16 89V96M42 89V96M48 89V96" stroke="#70906b" stroke-width="2"/>
  </g>`;
}

function rabbit(c = {}, x = 545, y = 390, scale = 1) {
  const fur = color(c.color, "#e8e0cc");
  return `<g transform="translate(${x} ${y}) scale(${scale})" stroke-linecap="round">
    <ellipse cx="0" cy="90" rx="52" ry="8" fill="#746d61" opacity=".14"/>
    <ellipse cx="-17" cy="-68" rx="13" ry="51" fill="${fur}" transform="rotate(-12 -17 -68)"/>
    <ellipse cx="17" cy="-68" rx="13" ry="51" fill="${fur}" transform="rotate(12 17 -68)"/>
    <ellipse cx="-17" cy="-72" rx="6" ry="33" fill="#d8aaa3" transform="rotate(-12 -17 -72)"/>
    <ellipse cx="17" cy="-72" rx="6" ry="33" fill="#d8aaa3" transform="rotate(12 17 -72)"/>
    <ellipse cx="0" cy="51" rx="34" ry="39" fill="${fur}"/><ellipse cx="0" cy="51" rx="22" ry="28" fill="#f3eedf"/>
    <circle cx="36" cy="64" r="13" fill="${fur}"/>
    <ellipse cx="-21" cy="83" rx="24" ry="10" fill="${fur}"/><ellipse cx="20" cy="83" rx="24" ry="10" fill="${fur}"/>
    <circle cx="0" cy="-8" r="37" fill="${fur}"/>
    <circle cx="-12" cy="-12" r="3.2" fill="#4f493d"/><circle cx="12" cy="-12" r="3.2" fill="#4f493d"/>
    <path d="M-4-2L4-2L0 3Z" fill="#b48980"/>
    <path d="M0 3Q-1 11-7 8M0 3Q1 11 7 8" stroke="#8c7863" stroke-width="1.8" fill="none"/>
    <ellipse cx="-23" cy="1" rx="7" ry="4" fill="#d5a6a0" opacity=".5"/><ellipse cx="23" cy="1" rx="7" ry="4" fill="#d5a6a0" opacity=".5"/>
    <path d="M-29 22Q0 39 29 22L26 34Q0 47-26 34Z M13 34L33 61L15 65L1 38Z" fill="#829b7c"/>
    <path d="M-28 40L-43 52M27 41L43 52" stroke="${fur}" stroke-width="13"/>
  </g>`;
}

function protagonist(character, x, y, scale, pose) {
  if (character?.kind === "dinosaur")
    return dinosaur(character, x, y, scale, pose);
  if (character?.kind === "rabbit") return rabbit(character, x, y, scale);
  return person(character, x, y, scale, pose);
}
function tree(x, y, s = 1, variant = 0) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-13 5Q-7-57-12-135L11-135Q9-48 21 5Z" fill="#aa967a"/><path d="M0-85L-45-131M2-65L47-124" stroke="#aa967a" stroke-width="10" fill="none"/><path d="M-58-109Q-105-120-87-164Q-96-201-43-214Q-24-249 20-230Q73-239 88-196Q124-174 94-137Q98-100 49-94Q16-70-21-92Q-41-85-58-109Z" fill="${variant ? "#b0bf8d" : "#9eb38b"}"/><path d="M-72-175Q-65-202-30-204M22-212Q63-218 77-179" stroke="#d1d9ae" stroke-width="12" opacity=".5" fill="none"/><circle cx="-42" cy="-132" r="23" fill="#b2c398" opacity=".5"/><circle cx="44" cy="-146" r="30" fill="#7f9b76" opacity=".25"/></g>`;
}
function cloud(x, y, s = 1, fill = "#fffdf3") {
  return `<path transform="translate(${x} ${y}) scale(${s})" d="M-60 18Q-84-6-50-22Q-45-57-10-44Q15-74 41-37Q75-40 78-7Q103 15 68 27L-43 28Z" fill="${fill}" opacity=".75"/>`;
}
function flower(x, y, s = 1, tint = "#e5c06f") {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0V36M0 25Q-22 9-19 25Q-14 36 0 30" stroke="#8a9d73" stroke-width="3" fill="none"/><g fill="${tint}"><ellipse cx="0" cy="-8" rx="7" ry="11"/><ellipse cx="0" cy="8" rx="7" ry="11"/><ellipse cx="-9" cy="0" rx="11" ry="7"/><ellipse cx="9" cy="0" rx="11" ry="7"/></g><circle r="5" fill="#b99555"/></g>`;
}
function grass(seed = 1, palette = "#8fa67b") {
  let out = "";
  for (let i = 0; i < 24; i++) {
    const x = 35 + (hash(seed + "-" + i) % 730),
      y = 430 + (hash("y" + seed + i) % 115),
      s = 0.5 + (i % 4) * 0.2;
    out += `<path d="M${x} ${y}q-10-22-14-20M${x} ${y}q0-31 5-35M${x} ${y}q13-19 18-18" stroke="${palette}" stroke-width="${2 * s}" opacity=".5" fill="none"/>`;
  }
  return out;
}
function butterfly(x, y, s = 0.8) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0Q-40-40-40-4Q-31 24 0 8Q31 24 40-4Q40-40 0 0" fill="#d8aa83"/><path d="M0-5V16M0-4L-6-14M0-4L6-14" stroke="#897254" stroke-width="3"/></g>`;
}
function shell(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 15Q-43-4-30-22Q-20-32-9-27Q0-44 12-27Q30-35 35-16Q45 5 0 15Z" fill="#e3b8a0"/><path d="M0 14L-20-22M0 14L-6-26M0 14L10-26M0 14L27-18" stroke="#c89780" stroke-width="2" fill="none"/></g>`;
}
function crab(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" stroke-linecap="round"><path d="M-17 2L-35-9M-19 10L-37 13M-15 17L-29 27M17 2L35-9M19 10L37 13M15 17L29 27" stroke="#c88873" stroke-width="4"/><ellipse cx="0" cy="7" rx="23" ry="16" fill="#dba08b"/><path d="M-16-1L-22-24M16-1L22-24" stroke="#dba08b" stroke-width="7"/><path d="M-22-23L-33-35Q-44-26-31-19L-22-23L-12-32M22-23L33-35Q44-26 31-19L22-23L12-32" stroke="#dba08b" stroke-width="6" fill="none"/><circle cx="-8" cy="-8" r="4" fill="#e9b4a0"/><circle cx="8" cy="-8" r="4" fill="#e9b4a0"/><circle cx="-8" cy="-9" r="2" fill="#4f443b"/><circle cx="8" cy="-9" r="2" fill="#4f443b"/><path d="M-4 6Q0 11 5 6" stroke="#9b6a5a" stroke-width="1.8" fill="none"/></g>`;
}
function stars(seed = 1) {
  let out = "";
  for (let i = 0; i < 30; i++) {
    const x = 30 + (hash(seed + "sx" + i) % 740),
      y = 30 + (hash(seed + "sy" + i) % 330),
      r = 1 + (i % 3);
    out +=
      i % 5 === 0
        ? `<path d="M${x} ${y - 7}q2 6 7 7q-6 2-7 7q-2-6-7-7q6-2 7-7" fill="#ead9a5" opacity=".85"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}" fill="#efdfb6" opacity="${0.4 + (i % 3) * 0.2}"/>`;
  }
  return out;
}

function interior(character, scene, variation) {
  const sleepy = scene.beat === "sleep";
  const backdrop = `<rect width="800" height="580" fill="#ede2ce"/><path d="M0 400H800V580H0Z" fill="#d5c3a5"/><path d="M0 403H800" stroke="#c3b28f" stroke-width="3"/><rect x="524" y="65" width="174" height="205" rx="65" fill="#bba88f"/><rect x="537" y="78" width="148" height="179" rx="54" fill="${sleepy ? "#8e98ae" : "#c5d6d0"}"/><path d="M610 83V254M542 166H680" stroke="#e7dcc4" stroke-width="9"/><path d="M517 76Q480 171 515 280L541 273V79M704 76Q739 171 706 280L679 273V79" fill="#cdaa91"/><circle cx="638" cy="119" r="24" fill="#f0dfaf"/><path d="M138 96Q188 81 238 96L232 184H143Z" fill="#a9b592"/><path d="M153 180H220" stroke="#8fa078" stroke-width="3"/>`;
  if (sleepy)
    return (
      backdrop +
      `<path d="M161 423V524M654 423V524" stroke="#a08668" stroke-width="18"/><path d="M139 386Q152 315 217 332L605 345Q671 343 674 421L669 488L139 488Z" fill="#b3987b"/><rect x="146" y="356" width="509" height="96" rx="30" fill="#f1e7d2"/><ellipse cx="240" cy="366" rx="80" ry="35" fill="#fbf4e5"/>` +
      protagonist(character, 270, 373, 0.84, "sleep") +
      `<path d="M164 402Q339 377 461 386Q586 378 666 416L666 491L147 491Z" fill="#9cac9b"/><path d="M181 423Q349 402 626 430" stroke="#b9c4ad" stroke-width="10" opacity=".7" fill="none"/><path d="M180 472H636" stroke="#839986" stroke-width="3" stroke-dasharray="4 10" opacity=".5"/>` +
      rabbit({}, 563, 434, 0.4)
    );
  return (
    backdrop +
    `<ellipse cx="399" cy="480" rx="242" ry="56" fill="#c4b38e" opacity=".5"/>` +
    protagonist(character, 333, 353, 1, "wave") +
    person(DEFAULT_CHARACTERS[3], 522, 307, 1.13, "stand") +
    `<rect x="99" y="338" width="118" height="91" rx="6" fill="#bea283"/><path d="M95 334H220" stroke="#967d61" stroke-width="12"/><path d="M123 429V464M196 429V464" stroke="#967d61" stroke-width="11"/><path d="M139 332L148 280L174 280L184 332Z" fill="#91a387"/>`
  );
}

function forest(character, scene, variation) {
  const sunset = ["goodbye", "homeward"].includes(scene.beat),
    paper = sunset ? "#eedfc2" : "#e8edde";
  const shift = (variation % 3) * 26;
  let art = `<rect width="800" height="580" fill="${paper}"/><ellipse cx="588" cy="127" rx="59" ry="61" fill="${sunset ? "#e4b17b" : "#eee1ae"}" opacity=".7"/>${cloud(286, 103, 0.8)}<path d="M0 317Q162 205 326 324Q463 224 800 295V580H0Z" fill="#c5d1ab"/><path d="M0 415Q196 350 351 413Q552 335 800 407V580H0Z" fill="#b4c397"/><path d="M398 364Q362 427 367 460Q353 509 252 580H521Q421 491 449 445L472 373Z" fill="#d8cba6" opacity=".8"/>${tree(79, 392, 1.22)}${tree(690, 383, 1.14, 1)}${tree(203, 330, 0.56, 1)}${tree(615, 311, 0.6)}`;
  art += grass(variation + 3);
  const companion =
    (scene.cast || []).find(
      (c) => c.kind === "dinosaur" && c.id !== character.id,
    ) || DEFAULT_CHARACTERS[1];
  if (scene.beat !== "depart")
    art += dinosaur(companion, 533 + shift, 378, 1.15);
  art += protagonist(
    character,
    341 - shift,
    374,
    0.96,
    scene.beat === "hello" || scene.beat === "goodbye" || variation % 2 === 1
      ? "wave"
      : "stand",
  );
  art +=
    flower(139, 475, 0.6) +
    flower(175, 485, 0.42, "#d2a28e") +
    flower(624, 463, 0.5) +
    flower(670, 506, 0.6, "#d2a28e") +
    flower(557, 514, 0.45);
  if (["leaf", "leaves", "high-leaves"].includes(scene.object))
    art += `<path d="M417 362Q419 331 446 321Q459 355 417 362Z" fill="#8b9d6d"/><path d="M417 362L440 330" stroke="#658257" stroke-width="2"/>`;
  if (scene.object === "high-leaves")
    art += `<path d="M530 239Q600 211 638 211" stroke="#aa967a" stroke-width="8" fill="none"/><path d="M525 246Q520 218 544 210Q558 240 525 246M556 234Q554 208 577 201Q590 229 556 234" fill="#88a077"/>`;
  if (scene.object === "stone" || scene.beat === "gift")
    art += `<ellipse cx="416" cy="370" rx="18" ry="13" fill="#b9b3a4"/><path d="M405 367Q415 358 425 365" stroke="#d9d4c7" stroke-width="4" fill="none"/>`;
  if (["flowers", "butterfly"].includes(scene.object))
    art += butterfly(472, 273, 0.52);
  return art;
}

function moonScene(character, scene, variation) {
  const early = ["depart", "discover"].includes(scene.beat);
  if (early && scene.object === "window")
    return (
      interior(character, scene, variation) +
      `<path d="M660 112A28 28 0 1 1 631 83A22 22 0 0 0 660 112" fill="#efdfb6"/>`
    );
  let art = `<rect width="800" height="580" fill="#969bb5"/><path d="M0 0Q280 95 489 12L800 0V332Q539 277 314 312Q111 270 0 308Z" fill="#8f94af" opacity=".5"/>${stars(variation + 1)}<circle cx="637" cy="135" r="70" fill="#abc4c3"/><path d="M590 110Q614 87 636 105L649 96Q676 122 662 139L682 158Q667 180 641 181L629 154L604 144Z" fill="#c6d3b3" opacity=".9"/><path d="M0 410Q166 295 343 373Q568 299 800 405V580H0Z" fill="#dfdacb"/><path d="M0 503Q188 461 346 496Q515 429 800 507V580H0Z" fill="#d3ccbb"/><ellipse cx="615" cy="456" rx="64" ry="18" fill="#bcb7a9"/><ellipse cx="620" cy="453" rx="47" ry="11" fill="#cbc5b5"/><ellipse cx="162" cy="486" rx="42" ry="12" fill="#c1baaa"/><ellipse cx="95" cy="411" rx="23" ry="7" fill="#c1baaa"/>`;
  if (
    ["launch", "discover", "homeward"].includes(scene.beat) ||
    scene.object === "rocket"
  )
    art += `<g transform="translate(179 287) rotate(-14)"><path d="M-33 133L-62 154L-63 188L-27 177M33 133L62 154L63 188L27 177" fill="#bc8e79"/><path d="M-36 58Q-33 14 0-22Q33 14 36 58V174H-36Z" fill="#ece6d7"/><path d="M-36 58Q-33 14 0-22Q33 14 36 58Z" fill="#c3937e"/><circle cx="0" cy="88" r="22" fill="#a8bdc0" stroke="#cbbca5" stroke-width="8"/><path d="M-16 176Q-18 214 0 233Q18 214 16 176" fill="#e8cb86"/><path d="M-8 176Q-6 201 0 214Q6 201 8 176" fill="#f0dfad"/></g>`;
  const companion =
    (scene.cast || []).find(
      (c) => c.kind === "rabbit" && c.id !== character.id,
    ) || DEFAULT_CHARACTERS[2];
  art +=
    protagonist(
      character,
      358 - (variation % 3) * 23,
      360,
      1.02,
      variation % 2 ? "stand" : "wave",
    ) + rabbit(companion, 531 + (variation % 3) * 19, 386, 0.9);
  if (scene.object === "glove")
    art += `<g transform="translate(463 463) rotate(-20)"><path d="M-12 11V-9Q-11-15-6-10V-20Q-4-27 1-20V-19Q4-28 8-20V-17Q13-24 16-16V3Q30-12 31-3L20 16Z" fill="#d5a986"/></g>`;
  if (scene.object === "footprints")
    art += `<g fill="#b5af9e" opacity=".65"><ellipse cx="407" cy="470" rx="6" ry="12" transform="rotate(-23 407 470)"/><ellipse cx="426" cy="497" rx="6" ry="12" transform="rotate(-23 426 497)"/><ellipse cx="444" cy="526" rx="6" ry="12" transform="rotate(-23 444 526)"/></g>`;
  return art;
}

function rainyScene(character, scene, variation) {
  const clear = ["clear", "rainbow"].includes(scene.beat),
    rainbow = scene.object === "rainbow";
  let art = `<rect width="800" height="580" fill="${clear ? "#e3e7d9" : "#d8e1de"}"/>${cloud(123, 103, 1.25, "#c3cfcb")}${cloud(540, 75, 1.6, "#c3cfcb")}${cloud(717, 153, 0.9, "#c7d0c9")}<path d="M0 353Q190 252 374 348Q567 274 800 357V580H0Z" fill="#b8c6ae"/><path d="M0 453Q223 366 436 429Q639 379 800 443V580H0Z" fill="#c3cbae"/>${tree(706, 389, 0.95, 1)}${tree(90, 377, 0.8)}<path d="M0 476Q254 410 433 454Q638 452 800 533V580H0Z" fill="#d1c6a6"/><ellipse cx="375" cy="492" rx="117" ry="28" fill="#a8bfc0"/><ellipse cx="371" cy="492" rx="73" ry="15" fill="#c5d6cf"/>`;
  if (rainbow) {
    for (let i = 0; i < 5; i++)
      art += `<path d="M${172 + i * 15} 263A${240 - i * 15} ${219 - i * 15} 0 0 1 ${652 - i * 15} 263" stroke="${["#d6a495", "#ddbb8b", "#e0d29d", "#aabd9d", "#a6bec4"][i]}" stroke-width="16" fill="none" opacity=".8"/>`;
  }
  if (clear) art += `<circle cx="559" cy="145" r="43" fill="#e8d7a4"/>`;
  if (!clear) {
    for (let i = 0; i < 33; i++) {
      const x = 35 + (hash(variation + "rx" + i) % 730),
        y = 75 + (hash("ry" + i) % 290);
      art += `<path d="M${x} ${y}l-5 14" stroke="#9db5b5" stroke-width="3" opacity=".5" stroke-linecap="round"/>`;
    }
  }
  const companion =
    (scene.cast || []).find(
      (c) => c.kind === "rabbit" && c.id !== character.id,
    ) || DEFAULT_CHARACTERS[2];
  art +=
    grass(variation + 1, "#99a47d") +
    rabbit(companion, 529 + (variation % 3) * 17, 407, 0.83);
  art += protagonist(
    { ...character, color: color(character.color, "#e4bb54") },
    356 - (variation % 3) * 13,
    386,
    0.95,
    clear || variation % 2 ? "wave" : "stand",
  );
  art += `<path d="M431 233V416Q431 445 447 445Q460 445 460 432" stroke="#8e8970" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M296 237Q312 121 431 119Q552 126 568 237Q537 216 516 237Q486 212 460 237Q431 210 406 237Q377 216 350 237Q322 216 296 237Z" fill="#d7b478"/><path d="M431 121Q366 161 350 235M431 121Q415 175 406 235M431 121Q453 175 460 235M431 121Q501 165 516 235" stroke="#c2a170" stroke-width="2" opacity=".6" fill="none"/><path d="M431 121V111" stroke="#998d71" stroke-width="5" stroke-linecap="round"/>`;
  art +=
    flower(155, 472, 0.6, "#d5a091") +
    flower(205, 459, 0.52, "#d5a091") +
    flower(627, 476, 0.55) +
    flower(673, 506, 0.4);
  return art;
}

function seaScene(character, scene, variation) {
  const sunset = scene.beat === "homeward";
  let art = `<rect width="800" height="580" fill="${sunset ? "#e8d8c3" : "#e0e9df"}"/><circle cx="623" cy="125" r="53" fill="${sunset ? "#dfa982" : "#ebe0ae"}" opacity=".8"/>${cloud(185, 102, 0.9)}${cloud(461, 71, 0.55)}<path d="M0 267Q204 253 413 266Q620 249 800 269V580H0Z" fill="#a2c2c0"/><path d="M0 321Q129 307 283 324Q492 301 800 324" stroke="#ceddd1" stroke-width="8" fill="none"/><path d="M0 385Q200 325 339 377Q605 302 800 379V580H0Z" fill="#b7d1c9"/><path d="M0 420Q103 377 274 413Q403 403 517 426Q708 363 800 422V580H0Z" fill="#f0e3c8"/><path d="M0 429Q155 386 283 420Q511 432 614 412Q732 376 800 417" stroke="#faf1db" stroke-width="12" fill="none"/><path d="M0 520Q187 489 336 510Q626 472 800 532V580H0Z" fill="#e5d5b2"/>`;
  const companion =
    (scene.cast || []).find(
      (c) => c.kind === "adult" && c.id !== character.id,
    ) || DEFAULT_CHARACTERS[3];
  art +=
    person(companion, 536 + (variation % 3) * 18, 309, 1.18, "stand") +
    protagonist(
      character,
      350 - (variation % 3) * 23,
      353,
      1.03,
      variation % 2 ? "stand" : "wave",
    );
  art += shell(182, 478, 0.6) + shell(620, 506, 0.45) + shell(480, 526, 0.35);
  art += crab(202, 420, 0.8);
  if (scene.object === "castle" || scene.beat === "build")
    art += `<g transform="translate(649 424)"><path d="M-64 53V-7H-42V-33H-29V-17H-16V-33H-3V-7H17V-33H30V-17H43V-33H56V-7H76V53Z" fill="#cebb91"/><path d="M-47 52V-1H-10V52M27 52V-1H62V52" fill="#d8c69f"/><path d="M-3 52V28Q14 7 30 28V52Z" fill="#b69e76"/><path d="M-49-2H-7M25-2H65" stroke="#e8d7b2" stroke-width="5"/>${shell(-10, 8, 0.28)}</g>`;
  if (scene.object === "stick" || scene.beat === "help")
    art += `<path d="M224 435L274 407L290 411M261 415L264 393" stroke="#ab9375" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  art += `<path d="M84 205q15-12 30 0q15-12 30 0M395 156q10-9 20 0q10-9 20 0" stroke="#8faaa8" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return art;
}

function customScene(character, scene, variation) {
  let art = `<rect width="800" height="580" fill="#eae9d9"/><circle cx="608" cy="113" r="55" fill="#e9dbad"/>${cloud(253, 94, 0.9)}<path d="M0 363Q172 287 322 354Q557 274 800 371V580H0Z" fill="#c6cfae"/><path d="M0 445Q196 380 425 438Q654 377 800 445V580H0Z" fill="#bbc69f"/><path d="M132 580Q256 491 366 451Q452 427 556 463L677 580Z" fill="#d8caa8"/>${tree(121, 371, 1.05)}${tree(688, 354, 0.88, 1)}${grass(variation + 2)}`;
  const companion =
    (scene.cast || []).find(
      (c) => c.kind === "rabbit" && c.id !== character.id,
    ) || DEFAULT_CHARACTERS[2];
  art +=
    rabbit(companion, 519 + (variation % 3) * 19, 407, 0.91) +
    protagonist(
      character,
      346 - (variation % 3) * 24,
      371,
      1.02,
      scene.beat === "discover" || variation % 2 ? "wave" : "stand",
    );
  if (
    ["problem", "search", "find", "share", "play"].includes(scene.beat) ||
    scene.object === "ball"
  )
    art += `<circle cx="435" cy="465" r="27" fill="#c99077"/><path d="M414 446Q437 466 447 489" stroke="#deb297" stroke-width="4" fill="none"/><path d="M446 441Q425 461 416 483" stroke="#deb297" stroke-width="4" fill="none"/>`;
  if (scene.object === "picture")
    art += `<path d="M404 404L451 400L460 440L410 447Z" fill="#fbf4e0"/><circle cx="438" cy="414" r="7" fill="#e1c77d"/><path d="M414 436L425 421L435 434L450 425" stroke="#a1b391" stroke-width="3" fill="none"/>`;
  art +=
    flower(160, 477, 0.52) +
    flower(634, 502, 0.45, "#d6a994") +
    butterfly(521, 234, 0.44);
  return art;
}

/** Return self-contained scalable original art. Scene objects may be persisted with a page. */
export function sceneSVG(
  input = "dinosaur",
  character = DEFAULT_CHARACTERS[0],
  variation = 0,
) {
  let scene =
    typeof input === "string"
      ? {
          theme:
            detectTheme(input) === "custom" && themes[input]
              ? input
              : detectTheme(input),
          beat: "cover",
          object: "flowers",
          index: 0,
        }
      : input?.scene || input || {};
  const theme = themes[scene.theme] ? scene.theme : "custom";
  const chars = Array.isArray(character) ? character : null;
  const protagonistCharacter = chars
    ? chars[0] || DEFAULT_CHARACTERS[0]
    : character || DEFAULT_CHARACTERS[0];
  if (chars) scene = { ...scene, cast: chars };
  const v = Number(variation) || 0;
  const prefix =
    "art-" + hash(JSON.stringify([scene, protagonistCharacter.id, v]));
  let art;
  if (
    ["sleep", "return", "brush"].includes(scene.beat) ||
    (scene.object === "home" && scene.beat !== "cover")
  )
    art = interior(protagonistCharacter, scene, v);
  else if (theme === "dinosaur") art = forest(protagonistCharacter, scene, v);
  else if (theme === "moon") art = moonScene(protagonistCharacter, scene, v);
  else if (theme === "rain") art = rainyScene(protagonistCharacter, scene, v);
  else if (theme === "sea") art = seaScene(protagonistCharacter, scene, v);
  else art = customScene(protagonistCharacter, scene, v);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 580" width="800" height="580" role="img" aria-label="${esc(protagonistCharacter.name || "유하")}의 ${esc(themes[theme].label)} 이야기 그림"><defs><filter id="${prefix}-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="3" stitchTiles="stitch" result="noise"/><feColorMatrix in="noise" type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".11"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter><filter id="${prefix}-soft" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".025" numOctaves="2" seed="${3 + (v % 5)}" result="wash"/><feDisplacementMap in="SourceGraphic" in2="wash" scale="1.5" xChannelSelector="R" yChannelSelector="G"/></filter></defs><g filter="url(#${prefix}-paper)"><g filter="url(#${prefix}-soft)">${art}</g></g></svg>`;
}

export function characterSVG(character = DEFAULT_CHARACTERS[0], variation = 0) {
  const c = character || DEFAULT_CHARACTERS[0];
  const palette =
    c.kind === "dinosaur"
      ? "#e4ead9"
      : c.kind === "rabbit"
        ? "#eee5d6"
        : c.kind === "adult"
          ? "#eee0d5"
          : "#f0e8d4";
  const v = Number(variation) || 0;
  const prefix = "char-" + hash((c.id || c.name || "yuha") + v);
  const pose = v % 3 === 1 ? "wave" : v % 3 === 2 ? "sleep" : "stand";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420" width="420" height="420" role="img" aria-label="${esc(c.name || "등장인물")} 캐릭터"><defs><filter id="${prefix}"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="3" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".1"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><g filter="url(#${prefix})"><rect width="420" height="420" fill="${palette}"/><circle cx="210" cy="211" r="163" fill="#fff9e9" opacity=".48"/>${c.kind === "dinosaur" ? dinosaur(c, 205, 242, 1.44) : c.kind === "rabbit" ? rabbit(c, 210, 254, 1.48) : person(c, 210, 208, 1.4, pose)}${flower(73, 345, 0.4)}${flower(350, 359, 0.34, "#d4a695")}<path d="M52 382Q205 391 368 382" stroke="#c5c7a3" stroke-width="2" fill="none"/></g></svg>`;
}
