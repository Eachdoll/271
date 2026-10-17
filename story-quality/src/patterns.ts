import type { PlotPatternCard } from "./types.js";
export const BEAT_COUNTS: Readonly<Record<number, number>> = Object.freeze({
  8: 6,
  12: 7,
  16: 8,
  24: 8,
});
export function beatCountFor(pageCount: number, koreanLevel: string): number {
  const count = BEAT_COUNTS[pageCount] || 7;
  return koreanLevel === "K1" ? Math.min(count, 7) : count;
}
/** Same allocation as the app: setup/want, attempts, turn/resolution/close. */
export function adaptPatternForBook(
  pattern: PlotPatternCard,
  pageCount: number,
  koreanLevel: string,
): PlotPatternCard {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const slots = pattern.beats.filter((beat) => beat.type === "attempt");
  const other = (type: "setup" | "want" | "turn" | "resolution" | "close") =>
    clone(
      pattern.beats.find((beat) => beat.type === type) || {
        type,
        slot: `${type} 역할을 사건의 원인과 결과로 구체화한다.`,
      },
    );
  const attempts = Array.from(
    { length: beatCountFor(pageCount, koreanLevel) - 5 },
    (_, index) => {
      const source = slots[Math.min(index, slots.length - 1)] || {
        type: "attempt" as const,
        slot: "앞선 결과를 보고 방법을 바꿔 구체적으로 시도한다.",
      };
      return {
        ...clone(source),
        slot: `${source.slot}${index >= slots.length ? " 앞선 시도와 다른 원인·방법·결과로 발전시킨다." : ""}`,
      };
    },
  );
  return {
    ...clone(pattern),
    beats: [
      other("setup"),
      other("want"),
      ...attempts,
      other("turn"),
      other("resolution"),
      other("close"),
    ],
  };
}
