/* One-off smoke test for BnB data + engine (no DOM). */
import { HEROES, GEAR, OPPONENTS, CPU_BUDGET, cpuScenarios, SLOT_SHAPE, ECON } from '../src/bnb/data.js';
import DP from '../src/engine/dp.js';
import {
  scenarioMet, metScenarios, baseline, applyEquipment, rerollsFor, kUnlocked,
  kRerollCost, quirkStrikeK, quirkHitBonus, applySlump, loadedFace, cpuLoadout,
} from '../src/bnb/engine.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.error('FAIL:', msg); } else console.log('ok:', msg); };

// --- gear counts by slot ---
const bySlot = { equipment: 0, perk: 0, quirk: 0 };
for (const g of Object.values(GEAR)) bySlot[g.type]++;
console.log('gear counts', bySlot, 'total', Object.values(GEAR).length);
ok(Object.values(GEAR).length === 20, '20 gear items total (was 10, +10 new)');
for (const g of Object.values(GEAR)) ok(!!SLOT_SHAPE[g.type], `${g.id} has valid slot type`);

// --- CPU shopping: loadouts stay legal at every budget ---
ok(CPU_BUDGET.length === OPPONENTS.length, 'one CPU budget per season game');
for (let i = 1; i < CPU_BUDGET.length; i++) ok(CPU_BUDGET[i] >= CPU_BUDGET[i - 1], `CPU budget never shrinks (game ${i + 1})`);
for (const [gi, o] of OPPONENTS.entries()) {
  ok(cpuScenarios(o).length >= 3, `${o.team} has CPU scenarios`);
  for (let trial = 0; trial < 25; trial++) {
    const lo = cpuLoadout(o, CPU_BUDGET[gi]);
    ok(lo.spent <= CPU_BUDGET[gi], `${o.team}: loadout within budget ($${lo.spent} <= $${CPU_BUDGET[gi]})`);
    for (const slot of ['equipment', 'perk', 'quirk']) {
      if (!lo[slot]) continue;
      const g = GEAR[lo[slot]];
      ok(g && g.type === slot, `${o.team}: ${lo[slot]} fits the ${slot} slot`);
      ok(!['HELMET', 'HECKLER', 'SHOW', 'SIGNS'].includes(lo[slot]), `${o.team}: never buys CPU-useless gear (${lo[slot]})`);
    }
    if (fails) break; // don't spam 25x the same failure
  }
}
ok(cpuLoadout(OPPONENTS[0], 0).spent === 0, 'game 1 CPU shops with $0 — stays empty-handed');
ok(cpuLoadout(OPPONENTS[9], CPU_BUDGET[9]).spent > 0, 'finale CPU actually gears up');

// --- hero scenarios: within a hero, no two scenarios produce the same outcome shape ---
const sig = e => [e.kind, e.bases || 0, e.extra ? 1 : 0, e.bonus || 0, e.pre || '', e.cash || 0, e.doubleRuns ? 1 : 0].join('|');
for (const h of HEROES) {
  const sigs = h.scenarios.map(s => sig(s.eff));
  ok(new Set(sigs).size === sigs.length, `${h.name}: all 4 scenario outcomes distinct (${sigs.join(' / ')})`);
  // every scenario must be reachable with the hero's own faces (req faces exist on the die)
  for (const s of h.scenarios) {
    for (const k of ['BAT', 'POW', 'EYE', 'RUN', 'K']) {
      if (s.req[k]) ok(h.faces.includes(k), `${h.name} ${s.name}: die has ${k} face`);
    }
  }
}

// --- locked legend chain ---
const legends = HEROES.filter(h => h.lockTier);
ok(legends.length === 3, 'exactly 3 locked legends');
ok(HEROES.filter(h => !h.lockTier).length === 4, '4 starter heroes stay unlocked');
const tiers = legends.map(h => h.lockTier).sort((a, b) => a - b);
ok(tiers.join(',') === '1,2,3', `legend tiers are 1..3 unique (${tiers.join(',')})`);
ok(new Set(legends.map(h => h.id)).size === 3, 'legend ids unique');
const natural = HEROES.find(h => h.id === 'NATURAL');
ok(natural && natural.faces.filter(f => f === 'K').length === 1, 'The Natural has the lowest K density (1 face)');
ok(HEROES.find(h => h.id === 'KRAKEN')?.faces.filter(f => f === 'POW').length >= 3, 'Kraken is POW-heavy');
ok(HEROES.find(h => h.id === 'MAGIC')?.lockTier === 3, 'Magician is tier 3');

// --- new equipment ---
let r = applyEquipment(['K', 'K', 'BAT', 'RUN', 'EYE'], 'SHADES');
ok(r.faces[0] === 'EYE', 'SHADES converts K->EYE when 2+ K showing (insurance)');
r = applyEquipment(['K', 'BAT', 'BAT', 'RUN', 'EYE'], 'SHADES');
ok(r.idx === -1, 'SHADES does nothing with only 1 K (no free hit face)');
r = applyEquipment(['EYE', 'BAT', 'BAT', 'RUN', 'K'], 'DONUT');
ok(r.faces[0] === 'POW', 'DONUT converts EYE->POW');
r = applyEquipment(['EYE', 'EYE', 'EYE', 'RUN', 'K'], 'DONUT');
ok(r.idx === -1, 'DONUT refuses to break a made walk (3 EYE)');
r = applyEquipment(['BAT', 'BAT', 'BAT', 'RUN', 'K'], 'MAPLE');
ok(r.idx === -1, 'MAPLE refuses to break a made single (3 BAT)');
r = applyEquipment(['BAT', 'BAT', 'POW', 'POW', 'K'], 'MAPLE');
ok(r.faces.filter(f => f === 'POW').length === 3, 'MAPLE upgrades toward OFF THE WALL');
r = applyEquipment(['BAT', 'BAT', 'BAT', 'RUN', 'K'], 'HELMET');
ok(r.idx === -1, 'HELMET is passive (no conversion)');
ok(GEAR.SPRINGS.hustle1 && GEAR.HELMET.guard, 'SPRINGS/HELMET flags set');

// hustle1: one RUN is enough for the hustle base
let o1 = baseline(['BAT', 'BAT', 'BAT', 'RUN', 'EYE'], { hustle1: true });
ok(o1.kind === 'hit' && o1.bases === 1 && o1.extra === true, 'SPRINGS: single + hustle with 1 RUN');
o1 = baseline(['BAT', 'BAT', 'BAT', 'RUN', 'EYE'], {});
ok(o1.extra === false, 'without SPRINGS 1 RUN gives no hustle');

// --- new perks ---
ok(rerollsFor('rerollRISP', { outs: 0, bases: [false, true, false], inning: 1 }) === 2, 'SCOUT: +1 reroll with RISP');
ok(rerollsFor('rerollRISP', { outs: 0, bases: [true, false, false], inning: 1 }) === 1, 'SCOUT: runner on 1st only = no bonus');
ok(rerollsFor('rerollLate', { outs: 0, bases: [false, false, false], inning: 3 }) === 3, 'NINTH GEAR: +2 rerolls in 3rd+');
ok(rerollsFor('rerollLate', { outs: 0, bases: [false, false, false], inning: 2 }) === 1, 'NINTH GEAR: nothing early');
ok(kUnlocked('paidK') && kRerollCost('paidK') === 1, 'SIGN STEALER: K unlocked at $1/die');
ok(!kUnlocked('reroll1') && kRerollCost('unlockK') === 0, 'other perks unchanged');

// --- new quirks ---
let sl = applySlump('slump', true, { kind: 'hit', bases: 1, label: 'SINGLE' });
ok(sl.used && sl.outcome.bases === 2, 'SLUMP BUSTER: armed single -> double');
sl = applySlump('slump', true, { kind: 'hit', bases: 3, label: 'TRIPLE' });
ok(sl.outcome.bases === 4, 'SLUMP BUSTER: triple bumps to HR (capped at 4)');
sl = applySlump('slump', false, { kind: 'hit', bases: 1, label: 'SINGLE' });
ok(!sl.used && sl.outcome.bases === 1, 'SLUMP BUSTER: not armed = no effect');
sl = applySlump('slump', true, { kind: 'walk', bases: 1, label: 'WALK' });
ok(!sl.used, 'SLUMP BUSTER: walks do not consume it');
ok(loadedFace(0.2) === 'POW' && loadedFace(0.8) === 'K', 'LOADED DICE: 50/50 POW or K');
ok(quirkStrikeK('freeswing') === 2 && quirkStrikeK('loaded') === 3, 'strike limits unchanged');

// --- HR scoring: runs = plate crossings only ---
const hr = { kind: 'hit', bases: 4, extra: false, label: 'HOME RUN' };
ok(DP.advance([false, false, false], hr).runs === 1, 'solo HR scores 1 run');
ok(DP.advance([true, false, false], hr).runs === 2, 'HR with man on 1st scores 2');
ok(DP.advance([true, true, false], hr).runs === 3, 'HR with 1st+2nd scores 3');
ok(DP.advance([true, true, true], hr).runs === 4, 'grand slam scores 4');
ok(DP.advance([false, false, false], { ...hr, bonus: 99 }).runs === 1, 'bonus field no longer invents runs');
ok(ECON.perRunCap === 3, 'run pay capped at $3/game');
ok(ECON.shopSize === 5, 'shop always targets 5 items');

// --- no scenario may award phantom bonus runs ---
for (const h of HEROES) {
  for (const s of h.scenarios) {
    ok(!s.eff.bonus, `${h.name} ${s.name}: no eff.bonus (use cash/hustle instead)`);
  }
}

// --- scenario reqs still matched by engine ---
const prof = HEROES.find(h => h.id === 'PROF');
ok(scenarioMet(prof.scenarios[1].req, ['EYE', 'EYE', 'BAT', 'BAT', 'POW']), 'PROF Thread the Needle matches EYE2+BAT2+POW1');
const wheels = HEROES.find(h => h.id === 'WHEELS');
ok(metScenarios(wheels.scenarios, ['RUN', 'RUN', 'RUN', 'RUN', 'RUN']).some(s => s.eff.bases === 4), 'WHEELS RUN×5 lights the inside-the-park HR');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL SMOKE CHECKS PASSED');
process.exit(fails ? 1 : 0);
