export function round(n: number, dp = 2) {
  const p = Math.pow(10, dp);
  return Math.round(n * p) / p;
}

