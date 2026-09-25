// audit.mjs — self-audit of my own question construction.
// Q: did the L2 (nearest-neighbour) distractor selection accidentally bias the title-length cue?
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const len = (t) => t.replace(/[^A-Za-z0-9]/g, '').length;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const rows = { L0: { pos: [], neg: [] }, L2: { pos: [], neg: [] } };
for (const dir of ['regen1', 'regen777']) {
  const k = JSON.parse(fs.readFileSync(path.join(HERE, dir, 'key.json'), 'utf8'));
  for (const [lvl, tkey, kkey] of [['L0', 'titlesA', 'levelA'], ['L2', 'titlesB', 'levelB']]) {
    k[tkey].forEach((opts, i) => {
      const ci = 'ABCD'.indexOf(k[kkey][i]);
      opts.forEach((t, j) => { if (t === opts[ci]) rows[lvl].pos.push(len(t)); else rows[lvl].neg.push(len(t)); });
    });
  }
}
for (const lvl of ['L0', 'L2']) {
  const p = rows[lvl].pos, n = rows[lvl].neg;
  const shareShorter = n.filter((x) => x > q(p, 0.5)).length / n.length;
  console.log(`${lvl}: correct-title length  mean=${(p.reduce((a, b) => a + b, 0) / p.length).toFixed(1)} median=${q(p, 0.5)}   distractor length mean=${(n.reduce((a, b) => a + b, 0) / n.length).toFixed(1)} median=${q(n, 0.5)}`);
}
const gap0 = rows.L0.neg.reduce((a, b) => a + b, 0) / rows.L0.neg.length - rows.L0.pos.reduce((a, b) => a + b, 0) / rows.L0.pos.length;
const gap2 = rows.L2.neg.reduce((a, b) => a + b, 0) / rows.L2.neg.length - rows.L2.pos.reduce((a, b) => a + b, 0) / rows.L2.pos.length;
console.log(`\ndistractor-minus-correct length gap:  L0 = ${gap0.toFixed(1)} chars   L2 = ${gap2.toFixed(1)} chars   (delta ${(gap2 - gap0).toFixed(1)})`);
console.log(gap2 > gap0
  ? `=> the L2 selection did widen the gap, but by ${(gap2 - gap0).toFixed(1)} of ${gap0.toFixed(1)} chars: the length cue is mostly the data's, not the construction's.`
  : '=> the L2 selection did not widen the length gap.');
