// power.mjs — "how many questions would this comparison actually need?"
//
// The R1 table reports intervals that overlap. Overlapping intervals are NOT evidence of
// equality; they are evidence that n is too small. This script prints the n each comparison
// would need to resolve, so the README can say a number instead of an impression.
//
// Method: standard two-sided normal-approximation power, alpha = 0.05, power = 80%.
//   one sample vs a fixed chance level p0:
//     n = ( z_{a/2}*sqrt(p0(1-p0)) + z_b*sqrt(p1(1-p1)) )^2 / (p1-p0)^2
//   two independent samples:
//     n = ( z_{a/2}*sqrt(2*pbar*(1-pbar)) + z_b*sqrt(p1(1-p1)+p2(1-p2)) )^2 / (p1-p2)^2
// Usage: node power.mjs

const ZA = 1.959963984540054; // two-sided alpha = 0.05
const ZB = 0.8416212335729143; // power = 0.80

const nVsChance = (p0, p1) =>
  ((ZA * Math.sqrt(p0 * (1 - p0)) + ZB * Math.sqrt(p1 * (1 - p1))) ** 2) / (p1 - p0) ** 2;
const nTwoGroups = (p1, p2) => {
  const pbar = (p1 + p2) / 2;
  return (
    ((ZA * Math.sqrt(2 * pbar * (1 - pbar)) + ZB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2) /
    (p1 - p2) ** 2
  );
};

console.log('== a 4-option player vs CHANCE (25%) — questions needed ==');
for (const p1 of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.68]) {
  console.log(`   true rate ${(100 * p1).toFixed(0)}%  ->  n ≈ ${Math.ceil(nVsChance(0.25, p1))}`);
}

console.log('\n== two players, 10 points apart — questions PER CELL needed ==');
for (const [p1, p2] of [[0.5, 0.55], [0.5, 0.6], [0.5, 0.65], [0.5, 0.7], [0.25, 0.35], [0.4, 0.5]]) {
  console.log(`   ${(100 * p1).toFixed(0)}% vs ${(100 * p2).toFixed(0)}%  (delta ${(100 * (p2 - p1)).toFixed(0)}pt)  ->  n ≈ ${Math.ceil(nTwoGroups(p1, p2))} per cell`);
}

console.log('\n== what the shipped run actually had ==');
console.log(`   60 questions per cell  ->  a 10-point gap (50% vs 60%) would need ${Math.ceil(nTwoGroups(0.5, 0.6))} per cell.`);
console.log(`   i.e. the shipped n supports "different from chance", not "equal to each other".`);

console.log('\n== interval half-width at n=60 (Wilson, p≈0.5) ==');
for (const p of [0.4, 0.5, 0.55]) {
  const z = ZA, n = 60;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  console.log(`   p=${(100 * p).toFixed(0)}%  ->  [${(100 * (c - h) / d).toFixed(1)}%, ${(100 * (c + h) / d).toFixed(1)}%]  (±${(100 * h / d).toFixed(1)}pt)`);
}
console.log('\n=> at n=60 an interval is about ±12 points wide, so two players 10 points apart cannot be separated.');
