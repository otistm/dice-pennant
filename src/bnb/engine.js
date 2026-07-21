/* BATS-N-BASES — pure rules helpers. No DOM. */
import DP from '../engine/dp.js';
import { GEAR } from './data.js';

export function countFaces(faces) {
  const c = { BAT: 0, POW: 0, EYE: 0, RUN: 0, K: 0 };
  for (const f of faces) if (f && c[f] != null) c[f]++;
  return c;
}

/* ---------- scenario matching ---------- */
export function scenarioMet(req, faces) {
  const c = countFaces(faces);
  if (req.uniq) {
    let uniq = 0;
    for (const k of ['BAT', 'POW', 'EYE', 'RUN']) if (c[k] > 0) uniq++;
    if (uniq < req.uniq) return false;
  }
  for (const k of ['BAT', 'POW', 'EYE', 'RUN', 'K']) {
    if (req[k] && c[k] < req[k]) return false;
  }
  return true;
}

export function metScenarios(scenarios, faces) {
  return scenarios.filter(s => scenarioMet(s.req, faces));
}

/* Baseline outcome when no scenario is chosen (classic Dice Pennant table). */
export function baseline(faces, opts) {
  if (DP.countK(faces) >= 3) return { kind: 'out', bases: 0, label: 'STRUCK OUT' };
  return DP.resolve(faces, opts || {});
}

/* ---------- equipment: first-roll face conversion ----------
   Balance rules learned from simulation:
   - K-converters are STRIKEOUT INSURANCE: they only fire with 2+ K showing.
     (An always-on K converter is a permanent extra hit face — degenerate.)
   - Upgrade converters (BAT/EYE -> POW) never break an already-made hand. */
const FACE_VALUE = { K: 0, RUN: 1, EYE: 2, BAT: 3, POW: 4 };
function handScore(faces) {
  const o = baseline(faces, {});
  if (o.kind === 'out') return 0;
  return o.bases + (o.extra ? 0.5 : 0) + (o.kind === 'walk' ? -0.2 : 0);
}
export function applyEquipment(faces, eqId) {
  const eq = GEAR[eqId];
  if (!eq || !eq.conv) return { faces, idx: -1 };
  const [from, to] = eq.conv;
  let idx = -1;
  if (from === 'ANY') {
    // corked bat: upgrade the worst die
    let worst = Infinity;
    faces.forEach((f, i) => { if (f !== to && FACE_VALUE[f] < worst) { worst = FACE_VALUE[f]; idx = i; } });
  } else {
    if (from === 'K' && DP.countK(faces) < 2) return { faces, idx: -1 };
    idx = faces.indexOf(from);
  }
  if (idx < 0) return { faces, idx: -1 };
  const nf = faces.slice();
  nf[idx] = to;
  if (handScore(nf) < handScore(faces)) return { faces, idx: -1 };
  return { faces: nf, idx };
}

/* ---------- perk: reroll economy ----------
   state: { outs, bases, inning } — the situation the at-bat starts in. */
export function rerollsFor(perkId, state) {
  const s = state || {};
  let n = 1;
  if (perkId === 'reroll1') n += 1;
  if (perkId === 'reroll2out' && (s.outs || 0) >= 2) n += 1;
  if (perkId === 'rerollRISP' && s.bases && (s.bases[1] || s.bases[2])) n += 1;
  if (perkId === 'rerollLate' && (s.inning || 1) >= 3) n += 2;
  return n;
}
export function kUnlocked(perkId) { return perkId === 'unlockK' || perkId === 'paidK'; }
/* Free Swinger also swings his ✕ dice free — that's the whole point of him. */
export function quirkUnlocksK(quirkId) { return quirkId === 'freeswing'; }
/* Sign Stealer: K dice are selectable but each K reroll costs $1. */
export function kRerollCost(perkId) { return perkId === 'paidK' ? 1 : 0; }

/* ---------- quirk hooks ---------- */
/* freeswing: 2+ K is already a strikeout; hits get +1 base */
export function quirkStrikeK(quirkId) { return quirkId === 'freeswing' ? 2 : 3; }
export function quirkHitBonus(quirkId, outcome) {
  if (quirkId !== 'freeswing' || !outcome || outcome.kind !== 'hit' || outcome.bases >= 4) return outcome;
  return { ...outcome, bases: outcome.bases + 1, label: outcome.label + ' +FREE SWING' };
}
/* Slump Buster: the first hit after one of your strikeouts gains +1 base. */
export function applySlump(quirkId, armed, outcome) {
  if (quirkId !== 'slump' || !armed || !outcome || outcome.kind !== 'hit') {
    return { outcome, used: false };
  }
  return {
    outcome: { ...outcome, bases: Math.min(4, outcome.bases + 1), label: outcome.label + ' +SLUMP BUSTER' },
    used: true,
  };
}
/* Loaded Dice: each at-bat one die is rigged — 50/50 it lands POW or K.
   The rigged one is always your WORST die (that's why you loaded it). */
export function loadedFace(roll) { return roll < 0.5 ? 'POW' : 'K'; }
export function loadedIndex(faces) {
  let idx = 0, worst = Infinity;
  faces.forEach((f, i) => { if (FACE_VALUE[f] < worst) { worst = FACE_VALUE[f]; idx = i; } });
  return idx;
}

/* ---------- pre-effects then advance ---------- */
export function runPre(bases, pre) {
  const moves = [];
  let runs = 0;
  const nb = bases.slice();
  if (pre === 'advance1') {
    if (nb[2]) { runs++; moves.push({ from: 3, to: 4 }); }
    const shifted = [false, nb[0], nb[1]];
    nb.forEach((occ, i) => { if (occ && i < 2) moves.push({ from: i + 1, to: i + 2 }); });
    nb[0] = shifted[0]; nb[1] = shifted[1]; nb[2] = shifted[2];
  } else if (pre === 'steal') {
    const lead = nb[2] ? 2 : nb[1] ? 1 : nb[0] ? 0 : -1;
    if (lead >= 0) {
      nb[lead] = false;
      if (lead === 2) { runs++; moves.push({ from: 3, to: 4 }); }
      else { nb[lead + 1] = true; moves.push({ from: lead + 1, to: lead + 2 }); }
    }
  }
  return { bases: nb, runs, moves };
}

export const advance = DP.advance;
export const greedyKeep = DP.greedyKeep;
export const countK = DP.countK;

/* ---------- CPU shopping: pick a loadout for one game ----------
   The CPU only buys gear it can actually use at the plate. Money-economy
   items (Heckler, Showboat, Sign Stealer) and the anti-pitcher Helmet do
   nothing for the CPU, so it skips them. */
export function cpuGearFit(g, opp) {
  const kCount = opp.faces.filter(f => f === 'K').length;
  if (g.type === 'equipment') {
    if (g.guard) return 0;                       // no pitcher tricks target the CPU
    if (g.hustle1) {
      const runs = opp.faces.filter(f => f === 'RUN').length;
      return runs ? runs * (opp.arch === 'speed' ? 1.6 : 0.8) : 0;
    }
    if (!g.conv) return 0;
    const [from] = g.conv;
    if (from === 'ANY') return 3;                // corked bat always lands
    const n = opp.faces.filter(f => f === from).length;
    if (!n) return 0;
    let v = Math.min(n, 2) * 1.1;
    if (from === 'K') v += 0.5;                  // erasing strikeout faces is premium
    if (g.id === 'MAPLE' && opp.arch === 'power') v += 0.6;
    return v;
  }
  if (g.type === 'perk') {
    if (g.perk === 'paidK') return 0;            // needs a wallet mid-at-bat
    if (g.perk === 'reroll1') return 2.2;
    if (g.perk === 'rerollLate') return 2.0;
    if (g.perk === 'unlockK') return kCount >= 2 ? 2.4 : 1.2;
    return 1.5;                                  // situational rerolls
  }
  if (g.quirk === 'freeswing') return kCount <= 1 ? 2.2 : 0.7;
  if (g.quirk === 'rabbit') return kCount >= 2 ? 2.0 : 1.2;
  if (g.quirk === 'slump') return 1.4;
  if (g.quirk === 'loaded') return opp.arch === 'power' ? 1.3 : 0.7;
  return 0;                                      // heckler / showboat pay cash — useless here
}

export function cpuLoadout(opp, budget, rngFn = Math.random) {
  const out = { equipment: null, perk: null, quirk: null, spent: 0 };
  let left = budget || 0;
  for (;;) {
    let best = null, bestValue = 0.45;           // must clear a usefulness bar
    for (const g of Object.values(GEAR)) {
      if (out[g.type] || g.cost > left) continue;
      const fit = cpuGearFit(g, opp);
      if (fit <= 0) continue;
      const value = (fit + rngFn() * 0.5) / Math.sqrt(g.cost);
      if (value > bestValue) { bestValue = value; best = g; }
    }
    if (!best) break;
    out[best.type] = best.id;
    left -= best.cost;
    out.spent += best.cost;
  }
  return out;
}

/* ---------- CPU choice: which met scenario (or baseline) is best ---------- */
export function scoreOutcome(o, bases) {
  if (!o || o.kind === 'out') return -1;
  const runners = bases.filter(Boolean).length;
  // walks have no `bases` field on scenario effs — treat as reaching 1st
  let v = (o.bases || (o.kind === 'walk' ? 1 : 0)) * (1 + runners * 0.5);
  if (o.extra) v += 0.5;
  if (o.cash) v += o.cash * 0.15;
  if (o.pre === 'advance1') v += runners * 0.6;
  if (o.pre === 'steal') v += runners ? 0.6 : 0;
  if (o.doubleRuns) v += runners * 0.8;
  if (o.kind === 'walk') v = Math.max(v, 0.8);
  return v;
}
