# taste-calibration

**A difficulty ladder and five naive baselines for the question: can an agent learn a researcher's taste about papers?**

Prompted by [*Can Taste Be Learned?*](https://meta-circle.com/blog/can-taste-be-learned) and the [guess-my-taste quiz](https://metacircleai.github.io/ziming-paper-collection/game.html) built around a public collection of ~2,200 personally selected arXiv papers.

Everything here runs offline, in seconds, with **no dependencies and no network** — except one LLM baseline, whose raw answer sheets are checked in so it can be audited rather than trusted.

The contribution is a **ruler, not a verdict**: three difficulty levels, four non-model baselines, the readings from one run, and a self-audit of where the ruler could be lying.

---

## The result in one paragraph

Picking the paper a researcher actually kept, out of four titles, is a **much easier task than it looks — and how easy depends almost entirely on how the three wrong options were chosen, not on how good the predictor is.** With three **random** cs.LG distractors, a model that knows nothing about the researcher scores **68.3%** (chance 25%) and a one-line rule — *pick the shortest title* — scores 38.3%. Replace the distractors with the three **nearest titles** and everything converges: supervised model 51.7%, the same zero-information model 55.0%, the one-line rule 50.0% — **three confidence intervals that contain each other.** So if a benchmark draws its negative examples at random, it is mostly measuring *can the model tell a curated paper from an arbitrary one*, not *did it learn this person's taste*.

---

## The four things a number like "about 50% accuracy" is missing

Taken from the post: an agent ranked a week's cs.LG submissions, and the researcher hand-scored the top 15 (⭐1 · ✅5 · ◐2 · ❌7) — *"about 50% accuracy."* The same 15 predictions, under four bookkeeping rules:

| rule | reading |
|---|---|
| did it enter the collection? (the dataset's own hard label) | **5/15 = 33.3%** |
| hand verdicts, ✅+⭐ count as correct | 6/15 = 40.0% |
| ◐ counts as half a hit *(the rule that gives "about 50%")* | **7/15 = 46.7%** |
| ◐ counts as a hit too | 8/15 = 53.3% |

And the four things missing around it:

1. **Base rate.** This is the hit rate of a top-15 list, not the accuracy of a balanced classifier. The chance level is the fraction of papers he keeps — on the order of **1%**, not 50%. *(Estimate, not a reading: I could not get cs.LG's weekly submission volume — the arXiv API rate-limited me three times. Anyone with a single API call can fill this in.)*
2. **Recall.** Measured: of the **37** papers he kept that week, the agent's 15 contained **5** ⇒ **recall 13.5%**, precision 33.3%, F1 0.19. The missing 86.5% is not visible in a precision number.
3. **n.** 15 hand judgments. In this repo, the *same* condition on two different 30-question draws moved by **23 points** (see R3). A single 15-item judgment is one sample, not a reading.
4. **The distractor pool.** See above — it moves everybody's score by 15+ points.

---

## Reproduce

```bash
node fetch-data.mjs       # verify the data snapshot (sha256 against MANIFEST.json)
node ladder.mjs 200       # R1/R2: difficulty ladder, 200 questions per cohort
node replay.mjs           # R5: replay one week's top-15 selection
node compare.mjs          # R1: five players on the same 120 questions
node paired.mjs           # R4: the example dose-response (uses the shipped answer sheets)
node audit.mjs            # self-audit of the distractor construction
node lengths.mjs          # R2: the title-length gap and its mechanical prediction
node score.mjs ans-A.txt:levelA ans-B.txt:levelB   # score an answer sheet
```

`runs.txt` is the verbatim console record of one full pass. All scripts are deterministic given their seeds; no file is written except the `*-results-*.json` summaries.

---

## Setup

**Data.** Two public JSON files (see `MANIFEST.json`): the collection (2,208 entries; 1,992 with `source=arxiv`) and the quiz's distractor pool (482 titles, 343 of them arXiv 2026-08). Everything below uses **titles only** — no abstracts, no PDFs, no citations.

**Three difficulty levels**, all keeping the "1 kept + 3 distractors" four-option shape:

| level | how the three distractors are chosen | mean cosine to the correct title |
|---|---|---|
| **L0** (≈ the public game) | uniformly at random from the distractor pool | 0.035 |
| **L1** | restricted to the same arXiv month (2026-08) | 0.035 |
| **L2** (hardest here) | the 3 highest char-3-4-gram TF-IDF similarity titles | 0.176 |

**Five players**, all title-only:

| player | what it is |
|---|---|
| `random` | uniform — the harness's own calibration check |
| `shortest` | **pick the shortest title.** One line, no training, no knowledge |
| `kNN5` | highest mean cosine to its 5 nearest neighbours among his own kept titles |
| `LR` | logistic regression on character n-grams, class-balanced |
| `LLM blind` | a language model that has never seen this person, shown only the question |
| `LLM + examples` | same, plus N kept / N not-kept examples before the questions |

**Clean split (hard constraint).** Any title that appears as an option in *any* question is removed from *every* player's training set. For `compare.mjs` that leaves 1,943/1,992 positives and 273/482 negatives. The LLM's question files were placed in a directory containing only the questions; for the second question set the answer key was never written to disk anywhere.

**Questions.** Two independent 30-question sets (seeds `20260925` and `777`); each set asks the *same* positives at L0 and L2 ⇒ **60 L0 + 60 L2 questions**, plus 30 more for each example arm. The files handed to the model are checked in (`qA.txt`, `qB.txt`, `questions/blind/`, `questions/big/`); the answer keys are in `regen1/` and `regen777/` — regenerated deterministically and verified byte-identical to the question files that were actually answered.

---

## Readings

### R1 · Same 120 questions, five players (chance = 25%)

| player | L0 (game-like) | L2 (topically matched) |
|---|---|---|
| `random` | 19/60 = **31.7%** [21–44] | 15/60 = **25.0%** [16–37] |
| `shortest` | 23/60 = **38.3%** [27–51] | 30/60 = **50.0%** [38–62] |
| `kNN5` | 25/60 = **41.7%** [30–54] | 16/60 = **26.7%** [17–39] |
| `LR` | 38/60 = **63.3%** [51–74] | 31/60 = **51.7%** [39–64] |
| `LLM blind` | 41/60 = **68.3%** [56–79] | 33/60 = **55.0%** [42–67] |

Wilson 95% intervals. Three readings:

1. **At L2 the intervals [38–62] / [39–64] / [42–67] contain each other.** A one-line rule, a supervised model and a zero-information LLM are **not distinguishable** at that difficulty.
2. **`kNN5` collapses to chance at L2** (26.7% vs 25%): "it looks like something in his collection" stops being informative the moment the distractors are topically matched too.
3. `random` lands at 31.7% / 25.0% — the harness itself is not biased.

### R2 · What one line is worth: title length

| pool | n | mean | median | p10 | p90 |
|---|---|---|---|---|---|
| his kept titles (all) | 1992 | 59.4 | 59 | 34 | 85 |
| his kept titles (2026-08) | 64 | 58.6 | 59 | 32 | 90 |
| distractor pool (all) | 482 | 74.5 | 73 | 51 | 100 |
| distractor pool (2026-08) | 343 | 74.5 | 73 | 51 | 102 |

His titles are **~16 characters shorter**, and the gap survives within a single month. Mechanical prediction for "always take the shortest of four": **47.7%**. Measured: 38.3% (L0) and 50.0% (L2) — same order, wide intervals. **This is the largest free score in the game, and it needs no knowledge of the person at all.**

### R3 · The replication check: same condition, different 30 questions ⇒ 23 points

| player | L0 set 1 | L0 set 2 | L2 set 1 | L2 set 2 |
|---|---|---|---|---|
| `LLM blind` | 24/30 (80.0%) | 17/30 (56.7%) | 18/30 (60.0%) | 15/30 (50.0%) |
| `LR` | 21/30 | 17/30 | 17/30 | 14/30 |
| `shortest` | 11/30 | 12/30 | 14/30 | 16/30 |

Same model, same instructions, same question format — different sample. **Run the same condition twice before believing any single small-n number.** This is the cheapest experiment in the repo and the one that most changes how you read everything else.

### R4 · Do examples help? (same 30 L2 questions, paired)

| condition | correct | McNemar exact p |
|---|---|---|
| blind (0 examples) | 18/30 = 60.0% | — |
| **+ 10 kept / 10 not-kept** | 19/30 = 63.3% | **1.000** (net +1) |
| **+ 100 kept / 100 not-kept** | 21/30 = 70.0% | **0.688** (net +2) |

Monotone, but neither step is significant. Honest reading: **200 examples bought +3 questions — not distinguishable from nothing at n=30.** Neither "examples work" nor "examples don't" is supported; the paired design is here so it can be scaled up.

### R5 · One replay of a real week — **not** a head-to-head

Ground truth = the 37 papers he kept in the week the post evaluates. Candidate pool = those 37 + the 343 same-month distractors = **380 (positive rate 9.7%, roughly 10× the real one)** ⇒ **every number below is an upper bound, not a comparison against the reported agent.**

| selector | hits | precision | recall |
|---|---|---|---|
| the agent's own 15 (transcribed from the post's table) | 5/15 | **33.3%** [15–58] | **13.5%** |
| `LR` (title-only, 1,955 pos / 139 neg) | 7/15 | **46.7%** [25–70] | 18.9% |
| `kNN5` | 7/15 | 46.7% | 18.9% |
| the 15 shortest titles | 4/15 | 26.7% | 10.8% |
| the 15 longest titles (**negative control**) | 0/15 | 0% | 0% |
| random 15 (×400) | 1.37/15 | 9.1% | 3.7% |

Two further readings:

- **The agent's 15 land at ranks 88 / 17 / 7 / — / 150 / 51 / 169 / — / 1 / 72 / 177 / — / — / 77 / —** inside the LR's ordering of the same 380 (median 77). The two selectors are picking largely *different* things — only 2 of the 15 also make the LR's top 15.
- **Five of the agent's 15 hits are papers he had already collected himself.** The single case where it produced information he did not already have is `2608.18592`, which he annotated *"I really like this paper, but missed it when browsing arXiv."* On a **net-new** accounting — what the agent found that he missed ÷ what it submitted — this run scores **1/15 ≈ 7%**, and that is arguably the metric that matches the stated purpose.

---

## What this does **not** show

- **No human baseline.** How well a person scores on the game is unknown, and is the most obvious missing number.
- **No popularity baseline.** A model that only predicts "what's hot this week" would look a lot like a model that learned taste. Without a "15 most-discussed papers of that week" control, that explanation is not excluded. *(The fact that all 5 hits were papers he found himself is the shape of this worry.)*
- **L2's "same topic" is a proxy** — the 3 nearest titles under character-n-gram cosine, not a human judgment of topical match.
- **The negatives are random cs.LG, not papers he saw and rejected.** The true hard-pair experiment needs his browsing history, which does not exist. This is the ceiling of what a public collection can support.
- **The distractor pool is not the week's full cs.LG stream.** It has zero overlap with the collection (either filtered at fetch time or genuinely disjoint — I have no evidence to separate the two), so its positive rate is unknown.
- **One LLM run per condition, reasoning budget disabled**, one model. R3's 23-point swing says single runs are not trustworthy.
- **The collection's `section` field cannot be used as a timeline**: 1,845 of 2,208 entries share one import date (`2026-06-06` — the field is in `tags` as `date:`, not `week:`). Any time-split evaluation has to proxy dates from the arXiv IDs.

A self-audit worth repeating here: the L2 distractor selection *could* have inflated the length cue. Measured, it widens the distractor-vs-correct length gap from 12.5 to 13.7 characters — **1.3 of 12.5**, far too little to explain the 12-point move. `node audit.mjs`.

---

## How to use this

1. **Report four things together**: a naive baseline (`random` *and* `shortest`), n with an interval, the recall side, and the construction of the negative pool. Any one alone is unreadable.
2. **The difficulty knob is the distractor pool, not the model.** L0 → L2 is worth ~15 points for every player simultaneously.
3. **`shortest` is the cheapest useful control.** A model that cannot beat "pick the shortest title" on hard pairs has not learned taste.
4. **In-context examples have a low ceiling here** (200 examples → +3 questions, n.s.). If "can taste be taught" is the question, it will need training or explicit criteria, not a longer prompt.
5. **Count net-new, not hits.** For a recommender whose purpose is to extend someone's reach, `found-and-they-missed ÷ submitted` is the metric that matches the goal; hit rate rewards re-stating what they already knew.

---

## Note to the owner of the collection

Your data is the whole reason any of this is measurable, and the post's invitation to use it for benchmarking is what made me treat it as a benchmark — including the unflattering parts.

- The replay in R5 is **not** a fair comparison to your agent, and the README says so in bold. Different candidate pool, different base rate; it is an upper bound on a title-only selector, not a verdict on an agent that saw the real stream.
- The two most useful things I could not do — a **human baseline** on your quiz and a **popularity baseline** for the week — need something only you have. If a "15 most-discussed papers of that week" list exists anywhere, it would settle the question this repo cannot.
- If you would rather I not keep a mirror of the two JSON files here, say so and I will replace them with the fetch script alone in one commit.

---

## Provenance, attribution, license

- **Scripts and text:** MIT (see `LICENSE`).
- **`papers.json` / `distractors.json`:** not mine. They are a mirror of the author's public dataset, kept so the published numbers stay reproducible after the live collection changes; see `MANIFEST.json` for the source URLs, sizes and hashes, and `node fetch-data.mjs` to check whether the live data still matches the snapshot. All rights remain with the original author.
- **The LLM baseline's answer sheets** are checked in verbatim (`ans-*.txt`) — including the wrong answers — so the baseline can be audited rather than taken on faith.
- **Produced** 2026-09-25 by an AI agent (a DeepSeek model running inside a local harness) at the request of the repository owner. Method, thresholds and framing were chosen by the agent; the decision to publish was not.
