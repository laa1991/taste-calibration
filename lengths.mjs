// lengths.mjs — how different are the two pools on the single dumbest feature (title length)?
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'));
const dist = JSON.parse(fs.readFileSync(path.join(HERE, 'distractors.json'), 'utf8'));
const vintage = (s) => { const m = String(s).match(/(\d{2})(\d{2})\.\d{4,5}/); return m ? 2000 + Number(m[1]) + '-' + m[2] : 'NA'; };
const len = (t) => t.replace(/[^A-Za-z0-9]/g, '').length;

const hisAll = papers.filter((p) => p.source === 'arxiv' && p.title).map((p) => p.title);
const hisAug = papers.filter((p) => p.source === 'arxiv' && p.title && vintage(p.url) === '2026-08').map((p) => p.title);
const dAll = dist.map((d) => d.title);
const dAug = dist.filter((d) => vintage(d.arxiv_id || d.url) === '2026-08').map((d) => d.title);

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const show = (name, arr) => {
  const L = arr.map(len);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  console.log(`${name.padEnd(28)} n=${String(arr.length).padStart(4)}  mean=${mean.toFixed(1).padStart(5)}  median=${String(q(L, 0.5)).padStart(3)}  p10=${String(q(L, 0.1)).padStart(3)}  p90=${String(q(L, 0.9)).padStart(3)}`);
  return L;
};
console.log('title length in alphanumeric characters:');
const LA = show('his collection (all)', hisAll);
const LAug = show('his collection (2026-08)', hisAug);
const LD = show('distractors (all)', dAll);
const LDaug = show('distractors (2026-08)', dAug);

// mechanical prediction: if you always pick the shortest of 4 (1 positive + 3 random distractors),
// you win when all 3 distractors happen to be longer than the positive.
const pLonger = (pos, neg) => {
  let hp = 0, tot = 0;
  for (const p of pos) { const lp = len(p); const share = neg.filter((t) => len(t) > lp).length / neg.length; hp += share ** 3; tot++; }
  return hp / tot;
};
console.log(`\npredicted accuracy of "the shortest title wins" (1 pos + 3 random distractors):`);
console.log(`  his 2026-08 vs distractors 2026-08 : ${(100 * pLonger(hisAug, dAug)).toFixed(1)}%`);
console.log(`  his all      vs distractors all     : ${(100 * pLonger(hisAll, dAll)).toFixed(1)}%`);
