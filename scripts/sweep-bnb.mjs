/* Fast per-half sweep: runs/half + hit%/K% for every hero and opponent (no gear).
   Used to tune dice faces and scenario reqs before running full-season sims. */
import { HEROES, OPPONENTS, cpuScenarios } from '../src/bnb/data.js';
import { metScenarios, baseline, greedyKeep, countK, scoreOutcome, advance, runPre } from '../src/bnb/engine.js';

const rng = Math.random;
const N = Number(process.argv[2]) || 4000;

function half(faces6, scens) {
  let outs = 0, bases = [false, false, false], runs = 0, abs = 0, hits = 0, ks = 0;
  while (outs < 3 && abs < 200) {
    abs++;
    let faces = [0, 1, 2, 3, 4].map(() => faces6[(rng() * 6) | 0]);
    let rerolls = 1;
    const bestNow = f => {
      let best = null, bv = -Infinity;
      for (const x of [baseline(f, {}), ...metScenarios(scens, f).map(s => s.eff)]) {
        const v = scoreOutcome(x, bases);
        if (v > bv) { bv = v; best = x; }
      }
      return { best, bv };
    };
    while (rerolls > 0 && countK(faces) < 3) {
      if (bestNow(faces).bv >= 2) break;
      const keep = greedyKeep(faces);
      const sel = faces.map((f, i) => f !== 'K' && !keep[i]);
      if (!sel.some(Boolean)) break;
      faces = faces.map((f, i) => (sel[i] ? faces6[(rng() * 6) | 0] : f));
      rerolls--;
    }
    if (countK(faces) >= 3) { outs++; ks++; continue; }
    const { best: o } = bestNow(faces);
    if (o.kind === 'out') { outs++; continue; }
    hits++;
    if (o.pre) { const pr = runPre(bases, o.pre); bases = pr.bases; runs += pr.runs; }
    const a = advance(bases, o);
    bases = a.bases; runs += a.runs;
    if (o.doubleRuns && a.runs) runs += a.runs;
  }
  return { runs, abs, hits, ks };
}

function sweep(name, faces, scens) {
  let R = 0, A = 0, H = 0, K = 0;
  for (let i = 0; i < N; i++) { const r = half(faces, scens); R += r.runs; A += r.abs; H += r.hits; K += r.ks; }
  console.log(
    name.padEnd(18) +
    ` ${(R / N).toFixed(2).padStart(5)} r/half` +
    `  ${(A / N).toFixed(1).padStart(4)} ab` +
    `  hit ${(H / A * 100).toFixed(0).padStart(3)}%` +
    `  K ${(K / A * 100).toFixed(0).padStart(3)}%` +
    `  [${faces.join(',')}]`
  );
}

console.log('--- heroes ---');
for (const h of HEROES) sweep(h.name, h.faces, h.scenarios);
console.log('--- opponents ---');
for (const o of OPPONENTS) sweep(o.team, o.faces, cpuScenarios(o));
