/*
 * 주제대로 끝맺기 (2026-10-21, R31a). Simple mode has no ending choice, so
 * every simple story was told to "close calmly at home": a story about
 * going to kindergarten was turned round and sent home to bed. New
 * simple-mode drafts freeze input.topicEndingPolicy {version: 1} and an
 * endingType "custom" whose note is the topic itself, so the existing custom
 * ending rules apply (the first beat at home, the last where the story goes,
 * no added return home or bedtime). Pro drafts keep their own ending choice.
 */
export const TOPIC_ENDING_VERSION = 1;
export const topicEndingPolicy = () => ({ version: TOPIC_ENDING_VERSION });
export const hasTopicEnding = (input) =>
  input?.topicEndingPolicy?.version === TOPIC_ENDING_VERSION;
export function topicEndingNote(topic, { change = false } = {}) {
  const text = String(topic || "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
  // R38: a topic that goes nowhere ends where it began with one thing changed; no added trip home or bedtime.
  if (change)
    return `부모가 적은 주제대로 끝나요: "${text}". 이야기가 향하는 곳(예: 유치원에 가는 이야기는 유치원에 들어가는 장면)에서 그 행동으로 끝내고, 주제에 가는 곳이 없으면 이야기가 시작한 곳에서 끝내되 처음과 하나가 달라진 채로 끝내요. 집으로 돌아가거나 잠드는 장면을 덧붙이지 않아요.`;
  return `부모가 적은 주제대로 끝나요: "${text}". 이야기가 향하는 곳(예: 유치원에 가는 이야기는 유치원에 들어가는 장면)에서 그 행동으로 끝내고, 주제에 가는 곳이 없으면 집에서 편안히 끝내요.`;
}
