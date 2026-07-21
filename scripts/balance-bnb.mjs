/* BATS-N-BASES balance analysis — Monte Carlo over the real engine rules.
   Usage: node scripts/balance-bnb.mjs [gamesPerMatchup]
   Replays full games headlessly: rerolls, scenario choice, gear, quirks,
   pitcher mods, CPU loadouts, walkoffs. Prints hero / opponent / gear tables. */
import { HEROES, GEAR, OPPONENTS, CPU_BUDGET, ECON, cpuScenarios } from '../src/bnb/data.js';
import {
  metScenarios, baseline, applyEquipment, rerollsFor, quirkStrikeK,
  quirkHitBonus, quirkUnlocksK, applySlump, loadedFace, loadedIndex, runPre,
  advance, greedyKeep, countK, scoreOutcome, cpuLoadout,
} from '../src/bnb/engine.js';

const N = Number(process.argv[2]) || 1000; // games per matchup
const rng = Math.random;
const roll = faces => faces[(rng() * 6) | 0];

/* ---------- one at-bat, same decision logic the game's AI uses ---------- */
function atBat(side, st, mem, tally) {
  const eq = side.gear.equipment ? GEAR[side.gear.equipment] : null;
  const perk = side.gear.perk ? GEAR[side.gear.perk].perk : null;
  const quirk = side.gear.quirk ? GEAR[side.gear.quirk].quirk : null;
  const helmet = !!(eq && eq.guard);
  const kLim = quirkStrikeK(quirk);
  const canRerollK = perk === 'unlockK' || perk === 'paidK' || quirkUnlocksK(quirk);
  const opts = {};
  if (!helmet) {
    if (side.vsMod === 'nohustle') opts.noHustle = true;
    if (side.vsMod === 'coldeye' && st.outs === 2) opts.coldEye = true;
  }
  if (eq && eq.hustle1) opts.hustle1 = true;

  let faces = [0, 1, 2, 3, 4].map(() => roll(side.faces));
  if (!helmet && side.vsMod === 'burnlead' && mem.leadoff) faces[0] = 'K';
  mem.leadoff = false;
  if (quirk === 'loaded') faces[loadedIndex(faces)] = loadedFace(rng());
  if (eq && eq.conv) faces = applyEquipment(faces, eq.id).faces;

  const bestOf = f => {
    let best = null, via = null, bv = -Infinity;
    for (const x of [{ eff: baseline(f, opts), s: null },
                     ...metScenarios(side.scens, f).map(s => ({ eff: s.eff, s }))]) {
      const v = scoreOutcome(x.eff, st.bases);
      if (v > bv) { bv = v; best = x.eff; via = x.s; }
    }
    return { best, via, bv };
  };

  let rerolls = rerollsFor(perk, st);
  while (rerolls > 0 && countK(faces) < kLim) {
    if (bestOf(faces).bv >= 2) break;
    const keep = greedyKeep(faces);
    const sel = faces.map((f, i) => !keep[i] && (f !== 'K' || canRerollK));
    if (!sel.some(Boolean)) break;
    if (perk === 'paidK') tally.cash -= sel.filter((s, i) => s && faces[i] === 'K').length;
    faces = faces.map((f, i) => (sel[i] ? roll(side.faces) : f));
    rerolls--;
  }
  if (countK(faces) >= kLim && quirk === 'rabbit' && !mem.rabbitUsed) {
    mem.rabbitUsed = true;
    faces = faces.map(f => (f === 'K' ? roll(side.faces) : f));
  }
  if (countK(faces) >= kLim) {
    if (quirk === 'slump') mem.slumpArmed = true;
    if (quirk === 'showboat') tally.cash -= 1;
    return { out: true, struckOut: true };
  }
  let { best: outcome, via } = bestOf(faces);
  outcome = quirkHitBonus(quirk, outcome);
  const sb = applySlump(quirk, mem.slumpArmed, outcome);
  if (sb.used) mem.slumpArmed = false;
  outcome = sb.outcome;
  if (outcome.kind === 'out') return { out: true, struckOut: false }; // flied out
  if (via) tally.scenUse[via.id] = (tally.scenUse[via.id] || 0) + 1;
  tally.hits++;
  tally.cash += outcome.cash || 0;
  if (quirk === 'showboat' && outcome.bases === 4) tally.cash += 2;
  return { out: false, outcome };
}

/* ---------- one half-inning; walkoff() ends it early when home takes the lead */
function playHalf(side, st, mem, tally, addRuns, walkoff) {
  st.outs = 0; st.bases = [false, false, false];
  mem.leadoff = true;
  while (st.outs < 3) {
    tally.abs++;
    const r = atBat(side, st, mem, tally);
    if (r.out) { st.outs++; if (r.struckOut) tally.ks++; continue; }
    const o = r.outcome;
    let runs = 0;
    if (o.pre) { const pr = runPre(st.bases, o.pre); st.bases = pr.bases; runs += pr.runs; }
    const a = advance(st.bases, o);
    st.bases = a.bases; runs += a.runs;
    if (o.doubleRuns && runs) runs *= 2;
    addRuns(runs);
    if (walkoff && walkoff()) return;
  }
}

/* ---------- full game vs one opponent at one season slot ---------- */
function playGame(heroSide, cpuSide, heroTally, cpuTally) {
  const youFirst = rng() < 0.5;
  const st = { outs: 0, bases: [false, false, false], inning: 1 };
  const heroMem = { rabbitUsed: false, slumpArmed: false, leadoff: true };
  const cpuMem = { rabbitUsed: false, slumpArmed: false, leadoff: true };
  let away = 0, home = 0;
  const sides = youFirst
    ? { top: [heroSide, heroMem, heroTally, r => { away += r; }],
        bot: [cpuSide, cpuMem, cpuTally, r => { home += r; }] }
    : { top: [cpuSide, cpuMem, cpuTally, r => { away += r; }],
        bot: [heroSide, heroMem, heroTally, r => { home += r; }] };
  for (st.inning = 1; st.inning <= 9; st.inning++) {
    playHalf(sides.top[0], st, sides.top[1], sides.top[2], sides.top[3], null);
    if (st.inning >= 3 && home > away) break; // home already ahead, no bottom needed
    const walkoff = () => st.inning >= 3 && home > away;
    playHalf(sides.bot[0], st, sides.bot[1], sides.bot[2], sides.bot[3], walkoff);
    if (st.inning >= 3 && home !== away) break;
  }
  const heroRuns = youFirst ? away : home;
  const cpuRuns = youFirst ? home : away;
  return { heroRuns, cpuRuns, win: heroRuns > cpuRuns, tie: heroRuns === cpuRuns };
}

const newTally = () => ({ abs: 0, hits: 0, ks: 0, cash: 0, scenUse: {} });
const heroSideOf = (h, gear, vsMod) => ({ faces: h.faces, scens: h.scenarios, gear: gear || {}, vsMod });
const cpuSideOf = (o, gi) => ({ faces: o.faces, scens: cpuScenarios(o), gear: cpuLoadout(o, CPU_BUDGET[gi], rng), vsMod: null });

/* Season run: hero (with fixed gear) plays all 10 opponents N times each. */
function seasonStats(hero, gear) {
  const perOpp = [];
  const heroTally = newTally();
  let heroRunsTot = 0, cpuRunsTot = 0, wins = 0, games = 0;
  for (const [gi, o] of OPPONENTS.entries()) {
    let w = 0, hr = 0, cr = 0;
    for (let i = 0; i < N; i++) {
      const g = playGame(heroSideOf(hero, gear, o.mod), cpuSideOf(o, gi), heroTally, newTally());
      if (g.win) w++;
      hr += g.heroRuns; cr += g.cpuRuns;
    }
    perOpp.push({ team: o.team, winPct: w / N, heroRuns: hr / N, cpuRuns: cr / N });
    wins += w; games += N; heroRunsTot += hr; cpuRunsTot += cr;
  }
  return {
    perOpp,
    winPct: wins / games,
    expWins: perOpp.reduce((s, p) => s + p.winPct, 0),
    runsFor: heroRunsTot / games,
    runsAgainst: cpuRunsTot / games,
    cashPerGame: heroTally.cash / games,
    hitPct: heroTally.hits / heroTally.abs,
    kPct: heroTally.ks / heroTally.abs,
    scenUse: heroTally.scenUse,
    abs: heroTally.abs,
  };
}

const pct = x => (x * 100).toFixed(1).padStart(5) + '%';
const num = (x, d = 2) => x.toFixed(d).padStart(5);
const pad = (s, n) => String(s).padEnd(n);

console.log(`BnB balance sim — ${N} games per matchup, ${N * 10} games per config\n`);

/* ============ 1. HEROES (no gear) across the full season slate ============ */
console.log('=== HEROES (no gear, full 10-game slate incl. CPU loadouts & pitcher mods) ===');
console.log(pad('hero', 16) + ' win%  expW  runs/g  allow  hit%   K%   $/g');
const heroStats = {};
for (const h of HEROES) {
  const s = seasonStats(h, {});
  heroStats[h.id] = s;
  console.log(pad(h.name, 16) + ` ${pct(s.winPct)} ${num(s.expWins, 1)}  ${num(s.runsFor)}  ${num(s.runsAgainst)}  ${pct(s.hitPct)} ${pct(s.kPct)} ${num(s.cashPerGame)}`);
}

/* ============ 2. OPPONENT difficulty curve (avg of 4 starter heroes) ============ */
console.log('\n=== OPPONENT DIFFICULTY (avg starter-hero win% by season game) ===');
const starters = HEROES.filter(h => !h.lockTier);
console.log(pad('game/opponent', 24) + ' budget  win%  cpu runs/g');
for (const [gi, o] of OPPONENTS.entries()) {
  let w = 0, cr = 0, n = 0;
  for (const h of starters) {
    for (let i = 0; i < N; i++) {
      const g = playGame(heroSideOf(h, {}, o.mod), cpuSideOf(o, gi), newTally(), newTally());
      if (g.win) w++;
      cr += g.cpuRuns; n++;
    }
  }
  console.log(pad(`G${gi + 1} ${o.team}`, 24) + `  $${String(CPU_BUDGET[gi]).padStart(2)}   ${pct(w / n)}  ${num(cr / n)}`);
}

/* ============ 3. GEAR value (each item alone on Captain Clutch, full slate) ============ */
console.log('\n=== GEAR (single item on Captain Clutch vs full slate; delta vs no gear) ===');
const capt = HEROES.find(h => h.id === 'CAPT');
const base = seasonStats(capt, {});
console.log(pad('item', 22) + ' cost  win%   Δwin%  Δruns/g   Δ$/g  Δwin%/$');
const rows = [];
for (const g of Object.values(GEAR)) {
  const gear = { [g.type]: g.id };
  const s = seasonStats(capt, gear);
  rows.push({
    g,
    winPct: s.winPct,
    dWin: s.winPct - base.winPct,
    dRuns: s.runsFor - base.runsFor,
    dCash: s.cashPerGame - base.cashPerGame,
  });
}
rows.sort((a, b) => b.dWin - a.dWin);
for (const r of rows) {
  console.log(pad(`${r.g.name} (${r.g.type[0]})`, 22) + `  $${r.g.cost}  ${pct(r.winPct)}  ${pct(r.dWin)}  ${num(r.dRuns)}   ${num(r.dCash)}   ${(r.dWin * 100 / r.g.cost).toFixed(2)}`);
}
console.log('(Heckler pays on CPU strikeouts and Rally Helmet blocks pitcher mods —');
console.log(' both are matchup-dependent; cash items also bank $ toward future gear.)');

/* Situational gear on the hero it was built for */
console.log('\n=== SITUATIONAL GEAR ON ITS NATURAL HERO (delta vs same hero, no gear) ===');
const fits = [
  ['DIESEL', { equipment: 'MAPLE' }], ['PROF', { equipment: 'DONUT' }],
  ['WHEELS', { equipment: 'SPRINGS' }], ['CAPT', { quirk: 'SLUMP' }],
  ['DIESEL', { quirk: 'SWING' }], ['KRAKEN', { quirk: 'SWING' }],
  ['DIESEL', { quirk: 'LOADED' }], ['KRAKEN', { quirk: 'LOADED' }],
  ['KRAKEN', { quirk: 'RABBIT' }],
];
for (const [heroId, gear] of fits) {
  const h = HEROES.find(x => x.id === heroId);
  const b = heroStats[h.id];
  const gid = Object.values(gear)[0];
  const s = seasonStats(h, gear);
  console.log(pad(`${h.name} + ${GEAR[gid].name}`, 30) + ` win ${pct(s.winPct)} (Δ ${pct(s.winPct - b.winPct)})  runs Δ ${num(s.runsFor - b.runsFor)}`);
}

/* ============ 4. SCENARIO usage (how often each ability is the chosen play) ============ */
console.log('\n=== SCENARIO USAGE (share of at-bats where the ability was the pick) ===');
for (const h of HEROES) {
  const s = heroStats[h.id];
  const parts = h.scenarios.map(sc => `${sc.name} ${pct((s.scenUse[sc.id] || 0) / s.abs)}`);
  console.log(pad(h.name, 16) + ' ' + parts.join('  ·  '));
}
