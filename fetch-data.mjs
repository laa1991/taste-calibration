#!/usr/bin/env node
// fetch-data.mjs — re-download the two public JSON files and verify them against MANIFEST.json.
//
// The snapshot in this repo is what the published numbers were computed on. This script answers
// two questions: (a) can you still get the data, (b) are you getting the same bytes?
// It never overwrites by default — pass --force to refresh the snapshot.
//
// Usage: node fetch-data.mjs [--force]

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const man = JSON.parse(readFileSync(path.join(HERE, 'MANIFEST.json'), 'utf8'))
const force = process.argv.includes('--force')
const sha = (b) => createHash('sha256').update(b).digest('hex')

let mismatch = 0
for (const [name, spec] of Object.entries(man.sources)) {
  const local = path.join(HERE, name)
  let line = `${name.padEnd(18)} expect ${spec.bytes} B / ${spec.sha256.slice(0, 12)}…`
  let body = null
  try {
    const res = await fetch(spec.url, { headers: { 'User-Agent': 'taste-calibration/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    console.log(`${line}\n  live fetch FAILED: ${e.message}`)
    console.log(`  local copy: ${existsSync(local) ? `${(await import('node:fs')).statSync(local).size} B` : 'missing'}`)
    continue
  }
  const got = sha(body)
  const ok = got === spec.sha256 && body.length === spec.bytes
  console.log(`${line}\n  live  ${String(body.length).padStart(7)} B / ${got.slice(0, 12)}…  ${ok ? 'MATCH' : 'DIFFERENT'}`)
  if (!ok) {
    mismatch++
    console.log('  => the live collection has moved on. The numbers in README.md describe the snapshot above.')
  }
  if (force || !existsSync(local)) {
    const before = existsSync(local) ? sha(readFileSync(local)) : null
    if (force && before && before !== spec.sha256) {
      console.log('  refusing --force write: the local file is not the manifest snapshot either.')
    } else {
      writeFileSync(local, body)
      console.log(`  wrote ./${name}`)
    }
  } else {
    console.log('  (kept the local snapshot; rerun with --force to overwrite)')
  }
}
process.exitCode = mismatch ? 1 : 0
