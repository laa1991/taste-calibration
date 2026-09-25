// popularity.mjs — the sixth player: "what was hot that week?"
//
// Ticket item 2. The worry it addresses: a model that only predicts "what's popular this week"
// would look a lot like a model that learned taste. This builds a popularity selector from a
// public signal (Hugging Face daily papers' community upvotes), ranks the week's papers by that
// signal, takes the top 15, and puts it in the same table as everything else.
//
// It is a DIRTY baseline and the README says so: not every ML paper lands in that feed, and the
// feed is not restricted to cs.LG.
//
// Usage: node popularity.mjs [--refresh]
// Writes popularity-snapshot.json (the raw daily feeds, so the ranking is reproducible offline).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SNAP = path.join(HERE, 'popularity-snapshot.json')
const DATES = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']

const idOf = (s) => { const m = String(s).match(/(\d{4}\.\d{4,5})/); return m ? m[1] : null }

let snap
if (fs.existsSync(SNAP) && !process.argv.includes('--refresh')) {
  snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'))
  console.log(`using cached popularity-snapshot.json (${Object.keys(snap.days).length} days); --refresh to re-fetch`)
} else {
  snap = { source: 'https://huggingface.co/api/daily_papers?date=YYYY-MM-DD', fetched: new Date().toISOString(), days: {} }
  for (const d of DATES) {
    try {
      const r = await fetch(`https://huggingface.co/api/daily_papers?date=${d}`, { headers: { 'User-Agent': 'taste-calibration' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      snap.days[d] = j.map((x) => ({ id: x.paper?.id ?? null, title: x.title ?? x.paper?.title ?? '', upvotes: x.paper?.upvotes ?? 0 }))
      console.log(`  ${d}: ${snap.days[d].length} entries · top upvotes ${Math.max(0, ...snap.days[d].map((e) => e.upvotes))}`)
    } catch (e) {
      snap.days[d] = []
      console.log(`  ${d}: FETCH FAILED (${e.message}) — recorded as empty, not as zero`)
    }
  }
  fs.writeFileSync(SNAP, JSON.stringify(snap, null, 1))
  console.log(`wrote popularity-snapshot.json`)
}

// aggregate: one entry per arXiv id, keep the max upvotes seen
const byId = new Map()
let total = 0
for (const [d, list] of Object.entries(snap.days)) {
  for (const e of list) {
    total++
    if (!e.id) continue
    const cur = byId.get(e.id)
    if (!cur || e.upvotes > cur.upvotes) byId.set(e.id, { ...e, day: d })
  }
}
const ranked = [...byId.values()].sort((a, b) => b.upvotes - a.upvotes)
console.log(`\nfeed entries ${total} · distinct arXiv ids ${ranked.length} over ${Object.keys(snap.days).length} days`)

// ground truth: the 37 he kept that week
const papers = JSON.parse(fs.readFileSync(path.join(HERE, 'papers.json'), 'utf8'))
const gt = papers.filter((p) => p.section === 'Week of 2026-08-22').map((p) => idOf(p.url)).filter(Boolean)
const GT = new Set(gt)
console.log(`ground truth (his collection, that week) = ${gt.length}`)

const inFeed = ranked.filter((r) => GT.has(r.id))
console.log(`coverage: ${inFeed.length}/${gt.length} of his kept papers appear anywhere in the feed`)
console.log(`          ${ranked.length} feed papers, so ${inFeed.length}/${ranked.length} of the feed is "he kept it"`)

const top15 = ranked.slice(0, 15)
const hits = top15.filter((r) => GT.has(r.id))
const P = hits.length / 15, R = hits.length / gt.length
const rnd = 15 * (gt.length / (gt.length + 343)) // reference: random 15 from the same 380-paper pool
console.log(`\n=== popularity selector (top 15 by upvotes across the week) ===`)
console.log(`  hits ${hits.length}/15  precision ${(100 * P).toFixed(1)}%  recall ${(100 * R).toFixed(1)}%`)
console.log(`  reference on the 380-paper replay pool: random 15 ≈ ${rnd.toFixed(2)} hits`)
console.log('  top 15:')
top15.forEach((r, i) => console.log(`   ${String(i + 1).padStart(2)}. up=${String(r.upvotes).padStart(4)} ${GT.has(r.id) ? 'HIT ' : '    '} ${r.id}  ${r.title.slice(0, 62)}`))

// overlap with the agent's own 15 (from the post)
const AGENT = ['2608.18319', '2608.18415', '2608.16760', '2608.17950', '2608.15854', '2608.19584', '2608.19338',
  '2608.15976', '2608.15901', '2608.18592', '2608.15483', '2608.15632', '2608.19995', '2608.19762', '2608.15772']
const ov = top15.filter((r) => AGENT.includes(r.id)).length
console.log(`\noverlap with the reported agent's 15: ${ov}/15`)

const out = {
  note: 'dirty popularity baseline; feed is HF daily papers, not restricted to cs.LG, and not every cs.LG paper lands in it',
  days: Object.keys(snap.days).length, feed_ids: ranked.length, gt: gt.length,
  coverage: inFeed.length, hits: hits.length, precision: P, recall: R, overlap_with_agent: ov,
  top15: top15.map((r) => ({ id: r.id, upvotes: r.upvotes, hit: GT.has(r.id), title: r.title })),
}
fs.writeFileSync(path.join(HERE, 'popularity-results.json'), JSON.stringify(out, null, 2))
console.log('\nwrote popularity-results.json')
