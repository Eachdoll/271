/* 무대 (R33-3, 2026-10-23): the big stage categories above the 100 world
 * cards — 집·동네, 도시·거리, 시장·축제·골목, 자연(바다), 자연(산·숲),
 * 자연(들판·강·호수), 눈·얼음·사막, 하늘·우주, 옛날, 상상 나라. A category is
 * the stage a parent picks in one tap; a world card is the finer choice inside
 * it. The lean outline request carries the stage as one sensory STAGE line
 * (the chosen world card's own sights when there is one), the writers' room
 * hears it, ② recommends the drawer places that fit it and says when none
 * does. Pure: no DOM, no network. */
export const STAGE_VERSION = 1;
const stage = (id, name, ko, en, topicWords, placePattern, worldIds) =>
  Object.freeze({ id, name, ko, en, topicWords: Object.freeze(topicWords), placePattern, worldIds: Object.freeze(worldIds) });
export const STAGE_CATEGORIES = Object.freeze([
  stage("home_town", "집·동네", "마당·골목·놀이터·유치원, 아는 얼굴들",
    "Home and the neighbourhood — a yard, a lane, the playground, the kindergarten; familiar faces and everyday sounds.",
    ["집에서", "우리 집", "마당", "동네", "골목", "유치원", "학교", "놀이터", "이웃", "할머니 집", "방에서"],
    /집|방|마당|동네|골목|유치원|학교|놀이터|home|room|yard|school|playground|neighbo/i,
    ["home", "kindergarten", "grandma_village"]),
  stage("city", "도시·거리", "높은 건물·버스·횡단보도·가게 창문·불빛",
    "A city — tall buildings, buses and crossings, shop windows, bright signs, busy street sounds.",
    ["도시", "버스", "지하철", "기차", "빌딩", "거리", "횡단보도", "신호등", "가게", "백화점", "병원", "도서관", "박물관", "아파트"],
    /도시|거리|버스|지하철|빌딩|가게|시내|도서관|병원|박물관|역|city|street|station|shop|town|library|museum/i,
    ["paris_bakery", "venice_canals", "robot_city", "seoul_hangang", "sky_train_city", "solar_glass_city", "netherlands_canal_town"]),
  stage("market_festival", "시장·축제·골목", "가게들·등불·음식 냄새·북적임·음악",
    "A market, a festival or a lane of little shops — stalls, lanterns, food smells, bustle and music.",
    ["시장", "축제", "장터", "야시장", "광장", "불꽃놀이", "등불", "잔치"],
    /시장|장터|축제|골목|광장|야시장|잔치|market|festival|plaza|square|lane|bazaar/i,
    ["kyoto_lane", "vietnam_floating_market", "india_bazaar", "morocco_souk", "mexico_plaza", "thailand_night_market", "spain_flamenco_square"]),
  stage("nature_sea", "자연 · 바다", "모래·파도·조개·갈매기·등대·바위 웅덩이",
    "The sea — sand, waves, shells, gulls, a lighthouse, rock pools; wet feet and salt wind.",
    ["바다", "바닷가", "해변", "조개", "파도", "갈매기", "등대", "항구", "섬", "산호", "고래", "물고기", "모래성", "수영"],
    /바다|바닷|해변|조개|항구|등대|섬|산호|sea|beach|ocean|harbo|reef|island|coast/i,
    ["jeju_sea", "australia_reef", "undersea_city", "greece_island", "norway_fjord", "busan_harbor", "hawaii_volcano_beach", "underwater_volcano_lab", "ocean_cleanup_ship"]),
  stage("nature_mountain", "자연 · 산·숲", "나무·바위·오솔길·새소리·시냇물·낙엽",
    "Mountains and woods — trees, rocks, a winding path, birdsong, a stream, leaves underfoot.",
    ["산에", "산으로", "산길", "산속", "뒷산", "등산", "숲", "나무", "계곡", "동굴", "바위", "다람쥐", "오솔길", "캠핑", "단풍", "소풍"],
    /산|숲|나무|계곡|동굴|바위|mountain|forest|wood|cave|hill|trail/i,
    ["peru_andes", "korea_mountain_autumn", "swiss_alps", "china_panda"]),
  stage("nature_field", "자연 · 들판·강·호수", "풀밭·꽃·강가·호숫가·농장·바람",
    "Fields, rivers and lakes — grass, flowers, a riverbank, a lakeshore, a farm; wind and open sky.",
    ["들판", "풀밭", "강가", "강에", "강물", "한강", "호수", "냇가", "시냇물", "농장", "목장", "밭에", "초원", "꽃밭", "텃밭", "정원", "연못"],
    /들판|풀밭|강|호수|냇|농장|목장|밭|초원|꽃|정원|연못|field|meadow|river|lake|farm|garden|pond|savanna/i,
    ["netherlands_tulips", "kenya_savanna", "mongolia_steppe", "brazil_amazon", "canada_maple", "nz_sheep_farm", "robot_farm", "madagascar_baobab", "scotland_castle_lake", "tanzania_crater"]),
  stage("snow_desert", "눈·얼음·사막", "눈밭·얼음·썰매·모래 언덕·낙타·펭귄",
    "Snow, ice or desert — snowfields, ice, a sled, dunes, camels or penguins; cold breath or hot sand.",
    ["눈사람", "눈이 와", "눈 오는", "눈밭", "눈싸움", "함박눈", "첫눈", "썰매", "얼음", "빙하", "사막", "낙타", "펭귄", "북극", "남극", "스키", "오로라"],
    /눈|얼음|빙하|사막|썰매|오로라|snow|ice|desert|glacier|sled|aurora/i,
    ["iceland_aurora", "egypt_nile", "finland_snow", "korea_snow_village", "alaska_glacier", "dubai_desert_city"]),
  stage("sky_space", "하늘·우주", "구름·별·달·로켓·비행선·무지개",
    "The sky and space — clouds, stars, the moon, a rocket, an airship, a rainbow; floating and far-off views.",
    ["하늘", "구름", "별이", "별을", "별나라", "별똥별", "밤하늘", "달에", "달나라", "달님", "보름달", "우주", "로켓", "비행기", "열기구", "비행선", "행성", "무지개"],
    /하늘|구름|우주|달|별|로켓|비행|sky|cloud|space|moon|star|rocket|planet|balloon/i,
    ["mars_base", "space_station", "sky_farm", "cappadocia_balloons", "moon_base", "airship_cloudliner", "star_cruiser_garden", "weather_station_sky", "mars_greenhouse_town"]),
  stage("long_ago", "옛날", "한옥·성·공룡·동굴·돛배·횃불",
    "Long ago — a hanok village, a castle, dinosaurs, a cave, sailing ships; torches, drums and old ways.",
    ["옛날", "공룡", "기사님", "공주", "임금님", "왕자", "한옥", "조선", "해적", "매머드", "성에", "성으로", "궁궐", "원시", "바이킹"],
    /옛날|공룡|궁궐|한옥|해적|기와|초가|castle|dino|palace|ancient|pirate|medieval|viking/i,
    ["joseon_village", "stone_age_cave", "medieval_castle", "pirate_island", "silk_road_caravan", "dino_land", "ancient_rome_market", "viking_harbor", "silla_gyeongju", "goryeo_kiln", "steam_train_station", "joseon_palace", "dino_sea", "ancient_greece_games", "ice_age_plain", "edo_castle_town", "mongol_empire_camp", "old_korean_village_winter", "pyramid_builders_river", "wild_west_station"]),
  stage("imagination", "상상 나라", "과자·구름·장난감·그림·꿈·마법",
    "An imagined land — made of sweets, clouds, toys, paint or dreams; its own gentle rules, one wonder at a time.",
    ["과자 나라", "사탕", "구름 나라", "장난감", "그림 속", "꿈속", "꿈나라", "요정", "마법", "거인", "거꾸로", "비눗방울", "인형", "책 속"],
    /과자|사탕|장난감|그림|꿈|요정|마법|거인|거꾸로|비눗방울|인형|candy|toy|dream|magic|giant|fairy|paint/i,
    ["cloud_kingdom", "candy_land", "giant_garden", "painting_world", "toy_drawer_town", "book_kingdom", "upside_down_land", "bubble_land", "music_forest", "color_land", "shadow_puppet_land", "snow_globe_village", "kitchen_giant_land", "dream_train", "time_clock_tower", "rainbow_waterfall_valley", "pillow_fort_kingdom", "backyard_bug_city", "cloud_whale_sky", "mirror_lake_kingdom", "gingerbread_winter_town", "crayon_jungle", "moonlight_garden", "sock_puppet_theater", "balloon_island_sky"]),
]);
const byId = new Map(STAGE_CATEGORIES.map((category) => [category.id, category])),
  worldStage = new Map(STAGE_CATEGORIES.flatMap((category) => category.worldIds.map((id) => [id, category.id])));
export const stageById = (id) => byId.get(String(id ?? "")) || null;
export const isStageId = (id) => byId.has(String(id ?? ""));
export const stageLabel = (id) => stageById(id)?.name || "";
/** The category of a world card (null for an unknown id or the drawer). */
export const worldStageId = (worldId) => worldStage.get(String(worldId ?? "")) || null;
/** Select rows: 자동 first, then every category as "이름 · 한 줄". */
export const STAGE_OPTIONS = Object.freeze([
  ["auto", "자동 · 주제대로"],
  ...STAGE_CATEGORIES.map((category) => [category.id, `${category.name} · ${category.ko}`]),
]);
/** The world cards of a category (every card when the category is auto or unknown). */
export function stageWorlds(categoryId, worlds = []) {
  const list = Array.isArray(worlds) ? worlds : [],
    category = stageById(categoryId);
  return category ? list.filter((world) => category.worldIds.includes(world?.id)) : list;
}
/** The category a topic names by its words; null when none does. */
export function stageFromTopic(topic) {
  const text = String(topic || "");
  let best = null,
    bestScore = 0;
  for (const category of STAGE_CATEGORIES) {
    const score = category.topicWords.filter((word) => text.includes(word)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}
/** What the frozen input keeps: version, id, name and where the choice came from. */
export const stageRef = (category, from = "pick") =>
  category && stageById(category.id)
    ? { version: STAGE_VERSION, id: category.id, name: stageById(category.id).name, from: ["pick", "world", "topic"].includes(from) ? from : "pick" }
    : null;
/** The stage of a new draft: the parent's pick, else the chosen world card's category, else the topic's. */
export function stageFor({ pick = "auto", worldId = "drawer", topic = "" } = {}) {
  const picked = stageById(pick);
  if (picked) return stageRef(picked, "pick");
  const fromWorld = stageById(worldStageId(worldId));
  if (fromWorld) return stageRef(fromWorld, "world");
  const guessed = stageFromTopic(topic);
  return guessed ? stageRef(guessed, "topic") : null;
}
const placeText = (background = {}) =>
  [background.name, background.nameEn, background.description, background.type].filter(Boolean).join(" ");
/** The drawer places that fit a chosen stage, in drawer order (none for auto). */
export function stagePlaceIds(categoryId, backgrounds = []) {
  const category = stageById(categoryId),
    list = Array.isArray(backgrounds) ? backgrounds : [];
  if (!category) return [];
  return list.filter((b) => b?.id && category.placePattern.test(placeText(b))).map((b) => b.id);
}
/** True when the parent chose a stage and no drawer place fits it. */
export function stageMissing(categoryId, backgrounds = []) {
  return !!stageById(categoryId) && stagePlaceIds(categoryId, backgrounds).length === 0;
}
const ko = (row) => (typeof row === "string" ? row : row?.ko || row?.name?.ko || ""),
  few = (rows, count = 3) => (Array.isArray(rows) ? rows : []).slice(0, count).map(ko).filter(Boolean).join(", ");
/** The lean outline request's STAGE line: the chosen world card's own sights, else the category's. */
export function stageRule(input = {}) {
  const world = input?.storyWorld;
  if (world && typeof world === "object" && (world.name || world.id)) {
    const name = ko(world.name) || String(world.name || world.id),
      en = world.name?.en ? ` (${world.name.en})` : "",
      parts = [
        few(world.landmarks) && `sights ${few(world.landmarks)}`,
        few(world.creatures) && `creatures ${few(world.creatures)}`,
        few(world.sounds, 2) && `sounds ${few(world.sounds, 2)}`,
      ]
        .filter(Boolean)
        .join("; ");
    return `STAGE — ${name}${en}${world.arrival ? `: ${String(world.arrival).slice(0, 120)}` : ""}${parts ? ` — ${parts}` : ""}. The supplied places carry the story there; let the stage's sights and sounds enter the beats where they help, never as a tour.`;
  }
  const category = stageById(input?.stageCategory?.id);
  if (!category) return "";
  return `STAGE — ${category.name}: ${category.en} The supplied places that fit this stage carry the story; name no real city or country unless the topic does.`;
}
/** The writers' room hears the stage in one clause (Korean). */
export function stageDirection(input = {}) {
  const world = input?.storyWorld,
    name = world && typeof world === "object" ? ko(world.name) : "";
  if (name) return `무대: ${name}`;
  const category = stageById(input?.stageCategory?.id);
  return category ? `무대: ${category.name} — ${category.ko}` : "";
}
/** The material planner's sentence for a stage the parent chose (or a chosen world card implies). */
export function stagePlanLine(input = {}) {
  const category = stageById(input?.stageCategory?.id);
  if (!category || input.stageCategory.from === "topic") return "";
  return ` The parent chose the stage "${category.name}" (${category.ko}): prefer the supplied places that fit it; when none fits and new places are allowed, create one place there.`;
}
