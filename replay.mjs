// replay.mjs — replay the week's selection task with title-only selectors.
//
// Ground truth = the 37 papers in the collection's section "Week of 2026-08-22"
// (the blog's hand-judged week: 2026-08-17..21).
// Candidate pool = those 37 + the 343 same-month distractors  -> positive rate 9.7%,
// i.e. ~10x the real rate, so every number here is an UPPER-ish bound, not a head-to-head.
//
// Selectors: random(15) / shortest-15 / kNN-15 / LR-15 / the published agent's own 15.
//
// Usage: node replay.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, extractGrams, fitIdf, toVec, makeIndex, scoreAll, topK, wilson, pc } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20260925;
const rnd = mulberry32(SEED);

const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'));
const dist = JSON.parse(fs.readFileSync(path.join(HERE, 'distractors.json'), 'utf8'));
const idOf = (s) => { const m = String(s).match(/(\d{4}\.\d{4,5})/); return m ? m[1] : null; };
const vintage = (s) => { const m = String(s).match(/(\d{2})(\d{2})\.\d{4,5}/); return m ? 2000 + Number(m[1]) + '-' + m[2] : 'NA'; };

// --- ground truth: his collection for that week ---
const gtPapers = papers.filter((p) => p.section === 'Week of 2026-08-22');
const GT = new Set(gtPapers.map((p) => idOf(p.url)).filter(Boolean));
console.log(`ground truth (section "Week of 2026-08-22") = ${gtPapers.length}`);

// --- candidate pool ---
const cand = [
  ...gtPapers.map((p) => ({ id: idOf(p.url), title: p.title, kind: 'gt' })),
  ...dist.filter((d) => vintage(d.arxiv_id || d.url) === '2026-08').map((d) => ({ id: d.arxiv_id || idOf(d.url), title: d.title, kind: 'dist' })),
];
console.log(`candidate pool = ${cand.length}  (positive rate ${pc(GT.size / cand.length)}; real rate is ~1%)`);

// --- the agent's own 15 picks (titles transcribed from the public blog table) ---
const AGENT15 = [
  ['2608.18319', 'SingularClip: Preventing Spectral Collapse to Maintain Plasticity'],
  ['2608.18415', 'The Road Taken: The Role of Optimizers at the Edge of Stability'],
  ['2608.16760', 'On the Principles Behind Neural Network Optimizers'],
  ['2608.17950', 'Six Degrees of Separation: Topological Compression in Long-Context Manifolds'],
  ['2608.15854', 'Geometry of Forgetting: Representation Flux in Continual Learning'],
  ['2608.19584', 'Kähler landscapes for complex neural network descents'],
  ['2608.19338', 'Mechanistic Tomography: Designed Measurement for Control-Oriented Interp'],
  ['2608.15976', 'Fiber Fingerprints of Hidden Learning-State Dynamics'],
  ['2608.15901', 'Layers Matter: Why Continual Learning Regularization Should Be Layer-Adaptive'],
  ['2608.18592', 'Infrared Universality of Collective Dynamics across Transformer and State-Space'],
  ['2608.15483', 'Measuring Structured Predictability in Neural Training Dynamics'],
  ['2608.15632', 'Sparse Prototype Code Underlies Classification and Prediction Across Modalities'],
  ['2608.19995', 'The Forward-Backward Disconnect: State Dynamics, Credit Assignment, and Biological Grounding'],
  ['2608.19762', 'Finite-Horizon Input-Output Dynamics of Minibatch Perturbations in AdamW'],
  ['2608.15772', 'Broken Symmetry in LLM Refusal: Answer Release Is More Local Than Refusal Restoration'],
];

// --- training sets: never see the 37, never see the August distractors ---
const GT_IDS = GT;
const POS_ALL = papers.filter((p) => p.source === 'arxiv' && p.title).map((p) => ({ id: idOf(p.url), title: p.title }));
const POS_TR = POS_ALL.filter((p) => !GT_IDS.has(p.id));
const AUG_DIST = new Set(dist.filter((d) => vintage(d.arxiv_id || d.url) === '2026-08').map((d) => d.arxiv_id));
const NEG_ALL = dist.filter((d) => d.title).map((d) => ({ id: d.arxiv_id, title: d.title }));
const NEG_TR = NEG_ALL.filter((d) => !AUG_DIST.has(d.id));
console.log(`train positives = ${POS_TR.length}   train negatives = ${NEG_TR.length} (non-August only)`);

const g = (t) => extractGrams(t);
const trG = [...POS_TR.map((p) => g(p.title)), ...NEG_TR.map((d) => g(d.title))];
const idf = fitIdf(trG);
const POSV = POS_TR.map((p) => toVec(g(p.title), idf));
const NEGV = NEG_TR.map((d) => toVec(g(d.title), idf));
const CANDV = cand.map((c) => ({ ...c, vec: toVec(g(c.title), idf) }));
const refIdx = makeIndex(POSV);

// --- LR ---
function trainLR(docs, epochs = 25, lr0 = 0.4, l2 = 2e-6) {
  const n = docs.length;
  const wp = n / (2 * POSV.length), wn = n / (2 * NEGV.length);
  const items = docs.map((d, i) => ({ f: [...d.vec.v].map(([k, v]) => [k, v / d.vec.norm]), y: d.y, cw: d.y ? wp : wn }));
  const w = new Map(), g2 = new Map();
  let b = 0, gb2 = 0;
  for (let ep = 0; ep < epochs; ep++) {
    for (let k = items.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [items[k], items[j]] = [items[j], items[k]]; }
    for (const d of items) {
      let z = b;
      for (const [k, v] of d.f) z += (w.get(k) || 0) * v;
      const p = 1 / (1 + Math.exp(-z));
      const err = (p - d.y) * d.cw;
      for (const [k, v] of d.f) {
        const gg = (g2.get(k) || 0) + (err * v) ** 2;
        g2.set(k, gg);
        w.set(k, (w.get(k) || 0) - (lr0 * (err * v + l2 * (w.get(k) || 0))) / Math.sqrt(gg + 1e-8));
      }
      gb2 += err * err;
      b -= (lr0 * err) / Math.sqrt(gb2 + 1e-8);
    }
  }
  return { w, b, score: (vec) => { let z = b; for (const [k, v] of vec.v) { const wk = w.get(k); if (wk) z += wk * (v / vec.norm); } return z; } };
}
const docs = [...POSV.map((vec) => ({ vec, y: 1 })), ...NEGV.map((vec) => ({ vec, y: 0 }))];
const MODEL = trainLR(docs);
const knn5 = (vec) => { const s = scoreAll(refIdx, vec.v, vec.norm); const t = topK(s, 5, null); return t.reduce((a, b) => a + b[1], 0) / (t.length || 1); };
const lenOf = (t) => t.replace(/[^A-Za-z0-9]/g, '').length;

// --- selector evaluation ---
function evaluate(name, picks) {
  const tp = picks.filter((p) => GT.has(p.id)).length;
  const P = tp / picks.length, R = tp / GT.size;
  const [lo, hi] = wilson(tp, picks.length);
  console.log(`${name.padEnd(16)} picks ${String(picks.length).padStart(2)}  hit ${String(tp).padStart(2)}  P=${pc(P).padStart(6)} [${pc(lo, 0)}-${pc(hi, 0)}]  R=${pc(R).padStart(6)}  F1=${(2 * P * R / (P + R) || 0).toFixed(3)}`);
  return { name, picks: picks.length, tp, P, R };
}
console.log('\n=== selectors, same ground truth (37), same pool (380) ===');
const rows = [];
rows.push(evaluate('agent (blog 15)', AGENT15.map(([id, title]) => ({ id, title }))));
rows.push(evaluate('LR title-only', [...CANDV].sort((a, b) => MODEL.score(b.vec) - MODEL.score(a.vec)).slice(0, 15)));
rows.push(evaluate('kNN5 title-only', [...CANDV].sort((a, b) => knn5(b.vec) - knn5(a.vec)).slice(0, 15)));
rows.push(evaluate('shortest-15', [...CANDV].sort((a, b) => lenOf(a.title) - lenOf(b.title)).slice(0, 15)));
rows.push(evaluate('longest-15 (control)', [...CANDV].sort((a, b) => lenOf(b.title) - lenOf(a.title)).slice(0, 15)));
let rndHits = 0;
for (let i = 0; i < 400; i++) {
  const idx = Array.from({ length: CANDV.length }, (_, j) => j);
  for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
  rndHits += idx.slice(0, 15).filter((j) => GT.has(CANDV[j].id)).length;
}
const rp = rndHits / 400 / 15;
console.log(`${'random-15 (x400)'.padEnd(16)} picks 15  hit ${(rndHits / 400).toFixed(2)}  P=${pc(rp).padStart(6)}            R=${pc(15 * rp / GT.size).padStart(6)}`);

// --- where does the model rank the agent's own picks? ---
const scored = CANDV.map((c) => ({ ...c, lr: MODEL.score(c.vec) })).sort((a, b) => b.lr - a.lr);
const rankOf = new Map(scored.map((c, i) => [c.id, i + 1]));
const agentRanks = AGENT15.map(([id]) => rankOf.get(id) ?? null);
console.log(`\nrank of the agent's 15 picks inside my LR ordering (1 = my top pick; pool is 380):`);
console.log('  ' + agentRanks.map((r) => r ?? 'n/a').join(', ') + `   median=${agentRanks.filter(Boolean).sort((a, b) => a - b)[Math.floor(agentRanks.filter(Boolean).length / 2)]}`);

console.log('\nmy LR top-15:');
scored.slice(0, 15).forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${GT.has(c.id) ? 'HIT ' : '    '}${c.title.slice(0, 78)}`));
console.log('\nof the 37 he kept, my LR puts these in its top-15 / ranks them:');
gtPapers.map((p) => ({ id: idOf(p.url), title: p.title, r: rankOf.get(idOf(p.url)) })).sort((a, b) => (a.r ?? 999) - (b.r ?? 999)).forEach((x) => console.log(`  rank ${String(x.r ?? 'n/a').padStart(3)}  ${x.title.slice(0, 74)}`));

fs.writeFileSync(path.join(HERE, 'replay-results.json'), JSON.stringify({ GT: GT.size, pool: cand.length, rows, agentRanks, top15: scored.slice(0, 15).map((c) => c.title) }, null, 2));
console.log('\nwrote replay-results.json');
