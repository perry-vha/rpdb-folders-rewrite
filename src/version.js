const parts = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);

/** Minimal semver comparison: >0 if a is newer than b. */
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}
