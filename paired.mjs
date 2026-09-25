// paired.mjs — dose-response on the SAME 30 questions (L2 set 1):
//   ans-B.txt  = blind            (0 examples)
//   ans-C.txt  = 10 kept + 10 not (20 examples)
//   ans-D.txt  = 100 kept + 100 not (200 examples)
// Reports accuracy + exact McNemar between consecutive arms.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson, pc } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const key = JSON.parse(fs.readFileSync(path.join(HERE, 'regen1', 'key.json'), 'utf8')).levelB.join('');
const parse = (f) => {
  const out = [];
  for (const line of fs.readFileSync(path.join(HERE, f), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*Q\s*(\d+)\s*[:.=)\-]\s*([ABCD])\s*$/i);
    if (m) out[Number(m[1]) - 1] = m[2].toUpperCase();
  }
  return out;
};
const arms = [['blind (0 ex)', 'ans-B.txt'], ['20 examples', 'ans-C.txt'], ['200 examples', 'ans-D.txt']];
const res = arms.map(([name, f]) => {
  const a = parse(f);
  const hit = a.map((x, i) => (x === key[i] ? 1 : 0));
  const [lo, hi] = wilson(hit.reduce((x, y) => x + y, 0), key.length);
  return { name, hit, n: hit.length, c: hit.reduce((x, y) => x + y, 0), lo, hi };
});
res.forEach((r) => console.log(`${r.name.padEnd(16)} ${String(r.c).padStart(2)}/${r.n} = ${pc(r.c / r.n).padStart(6)}  [${pc(r.lo, 0)}-${pc(r.hi, 0)}]`));

const binom2 = (b, c) => { // exact two-sided McNemar (n=b+c)
  const n = b + c;
  if (!n) return 1;
  let p = 0;
  for (let k = 0; k <= n; k++) {
    let c0 = 1;
    for (let i = 0; i < k; i++) c0 = (c0 * (n - i)) / (i + 1);
    p += c0 * Math.pow(0.5, n);
    if (k >= Math.max(b, c) && p >= 1) break;
  }
  let tail = 0;
  for (let k = 0; k <= Math.min(b, c); k++) {
    let c0 = 1;
    for (let i = 0; i < k; i++) c0 = (c0 * (n - i)) / (i + 1);
    tail += c0 * Math.pow(0.5, n);
  }
  return Math.min(1, 2 * tail);
};
for (let i = 1; i < res.length; i++) {
  const a = res[i - 1].hit, b = res[i].hit;
  let gain = 0, loss = 0;
  for (let k = 0; k < key.length; k++) { if (!a[k] && b[k]) gain++; if (a[k] && !b[k]) loss++; }
  console.log(`${res[i - 1].name} -> ${res[i].name}:  gained ${gain}, lost ${loss}, net ${gain - loss}, McNemar exact p=${binom2(gain, loss).toFixed(3)}`);
}
console.log('\nper-question pattern (1=right) — blind / +20 / +200:');
console.log('  ' + key.split('').map((_, i) => i + 1).join('').match(/.{1,10}/g).join(' '));
res.forEach((r) => console.log('  ' + r.hit.join('').match(/.{1,10}/g).join(' ') + '   ' + r.name));
