// score.mjs — score an LLM answer sheet against a shipped answer key.
//
// Keys live next to the question sets: questions/regen1/key.json (set 1) and
// questions/regen777/key.json (set 2). Which key a sheet belongs to is inferred from its
// filename (sheets ending in "2" are set 2), or given explicitly as a third field.
//
// Usage: node score.mjs ans-A.txt:levelA ans-B.txt:levelB
//        node score.mjs ans-A.txt:levelA:regen777/key.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson, pc } from './taste-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIRS = ['regen1', 'regen777'];
const FILES = {};
for (const d of DIRS) {
  const dir = path.join(HERE, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (/^key.*\.json$/.test(f)) FILES[`${d}/${f}`] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
}
const defaultKey = (file) => (/-[A-Z]2\.txt$/.test(file) || file.includes('2')) ? 'regen777/key.json' : 'regen1/key.json';

for (const arg of process.argv.slice(2)) {
  const [file, which, keyFile] = arg.split(':');
  const kf = keyFile || defaultKey(file);
  const key = FILES[kf];
  if (!key) { console.log(`${file}: no such key file ${kf} (have: ${Object.keys(FILES).join(', ')})`); continue; }
  const raw = fs.readFileSync(path.join(HERE, file), 'utf8');
  const ans = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*Q\s*(\d+)\s*[:.=)\-]\s*([ABCD])\s*$/i);
    if (m) ans[Number(m[1]) - 1] = m[2].toUpperCase();
  }
  const keyStr = key[which].join ? key[which].join('') : key[which];
  const n = keyStr.length;
  const got = ans.filter(Boolean).length;
  let hit = 0;
  const wrong = [];
  for (let i = 0; i < n; i++) { if (ans[i] === keyStr[i]) hit++; else wrong.push(`Q${i + 1}:${ans[i] || '-'}\u2260${keyStr[i]}`); }
  const [lo, hi] = wilson(hit, n);
  console.log(`${file.padEnd(12)} [${kf.padEnd(19)}] vs ${which.padEnd(7)}  parsed ${String(got).padStart(2)}/${n}  correct ${String(hit).padStart(2)}/${n} = ${pc(hit / n)}  [${pc(lo, 0)}-${pc(hi, 0)}]`);
  console.log(`             misses: ${wrong.join(' ')}`);
}
console.log('\nkey files loaded: ' + Object.entries(FILES).map(([f, k]) => `${f}(seed ${k.seed})`).join('  '));
