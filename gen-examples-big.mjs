// gen-examples-big.mjs — 100 kept / 100 not-kept examples, excluding every title that appears
// as an option in either question set (no leakage into the 60 questions).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rnd = mulberry32(99);
const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'));
const dist = JSON.parse(fs.readFileSync(path.join(HERE, 'distractors.json'), 'utf8'));
const POS = papers.filter((p) => p.source === 'arxiv' && p.title).map((p) => p.title);
const NEG = dist.map((d) => d.title);

const shown = new Set();
for (const dir of ['regen1', 'regen777']) {
  const k = JSON.parse(fs.readFileSync(path.join(HERE, dir, 'key.json'), 'utf8'));
  [...k.titlesA, ...k.titlesB].forEach((opts) => opts.forEach((t) => shown.add(t)));
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const keep = shuffle(POS.filter((t) => !shown.has(t))).slice(0, 100);
const drop = shuffle(NEG.filter((t) => !shown.has(t))).slice(0, 100);
console.log(`available: positives ${POS.filter((t) => !shown.has(t)).length}, negatives ${NEG.filter((t) => !shown.has(t)).length}`);
console.log(`wrote 100 kept + 100 not-kept; overlap with anything shown = ${keep.filter((t) => shown.has(t)).length + drop.filter((t) => shown.has(t)).length}`);

fs.writeFileSync(path.join(HERE, 'examples-big.txt'),
  `A researcher's personal arXiv paper collection. Below are 100 papers they KEPT, and 100 papers from the same period that they were shown and did NOT keep.\n\n== KEPT (100) ==\n` +
  keep.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ').trim()}`).join('\n') +
  `\n\n== NOT KEPT (100) ==\n` +
  drop.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ').trim()}`).join('\n') + '\n');
console.log('wrote examples-big.txt');
