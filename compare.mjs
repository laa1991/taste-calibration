// compare.mjs — put the blind LLM and the local players on EXACTLY the same questions.
//
// The two question sets were regenerated deterministically (regen1 = seed 20260925,
// regen777 = seed 777) and their answer keys were verified to match the sheets the LLM
// actually answered. Everything used as a question option is excluded from every player's
// training set, so no player ever sees a test item.
//
// Usage: node compare.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, extractGrams, fitIdf, toVec, makeIndex, scoreAll, topK, wilson, pc } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rnd = mulberry32(4242);

const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'));
const dist = JSON.parse(fs.readFileSync(path.join(HERE, 'distractors.json'), 'utf8'));
const POS = papers.filter((p) => p.source === 'arxiv' && p.title).map((p) => p.title);
const NEG = dist.map((d) => d.title);

const SETS = [
  { dir: 'regen1', tag: 'set1', ansA: 'ans-A.txt', ansB: 'ans-B.txt' },
  { dir: 'regen777', tag: 'set2', ansA: 'ans-A2.txt', ansB: 'ans-B2.txt' },
  // sets 3 and 4 exist to give the OFFLINE players more than one sample (ticket item 5).
  // No LLM answer sheets for them: the LLM row reports its own n — it is not padded, and it is
  // not counted wrong on questions it never saw.
  { dir: 'regen111', tag: 'set3', ansA: null, ansB: null },
  { dir: 'regen222', tag: 'set4', ansA: null, ansB: null },
];

const parseSheet = (f) => {
  const out = [];
  for (const line of fs.readFileSync(path.join(HERE, f), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*Q\s*(\d+)\s*[:.=)\-]\s*([ABCD])\s*$/i);
    if (m) out[Number(m[1]) - 1] = m[2].toUpperCase();
  }
  return out;
};

// ---- collect every question, and everything that was ever shown as an option ----
const shown = new Set();
const questions = { A: [], B: [] };
for (const s of SETS) {
  const key = JSON.parse(fs.readFileSync(path.join(HERE, s.dir, 'key.json'), 'utf8'));
  for (const [lvl, tkey, kkey, sheet] of [['A', 'titlesA', 'levelA', s.ansA], ['B', 'titlesB', 'levelB', s.ansB]]) {
    const ans = sheet ? parseSheet(sheet) : null;
    key[tkey].forEach((opts, i) => {
      const correct = 'ABCD'.indexOf(key[kkey][i]);
      opts.forEach((t) => shown.add(t));
      questions[lvl].push({ tag: s.tag, opts, correct, llm: ans && ans[i] ? 'ABCD'.indexOf(ans[i]) : -1 });
    });
  }
}
console.log(`questions: L0=${questions.A.length}  L2=${questions.B.length}   distinct titles shown: ${shown.size}`);

// ---- training pools: exclude everything that was shown ----
const POS_TR = POS.filter((t) => !shown.has(t));
const NEG_TR = NEG.filter((t) => !shown.has(t));
console.log(`train positives = ${POS_TR.length}/${POS.length}   train negatives = ${NEG_TR.length}/${NEG.length}`);

const g = (t) => extractGrams(t);
const idf = fitIdf([...POS_TR.map(g), ...NEG_TR.map(g)]);
const POSV = POS_TR.map((t) => ({ t, vec: toVec(g(t), idf) }));
const NEGV = NEG_TR.map((t) => ({ t, vec: toVec(g(t), idf) }));
const refIdx = makeIndex(POSV.map((p) => p.vec));
const QV = {};
for (const lvl of ['A', 'B']) for (const q of questions[lvl]) for (const t of q.opts) if (!QV[t]) QV[t] = toVec(g(t), idf);

// ---- LR ----
function trainLR(epochs = 25, lr0 = 0.4, l2 = 2e-6) {
  const n = POSV.length + NEGV.length;
  const wp = n / (2 * POSV.length), wn = n / (2 * NEGV.length);
  const items = [
    ...POSV.map((p) => ({ f: [...p.vec.v].map(([k, v]) => [k, v / p.vec.norm]), y: 1, cw: wp })),
    ...NEGV.map((p) => ({ f: [...p.vec.v].map(([k, v]) => [k, v / p.vec.norm]), y: 0, cw: wn })),
  ];
  const w = new Map(), g2 = new Map();
  let b = 0, gb2 = 0;
  for (let ep = 0; ep < epochs; ep++) {
    for (let k = items.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [items[k], items[j]] = [items[j], items[k]]; }
    for (const d of items) {
      let z = b;
      for (const [k, v] of d.f) z += (w.get(k) || 0) * v;
      const err = (1 / (1 + Math.exp(-z)) - d.y) * d.cw;
      for (const [k, v] of d.f) {
        const gg = (g2.get(k) || 0) + (err * v) ** 2;
        g2.set(k, gg);
        w.set(k, (w.get(k) || 0) - (lr0 * (err * v + l2 * (w.get(k) || 0))) / Math.sqrt(gg + 1e-8));
      }
      gb2 += err * err;
      b -= (lr0 * err) / Math.sqrt(gb2 + 1e-8);
    }
  }
  return (vec) => { let z = b; for (const [k, v] of vec.v) { const wk = w.get(k); if (wk) z += wk * (v / vec.norm); } return z; };
}
const scoreLR = trainLR();
const knn5 = (vec) => { const s = scoreAll(refIdx, vec.v, vec.norm); const t = topK(s, 5, null); return t.reduce((a, b) => a + b[1], 0) / (t.length || 1); };
const lenOf = (t) => t.replace(/[^A-Za-z0-9]/g, '').length;

const PLAYERS = {
  'random': (q) => Math.floor(rnd() * 4),
  'shortest': (q) => { let b = 0; q.opts.forEach((t, i) => { if (lenOf(t) < lenOf(q.opts[b])) b = i; }); return b; },
  'kNN5': (q) => { let b = 0, bs = -Infinity; q.opts.forEach((t, i) => { const s = knn5(QV[t]); if (s > bs) { bs = s; b = i; } }); return b; },
  'LR': (q) => { let b = 0, bs = -Infinity; q.opts.forEach((t, i) => { const s = scoreLR(QV[t]); if (s > bs) { bs = s; b = i; } }); return b; },
  'LLM blind': (q) => q.llm,
};
const names = Object.keys(PLAYERS);
const levels = [['A', 'L0 (game-like)'], ['B', 'L2 (topically matched)']];
console.log('\n=== same questions for everybody — accuracy (chance 25%) ===');
console.log('player        ' + levels.map(([, n]) => n.padEnd(24)).join(''));
const summary = {};
for (const p of names) {
  const cells = levels.map(([lvl]) => {
    // a player is only scored on questions it actually answered (the LLM has sheets for 2 of the 4 sets)
    const qs = questions[lvl].filter((q) => PLAYERS[p](q) >= 0);
    const hit = qs.filter((q) => PLAYERS[p](q) === q.correct).length;
    const [lo, hi] = wilson(hit, qs.length);
    summary[`${p}|${lvl}`] = { hit, n: qs.length };
    return `${hit}/${qs.length} = ${pc(hit / qs.length).padStart(6)} [${pc(lo, 0)}-${pc(hi, 0)}]`.padEnd(24);
  });
  console.log(p.padEnd(14) + cells.join(''));
}

// per-set breakdown = the replication check, now over every set (ticket item 5)
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log('\n=== per question-set, and the spread across sets (this is the honest error bar) ===');
for (const p of names) {
  for (const [lvl, label] of levels) {
    const rates = [];
    const parts = SETS.map((s) => {
      const qs = questions[lvl].filter((q) => q.tag === s.tag).filter((q) => PLAYERS[p](q) >= 0);
      if (!qs.length) return `${s.tag} —`;
      const hit = qs.filter((q) => PLAYERS[p](q) === q.correct).length;
      rates.push(hit / qs.length);
      return `${s.tag} ${hit}/${qs.length}`;
    });
    const med = median(rates);
    console.log(`${p.padEnd(11)} ${label.split(' ')[0]}  ${parts.join('  ')}   median ${pc(med)} [${pc(Math.min(...rates))}–${pc(Math.max(...rates))}]  (${rates.length} sample${rates.length > 1 ? 's' : ''})`);
  }
}

// the examples condition (L2, set 1 only)
const qsC = questions.B.filter((q) => q.tag === 'set1');
const ansC = parseSheet('ans-C.txt');
const hitC = qsC.filter((q, i) => 'ABCD'.indexOf(ansC[i]) === q.correct).length;
console.log(`\nLLM blind+examples on the SAME L2/set1 questions: ${hitC}/${qsC.length} = ${pc(hitC / qsC.length)}  (blind on those same questions: ${qsC.filter((q) => q.llm === q.correct).length}/${qsC.length})`);

fs.writeFileSync(path.join(HERE, 'compare-results.json'), JSON.stringify(summary, null, 2));
console.log('\nwrote compare-results.json');
