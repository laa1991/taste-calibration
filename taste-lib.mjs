// taste-lib.mjs — shared vectorizer / index / stats for the taste-probe experiments.
// Pure local, no network, no third-party deps. Deterministic given a seed.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normText(s) {
  return ' ' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

// features = char n-grams (nmin..nmax, word-boundary padded) + word unigrams prefixed W:
export function extractGrams(s, nmin = 3, nmax = 4) {
  const t = normText(s);
  const m = new Map();
  const bump = (g) => m.set(g, (m.get(g) || 0) + 1);
  for (let n = nmin; n <= nmax; n++) {
    for (let i = 0; i + n <= t.length; i++) bump(t.slice(i, i + n));
  }
  for (const w of t.trim().split(' ')) if (w) bump('W:' + w);
  return m;
}

export function fitIdf(gramDocs) {
  const df = new Map();
  for (const g of gramDocs) for (const k of g.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = gramDocs.length;
  const idf = new Map();
  for (const [k, v] of df) idf.set(k, Math.log((1 + N) / (1 + v)) + 1);
  return idf;
}

export function toVec(g, idf) {
  const v = new Map();
  let sq = 0;
  for (const [k, tf] of g) {
    const i = idf.get(k);
    if (i === undefined) continue; // unseen term: ignore (do not up-weight by absence)
    const w = (1 + Math.log(tf)) * i;
    v.set(k, w);
    sq += w * w;
  }
  return { v, norm: Math.sqrt(sq) || 1 };
}

// inverted index over a reference set; postings stored flat as [idx, w, idx, w, ...]
export function makeIndex(vecs) {
  const inv = new Map();
  vecs.forEach((vec, i) => {
    for (const [k, w] of vec.v) {
      let L = inv.get(k);
      if (!L) { L = []; inv.set(k, L); }
      L.push(i, w);
    }
  });
  const norms = vecs.map((x) => x.norm);
  return { inv, norms, n: vecs.length };
}

// scores of query against every reference doc (cosine)
export function scoreAll(index, qvec, qnorm, out) {
  const acc = out || new Float64Array(index.n);
  acc.fill(0);
  for (const [k, wq] of qvec) {
    const L = index.inv.get(k);
    if (!L) continue;
    for (let i = 0; i < L.length; i += 2) acc[L[i]] += wq * L[i + 1];
  }
  for (let i = 0; i < index.n; i++) acc[i] = acc[i] / (qnorm * index.norms[i]);
  return acc;
}

export function topK(scores, k, excludeSet) {
  const best = [];
  for (let i = 0; i < scores.length; i++) {
    if (excludeSet && excludeSet.has(i)) continue;
    const s = scores[i];
    if (best.length < k) { best.push([i, s]); best.sort((a, b) => b[1] - a[1]); continue; }
    if (s > best[best.length - 1][1]) { best[best.length - 1] = [i, s]; best.sort((a, b) => b[1] - a[1]); }
  }
  return best;
}

export function meanTopK(index, qvec, qnorm, k, excludeSet) {
  const s = scoreAll(index, qvec, qnorm);
  const t = topK(s, k, excludeSet);
  if (!t.length) return 0;
  return t.reduce((a, b) => a + b[1], 0) / t.length;
}

export function wilson(k, n, z = 1.959963984540054) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

export function pc(x, digits = 1) {
  return (100 * x).toFixed(digits) + '%';
}
