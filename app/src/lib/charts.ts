// Deterministic noise generator used by Sparkline/AreaChart placeholders.
export function noisySeries(n: number, seed: number, base = 50, range = 30): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const t = i / (n - 1 || 1);
    out.push(base + Math.sin(t * Math.PI * 2 + seed) * range * 0.4 + (r - 0.5) * range);
  }
  return out;
}
