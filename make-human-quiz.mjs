// make-human-quiz.mjs — build human-baseline.html: the same 60 questions, for people.
//
// Ticket item 1. No agent can produce a human baseline, so the deliverable is the instrument:
// one self-contained HTML file (works from file://, no server, no network), 60 questions in a
// fixed shuffled order, one score line at the end to paste back.
//
// Design choices that matter for validity:
//   * questions from both levels and both sets are interleaved in one shuffled sequence,
//     so a person cannot adopt different strategies for the "easy" and "hard" blocks;
//   * NO feedback until the end — the public game reveals each answer immediately, which
//     teaches the player the answer key as they go;
//   * per-question time is recorded, so "answered in 1.2 s" can be separated from "thought about it".
//
// Usage: node make-human-quiz.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mulberry32 } from './taste-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const rnd = mulberry32(20260925)
const CORE = process.argv.includes('--core') // --core: set 1 only (60 questions, ~8 minutes)

const items = []
for (const [set, dir] of [['set1', 'regen1'], ['set2', 'regen777']]) {
  if (CORE && set !== 'set1') continue
  const key = JSON.parse(fs.readFileSync(path.join(HERE, dir, 'key.json'), 'utf8'))
  for (const [level, tkey, kkey] of [['L0', 'titlesA', 'levelA'], ['L2', 'titlesB', 'levelB']]) {
    key[tkey].forEach((opts, i) => {
      items.push({ set, level, q: i + 1, opts: opts.map((t) => t.replace(/\s+/g, ' ').trim()), correct: 'ABCD'.indexOf(key[kkey][i]) })
    })
  }
}
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]] }
console.log(`built ${items.length} questions · L0 ${items.filter((x) => x.level === 'L0').length} · L2 ${items.filter((x) => x.level === 'L2').length}`)
if (items.some((x) => x.opts.length !== 4 || !(x.correct >= 0 && x.correct < 4))) { console.error('bad item shape'); process.exit(3) }

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guess the kept paper — human baseline</title>
<style>
  :root { --ink:#111; --dim:#666; --line:#d8d8d8; --ok:#0a7d3a; --bad:#b3261e; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; color:var(--ink); background:#fafafa; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 80px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: var(--dim); font-size: 14px; margin-bottom: 22px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:20px; }
  .bar { height:6px; background:#eee; border-radius:99px; overflow:hidden; margin-bottom:18px; }
  .bar > i { display:block; height:100%; background:#111; width:0; transition:width .18s; }
  .meta { display:flex; justify-content:space-between; color:var(--dim); font-size:13px; margin-bottom:14px; }
  button.opt { display:block; width:100%; text-align:left; margin:8px 0; padding:12px 14px; font:inherit; color:inherit;
    background:#fff; border:1px solid var(--line); border-radius:9px; cursor:pointer; }
  button.opt:hover { border-color:#999; }
  button.opt b { display:inline-block; width:1.4em; color:var(--dim); }
  .btn { font:inherit; padding:10px 18px; border-radius:9px; border:1px solid #111; background:#111; color:#fff; cursor:pointer; }
  .btn.ghost { background:#fff; color:#111; border-color:var(--line); }
  .result { font-size:15px; }
  .result table { border-collapse: collapse; margin: 12px 0; }
  .result td, .result th { border-bottom:1px solid var(--line); padding:6px 14px 6px 0; text-align:left; font-weight:400; }
  textarea { width:100%; height:76px; font:13px/1.4 ui-monospace,Menlo,Consolas,monospace; margin-top:10px;
    border:1px solid var(--line); border-radius:8px; padding:10px; }
  .hint { color:var(--dim); font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Guess which paper was kept</h1>
  <p class="sub">${items.length} questions (~${Math.round((items.length * 8) / 60)} min). Each shows four arXiv titles; exactly one is in a researcher's personal collection.
  <b>No feedback until the end</b> — answer by gut. You can stop any time with the button in the corner and still get a score.
  Human baseline for <code>taste-calibration</code>.</p>
  <div class="card" id="card"></div>
</div>
<script>
const ITEMS = ${JSON.stringify(items)};
const LETTERS = ['A','B','C','D'];
let i = 0, answers = [], t0 = 0, times = [];

const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d; };
const card = document.getElementById('card');

function start() { i = 0; answers = []; times = []; render(); }

function render() {
  if (i >= ITEMS.length) return results();
  const it = ITEMS[i];
  t0 = performance.now();
  const pct = Math.round((i / ITEMS.length) * 100);
  card.innerHTML =
    '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="meta"><span>Question ' + (i + 1) + ' of ' + ITEMS.length + '</span>' +
    '<span><button class="btn ghost" style="padding:4px 10px;font-size:13px" onclick="results()">stop &amp; score</button></span></div>' +
    '<div id="opts"></div>';
  const box = card.querySelector('#opts');
  it.opts.forEach((t, k) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = '<b>' + LETTERS[k] + '</b>' + t.replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    b.onclick = () => { answers[i] = k; times[i] = (performance.now() - t0) / 1000; i++; render(); };
    box.appendChild(b);
  });
}

function wilson(hit, n) {
  if (!n) return [0, 0];
  const p = hit / n, z = 1.959963984540054, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}
function pct(x) { return (100 * x).toFixed(1) + '%'; }

function results() {
  const by = {};
  let hit = 0, done = 0;
  ITEMS.forEach((it, k) => {
    if (answers[k] === undefined) return;   // not answered — excluded, not counted wrong
    done++;
    const ok = answers[k] === it.correct;
    if (ok) hit++;
    const b = by[it.level] = by[it.level] || { hit: 0, n: 0 };
    b.n++; if (ok) b.hit++;
  });
  if (!done) { card.innerHTML = '<p class="hint">Nothing answered yet.</p><p><button class="btn ghost" onclick="start()">Start over</button></p>'; return; }
  const answeredTimes = times.filter((t) => typeof t === 'number');
  const sorted = [...answeredTimes].sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  let rows = '';
  for (const lv of Object.keys(by).sort()) {
    const b = by[lv], w = wilson(b.hit, b.n);
    rows += '<tr><td>' + lv + '</td><td>' + b.hit + '/' + b.n + '</td><td>' + pct(b.hit / b.n) + '</td><td>[' + pct(w[0]) + ' – ' + pct(w[1]) + ']</td></tr>';
  }
  const w = wilson(hit, done);
  const line = 'TASTE-QUIZ v1 | overall ' + hit + '/' + done + ' (' + pct(hit / done) + ') | '
    + Object.keys(by).sort().map((lv) => lv + ' ' + by[lv].hit + '/' + by[lv].n).join(' | ')
    + ' | median ' + med.toFixed(1) + 's | name=';
  card.innerHTML =
    '<div class="result"><h2 style="font-size:18px;margin:0 0 4px">Done — ' + hit + ' / ' + done + '</h2>' +
    '<p class="hint">chance is 25%. A single person is a data point, not a baseline — three to five make the row real.</p>' +
    '<table><tr><th>level</th><th>correct</th><th>rate</th><th>95% interval</th></tr>' + rows + '</table>' +
    '<p class="hint">overall ' + hit + '/' + done + ' = ' + pct(hit / done) + ' &nbsp;[' + pct(w[0]) + ' – ' + pct(w[1]) + ']' +
    (done < ITEMS.length ? '<br><b>Stopped early</b> — ' + (ITEMS.length - done) + ' questions unanswered. Report the n: it is comparable only on the questions actually answered.' : '') + '</p>' +
    '<p class="hint">Paste this line back (add your name or a handle):</p>' +
    '<textarea id="linebox" readonly>' + line + '</textarea>' +
    '<p><button class="btn" onclick="copyLine()">Copy score line</button> <button class="btn ghost" onclick="start()">Play again</button></p></div>';
  const box = document.getElementById('linebox');
  box.focus(); box.select();
}
function copyLine() {
  const box = document.getElementById('linebox');
  box.select(); try { document.execCommand('copy'); } catch (e) {}
  navigator.clipboard && navigator.clipboard.writeText(box.value).catch(() => {});
}
start();
</script>
</body>
</html>
`

const OUT = path.join(HERE, CORE ? 'human-baseline-core.html' : 'human-baseline.html')
fs.writeFileSync(OUT, HTML)
console.log(`wrote ${path.basename(OUT)} (${HTML.length} bytes, ${items.length} questions embedded)`)
console.log(`fingerprint of the order: ${items.map((x) => x.level + 's' + x.set.slice(-1)).join(' ')}`)

// round-trip: pull the questionnaire back out of the written file and re-check it
const back = fs.readFileSync(OUT, 'utf8')
const m = back.match(/const ITEMS = (\[.*?\]);\n/s)
if (!m) { console.error('SELF-CHECK FAILED: cannot find the embedded item list'); process.exit(4) }
const parsed = JSON.parse(m[1])
const bad = parsed.filter((x) => !x.opts || x.opts.length !== 4 || !(x.correct >= 0 && x.correct < 4) || !x.level)
console.log(`self-check: ${parsed.length} items round-tripped · malformed ${bad.length} · distinct levels ${[...new Set(parsed.map((x) => x.level))].join('/')}`)
const net = back.match(/https?:\/\//g)
console.log(`self-check: external URLs in the file = ${net ? net.length : 0} ${net ? '(must be 0 for a file:// quiz)' : ''}`)
const sb = back.match(/<script>([\s\S]*)<\/script>/)
let jsOk = false
try { new Function(sb[1]); jsOk = true } catch (e) { console.error(`self-check: the emitted script does NOT parse — ${e.message}`) }
console.log(`self-check: emitted script parses = ${jsOk}`)
if (bad.length || parsed.length !== items.length || net || !jsOk) process.exit(5)
