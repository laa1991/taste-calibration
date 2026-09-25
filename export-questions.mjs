// export-questions.mjs — freeze one question set so an LLM can be asked the SAME questions
// the local players were asked. Paired design: the same 30 test positives appear at L0 and L2.
//
// Writes:  qA.txt (L0, 30 questions)   qB.txt (L2, 30 questions)   key.json   examples.txt
// Usage:   node export-questions.mjs [N_Q] [SEED]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, extractGrams, fitIdf, toVec, makeIndex, scoreAll, topK } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const N_Q = Number(process.argv[2] || 30);
const SEED = Number(process.argv[3] || 20260925);
const SUB = process.argv[4] || '';
const OUT = SUB ? path.join(HERE, SUB) : HERE;
if (SUB) fs.mkdirSync(OUT, { recursive: true });

const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'));
const dist = JSON.parse(fs.readFileSync(path.join(HERE, 'distractors.json'), 'utf8'));
const vintage = (s) => { const m = String(s).match(/(\d{2})(\d{2})\.\d{4,5}/); return m ? 2000 + Number(m[1]) + '-' + m[2] : 'NA'; };
const POS = papers.filter((p) => p.source === 'arxiv' && p.title).map((p) => ({ title: p.title, v: vintage(p.url) }));
const NEG = dist.filter((d) => d.title).map((d) => ({ title: d.title, v: vintage(d.arxiv_id || d.url) }));

const rnd = mulberry32(SEED);
const shuffled = (n) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

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

const posG = POS.map((d) => extractGrams(d.title));
const negG = NEG.map((d) => extractGrams(d.title));
const idf = fitIdf([...POS_TR.map((i) => posG[i]), ...[...NEG_TR].map((i) => negG[i])]);
const posVec = posG.map((g) => toVec(g, idf));
const negVec = negG.map((g) => toVec(g, idf));
const negIdxAll = makeIndex(NEG_TE.map((i) => negVec[i]));

// 30 test positives, all August-2026 (vintage-matched against the distractor pool)
const testPos = shuffled(augAll.length).map((k) => augAll[k]).slice(0, N_Q);

const mkQuestion = (pi, level) => {
  let ds;
  if (level === 0) {
    const src = NEG_TE; // same as ladder.mjs L0: random distractors from the whole pool
    const used = new Set();
    ds = [];
    let guard = 0;
    while (ds.length < 3 && guard++ < 5000) { const i = src[Math.floor(rnd() * src.length)]; if (used.has(i)) continue; used.add(i); ds.push(i); }
  } else {
    const s = scoreAll(negIdxAll, posVec[pi].v, posVec[pi].norm);
    ds = topK(s, 3, null).map(([j]) => NEG_TE[j]);
  }
  const opts = [{ pos: true, t: POS[pi].title }, ...ds.map((i) => ({ pos: false, t: NEG[i].title }))];
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  const key = opts.findIndex((o) => o.pos);
  return { opts, key, pi };
};

const render = (qs) => qs.map((q, n) => [
  `Q${n + 1}.`,
  ...q.opts.map((o, i) => `  (${'ABCD'[i]}) ${o.t.replace(/\s+/g, ' ').trim()}`),
].join('\n')).join('\n\n');

const qsA = testPos.map((pi) => mkQuestion(pi, 0));
const qsB = testPos.map((pi) => mkQuestion(pi, 2));

const HEAD_A = `Below are ${N_Q} independent questions. Each shows four arXiv paper titles. Exactly ONE of the four is a paper that a particular machine-learning researcher personally chose to keep in a private collection of papers they found interesting. The other three are random recent cs.LG papers that they did NOT keep.

For each question, say which letter you think is the kept one. Answer with your gut — no need to justify.

Output format (exactly this, ${N_Q} lines, nothing else):
Q1: B
Q2: D
...

Questions:

`;
const HEAD_B = HEAD_A.replace('Each shows four arXiv paper titles.', 'Each shows four arXiv paper titles drawn from the SAME narrow topic, so the choice is close.');

fs.writeFileSync(path.join(OUT, 'qA.txt'), HEAD_A + render(qsA) + '\n');
fs.writeFileSync(path.join(OUT, 'qB.txt'), HEAD_B + render(qsB) + '\n');

// few-shot examples for the third condition: 10 kept / 10 NOT kept.
// Kept: August-2026 positives that are NOT among the 30 test items.
// Not kept: negatives from the TRAIN half (so no example can also appear as a test distractor).
const usedAsTest = new Set(testPos);
const exPos = POS_TE.filter((i) => POS[i].v === '2026-08' && !usedAsTest.has(i)).slice(0, 10).map((i) => POS[i].title.replace(/\s+/g, ' ').trim());
const exNeg = [...NEG_TR].slice(0, 10).map((i) => NEG[i].title.replace(/\s+/g, ' ').trim());
fs.writeFileSync(path.join(OUT, 'examples.txt'),
  `Papers the researcher KEPT:\n` + exPos.map((t) => `  - ${t}`).join('\n') +
  `\n\nPapers the researcher was shown and did NOT keep:\n` + exNeg.map((t) => `  - ${t}`).join('\n') + '\n');

fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify({
  seed: SEED, n: N_Q,
  levelA: qsA.map((q) => 'ABCD'[q.key]),
  levelB: qsB.map((q) => 'ABCD'[q.key]),
  titlesA: qsA.map((q) => q.opts.map((o) => o.t)),
  titlesB: qsB.map((q) => q.opts.map((o) => o.t)),
}, null, 2));

console.log(`wrote qA.txt / qB.txt / examples.txt / key.json  (${N_Q} questions, key A=${qsA.map((q) => 'ABCD'[q.key]).join('')})`);
console.log(`key B=${qsB.map((q) => 'ABCD'[q.key]).join('')}`);
