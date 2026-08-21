export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round0(n: number): number {
  return Math.round(n);
}

export function nextSeason(year: number, season: string): { year: number; season: "spring" | "summer" | "autumn" | "winter" } {
  switch (season) {
    case "spring":
      return { year, season: "summer" };
    case "summer":
      return { year, season: "autumn" };
    case "autumn":
      return { year, season: "winter" };
    default:
      return { year: year + 1, season: "spring" };
  }
}

export function deepClone<T>(v: T): T {
  return structuredClone(v);
}
