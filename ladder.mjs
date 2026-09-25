// ladder.mjs — How hard is a "guess which paper is in his collection" question, really?
//
// Builds 4-option questions at three difficulty levels and asks four players.
//   L0  : 3 random distractors                        (= roughly the published quiz game)
//   L1  : 3 random distractors from the same month    (vintage-matched)
//   L2  : 3 NEAREST distractors by title similarity   (a "hard pair", approximated)
//
// Players (all title-only, no LLM, no network):
//   rand  : uniform                              (chance = 25%)
//   short : the shortest title wins              (zero-knowledge heuristic)
//   knn5  : mean cosine to the 5 nearest of HIS titles
//   lr    : logistic regression on char n-grams, trained on his titles vs distractors
//
// Clean split: test questions use positives and distractors that were NOT used to
// train the players. Two cohorts (all vintages / August-2026 only) because the
// distractor pool is overwhelmingly August-2026 and title length drifts with time.
//
// Usage: node ladder.mjs [N_TEST] [SEED]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, extractGrams, fitIdf, toVec, makeIndex, scoreAll, topK, wilson, pc } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const N_TEST = Number(process.argv[2] || 200);
const SEED = Number(process.argv[3] || 20260925);

const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'));
const dist = JSON.parse(fs.readFileSync(path.join(HERE, 'distractors.json'), 'utf8'));

const vintage = (s) => {
  const m = String(s).match(/(\d{2})(\d{2})\.\d{4,5}/);
  return m ? 2000 + Number(m[1]) + '-' + m[2] : 'NA';
};

const POS = papers.filter((p) => p.source === 'arxiv' && p.title).map((p) => ({ title: p.title, v: vintage(p.url) }));
const NEG = dist.filter((d) => d.title).map((d) => ({ title: d.title, v: vintage(d.arxiv_id || d.url) }));

const rnd = mulberry32(SEED);
const shuffled = (n) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ---- split (clean: no test item trains any player) ----
// test positives = a random 40% of all vintages  ∪  every August-2026 positive (the vintage-matched cohort)
const augAll = POS.map((p, i) => (p.v === '2026-08' ? i : -1)).filter((i) => i >= 0);
const augSet = new Set(augAll);
const posOrder = shuffled(POS.length);
const rand40 = posOrder.slice(0, Math.floor(POS.length * 0.4));
const POS_TE = [...new Set([...rand40, ...augAll])];
const POS_TE_SET = new Set(POS_TE);
const POS_TR = posOrder.filter((i) => !POS_TE_SET.has(i));
const negOrder = shuffled(NEG.length);
const NEG_TR = new Set(negOrder.slice(0, Math.floor(NEG.length * 0.5)));
const NEG_TE = negOrder.filter((i) => !NEG_TR.has(i));
const NEG_TE_MONTH = NEG_TE.filter((i) => NEG[i].v === '2026-08');

console.log(`POS = ${POS.length}  (train ${POS_TR.length} / test ${POS_TE.length})`);
console.log(`NEG = ${NEG.length}  (train ${NEG_TR.size} / test-pool ${NEG_TE.length}, of which 2026-08 ${NEG_TE_MONTH.length})`);

// ---- vectorize: idf fitted on TRAIN ONLY ----
const posG = POS.map((d) => extractGrams(d.title));
const negG = NEG.map((d) => extractGrams(d.title));
const trainG = [...POS_TR.map((i) => posG[i]), ...[...NEG_TR].map((i) => negG[i])];
const idf = fitIdf(trainG);
const posVec = posG.map((g) => toVec(g, idf));
const negVec = negG.map((g) => toVec(g, idf));
const refVec = POS_TR.map((i) => posVec[i]);
const refIdx = makeIndex(refVec);
const negIdxAll = makeIndex(NEG_TE.map((i) => negVec[i])); // L2 draws neighbours from the TEST pool only
console.log(`features = ${idf.size}`);

// ---- logistic regression player (class-balanced, adagrad, L2-normalized inputs) ----
function trainLR(epochs = 18, lr0 = 0.35, l2 = 2e-6) {
  const docs = [];
  const wn = POS_TR.length + NEG_TR.size;
  const wp = wn / (2 * POS_TR.length), wneg = wn / (2 * NEG_TR.size);
  for (const i of POS_TR) docs.push({ f: [...posVec[i].v], n: posVec[i].norm, y: 1, cw: wp });
  for (const i of NEG_TR) docs.push({ f: [...negVec[i].v], n: negVec[i].norm, y: 0, cw: wneg });
  for (const d of docs) for (const kv of d.f) kv[1] = kv[1] / d.n;
  const w = new Map(), g2 = new Map();
  let b = 0, gb2 = 0;
  for (let ep = 0; ep < epochs; ep++) {
    for (let k = docs.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [docs[k], docs[j]] = [docs[j], docs[k]]; }
    for (const d of docs) {
      let z = b;
      for (const [k, v] of d.f) z += (w.get(k) || 0) * v;
      const p = 1 / (1 + Math.exp(-z));
      const err = (p - d.y) * d.cw;
      for (const [k, v] of d.f) {
        const g = err * v + l2 * (w.get(k) || 0);
        const gg = (g2.get(k) || 0) + g * g;
        g2.set(k, gg);
        w.set(k, (w.get(k) || 0) - (lr0 * g) / Math.sqrt(gg + 1e-8));
      }
      gb2 += err * err;
      b -= (lr0 * err) / Math.sqrt(gb2 + 1e-8);
    }
  }
  return { w, b };
}
const scoreLR = (m, vecEntry) => {
  let z = m.b;
  for (const [k, v] of vecEntry.v) { const wk = m.w.get(k); if (wk) z += wk * (v / vecEntry.norm); }
  return z;
};

const tLR = Date.now();
const MODEL = trainLR();
console.log(`LR trained in ${Date.now() - tLR} ms`);

// ---- players ----
const meanTopK = (vecEntry, k) => {
  const s = scoreAll(refIdx, vecEntry.v, vecEntry.norm);
  const t = topK(s, k, null);
  return t.length ? t.reduce((a, b) => a + b[1], 0) / t.length : 0;
};
const PLAYERS = {
  rand: (opts) => Math.floor(rnd() * opts.length),
  short: (opts) => {
    let b = 0;
    opts.forEach((o, i) => { if (o.title.replace(/[^A-Za-z0-9]/g, '').length < opts[b].title.replace(/[^A-Za-z0-9]/g, '').length) b = i; });
    return b;
  },
  knn5: (opts) => {
    let b = 0, bs = -Infinity;
    opts.forEach((o, i) => { const s = meanTopK(o.vec, 5); if (s > bs) { bs = s; b = i; } });
    return b;
  },
  lr: (opts) => {
    let b = 0, bs = -Infinity;
    opts.forEach((o, i) => { const s = scoreLR(MODEL, o.vec); if (s > bs) { bs = s; b = i; } });
    return b;
  },
};
const PLAYER_NAMES = Object.keys(PLAYERS);

// ---- run one cohort ----
function runCohort(label, pool, distPool) {
  const n = Math.min(N_TEST, pool.length);
  const testPos = pool.slice(0, n);
  const scores = Object.fromEntries(PLAYER_NAMES.map((p) => [p, [0, 0, 0]]));
  const sim = [[], [], []];
  const examples = [];
  const t0 = Date.now();
  for (const pi of testPos) {
    for (let lv = 0; lv < 3; lv++) {
      let ds;
      if (lv === 2) {
        const s = scoreAll(negIdxAll, posVec[pi].v, posVec[pi].norm);
        ds = topK(s, 3, null).map(([j]) => ({ kind: 'neg', i: NEG_TE[j] }));
      } else {
        const src = lv === 0 ? distPool : distPool.filter((i) => NEG[i].v === '2026-08');
        const used = new Set();
        ds = [];
        let guard = 0;
        while (ds.length < 3 && guard++ < 5000) { const i = src[Math.floor(rnd() * src.length)]; if (used.has(i)) continue; used.add(i); ds.push({ kind: 'neg', i }); }
      }
      const opts = [{ kind: 'pos', i: pi, title: POS[pi].title, v: POS[pi].v, vec: posVec[pi] }, ...ds.map((d) => ({ kind: 'neg', i: d.i, title: NEG[d.i].title, v: NEG[d.i].v, vec: negVec[d.i] }))];
      for (let k = opts.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]]; }
      // difficulty knob: mean cosine of the distractors to the test positive (computed the same way at every level)
      const tpv = posVec[pi];
      {
        const direct = (a, b) => {
          let d = 0; const [x, y] = a.v.size < b.v.size ? [a, b] : [b, a];
          for (const [k, v] of x.v) { const w2 = y.v.get(k); if (w2) d += v * w2; }
          return d / (a.norm * b.norm);
        };
        opts.filter((o) => o.kind === 'neg').forEach((o) => sim[lv].push(direct(tpv, o.vec)));
      }
      const ci = opts.findIndex((o) => o.kind === 'pos');
      const ans = {};
      for (const p of PLAYER_NAMES) ans[p] = PLAYERS[p](opts);
      for (const p of PLAYER_NAMES) if (ans[p] === ci) scores[p][lv]++;
      if (examples.length < 6) examples.push({ lv, correct: opts[ci].title, options: opts.map((o, i) => `${i === ci ? '>>>' : '   '} ${o.kind} ${o.title}`), ans });
    }
  }
  const names = ['L0 random', 'L1 same-month', 'L2 nearest'];
  console.log(`\n### cohort ${label}  (n=${n}, built in ${Date.now() - t0} ms)`);
  console.log('difficulty knob — mean cosine(test positive, distractor) per level:');
  for (let lv = 0; lv < 3; lv++) {
    const a = sim[lv];
    const mean = a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const sorted = [...a].sort((x, y) => x - y);
    console.log(`  ${names[lv].padEnd(14)} mean=${mean.toFixed(3)}  p90=${sorted[Math.floor(0.9 * sorted.length)].toFixed(3)}  max=${sorted[sorted.length - 1].toFixed(3)}`);
  }
  console.log('player   ' + names.map((x) => x.padEnd(18)).join(''));
  for (const p of PLAYER_NAMES) {
    console.log(p.padEnd(9) + [0, 1, 2].map((lv) => {
      const [lo, hi] = wilson(scores[p][lv], n);
      return `${pc(scores[p][lv] / n)} [${pc(lo, 0)}-${pc(hi, 0)}]`.padEnd(18);
    }).join(''));
  }
  return { label, n, scores, simMean: [0, 1, 2].map((lv) => sim[lv].reduce((x, y) => x + y, 0) / (sim[lv].length || 1)), examples };
}

const POS_TE_MONTH = POS_TE.filter((i) => POS[i].v === '2026-08');
const out = {
  seed: SEED,
  res: [
    runCohort('ALL vintages (2022-2026)', POS_TE, NEG_TE),
    runCohort('2026-08 only (vintage-matched)', POS_TE_MONTH, NEG_TE),
  ],
};
fs.writeFileSync(path.join(HERE, `ladder-results-${N_TEST}.json`), JSON.stringify(out, null, 2));
console.log(`\nwrote ladder-results-${N_TEST}.json`);
