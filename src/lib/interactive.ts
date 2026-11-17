// Pure helpers for interactive cards (client-safe; unit-tested in tests/interactive.test.ts).

export function formatNumber(n: number, unit = ""): string {
  const abs = Math.abs(n);
  const s =
    abs >= 1e6
      ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)
      : new Intl.NumberFormat("en", { maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : 2 }).format(n);
  if (!unit) return s;
  return unit === "%" ? `${s}%` : `${s} ${unit}`;
}

/** How a guess compares to the answer, in words. */
export function guessVerdict(guess: number, answer: number): { label: string; close: boolean } {
  if (answer === 0) return { label: guess === 0 ? "Spot on" : "Not quite", close: guess === 0 };
  const off = Math.abs(guess - answer) / Math.abs(answer);
  if (off <= 0.1) return { label: "Spot on", close: true };
  if (off <= 0.25) return { label: "Close", close: true };
  if (guess > 0 && answer > 0) {
    const factor = Math.max(guess / answer, answer / guess);
    if (factor >= 2) return { label: `Off by ${factor >= 10 ? Math.round(factor) : factor.toFixed(1)}×`, close: false };
  }
  return { label: guess > answer ? "Too high" : "Too low", close: false };
}

/** Slider position (0–1000) <-> value. Wide positive ranges use a log scale so small numbers stay pickable. */
export function sliderScale(min: number, max: number) {
  const log = min > 0 && max / min >= 50;
  return {
    log,
    toValue: (pos: number) =>
      log ? Math.exp(Math.log(min) + (pos / 1000) * (Math.log(max) - Math.log(min))) : min + (pos / 1000) * (max - min),
    toPos: (v: number) =>
      Math.round(log ? ((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 1000 : ((v - min) / (max - min)) * 1000),
  };
}
