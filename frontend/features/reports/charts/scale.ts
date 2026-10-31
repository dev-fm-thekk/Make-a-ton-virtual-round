// Axis maths for the charts. Pure, so it is unit-tested.

/** Round `max` up to a "nice" ceiling (1, 2, 2.5, 5 × 10ⁿ) and return evenly spaced ticks from 0. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number((v).toPrecision(12)));
  return ticks;
}

/** Which indexes get an x-axis label so labels never collide: at most `maxLabels`, always the first and last. */
export function labelIndexes(n: number, maxLabels: number): number[] {
  if (n <= 0) return [];
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const stride = Math.ceil((n - 1) / (maxLabels - 1));
  const out: number[] = [];
  for (let i = 0; i < n; i += stride) out.push(i);
  if (out[out.length - 1] !== n - 1) {
    // keep the last label, dropping the previous one if they would touch
    if (n - 1 - out[out.length - 1]! <= stride / 2) out.pop();
    out.push(n - 1);
  }
  return out;
}
