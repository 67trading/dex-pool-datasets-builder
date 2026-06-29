export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export const ALL_TIMEFRAMES: Timeframe[] = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
];

export function getTimeframeMs(timeframe: Timeframe): number {
  switch (timeframe) {
    case "1m":
      return 60_000;
    case "3m":
      return 3 * 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    default: {
      const exhaustive: never = timeframe;
      throw new Error(`Unsupported timeframe: ${String(exhaustive)}`);
    }
  }
}
