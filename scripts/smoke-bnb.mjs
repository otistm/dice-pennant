/* One-off smoke test for BnB data + engine (no DOM). */
import { HEROES, GEAR, OPPONENTS, cpuScenarios, SLOT_SHAPE } from '../src/bnb/data.js';
import {
  scenarioMet, metScenarios, baseline, applyEquipment, rerollsFor, kUnlocked,
  kRerollCost, quirkStrikeK, quirkHitBonus, applySlump, loadedFace,
} from '../src/bnb/engine.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.error('FAIL:', msg); } else console.log('ok:', msg); };

// --- gear counts by slot ---
const bySlot = { equipment: 0, perk: 0, quirk: 0 };
for (const g of Object.values(GEAR)) bySlot[g.type]++;
console.log('gear counts', bySlot, 'total', Object.values(GEAR).length);
ok(Object.values(GEAR).length === 20, '20 gear items total (was 10, +10 new)');
for (const g of Object.values(GEAR)) ok(!!SLOT_SHAPE[g.type], `${g.id} has valid slot type`);

// --- CPU opponents only reference existing gear ---
for (const o of OPPONENTS) {
  for (const gid of [o.gear.eq, o.gear.perk, o.gear.quirk]) {
    if (gid) ok(!!GEAR[gid], `${o.team} gear ${gid} exists`);
  }
  ok(cpuScenarios(o).length >= 3, `${o.team} has CPU scenarios`);
}

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

// --- new equipment ---
let r = applyEquipment(['K', 'BAT', 'BAT', 'RUN', 'EYE'], 'SHADES');
ok(r.faces[0] === 'EYE', 'SHADES converts K->EYE');
r = applyEquipment(['EYE', 'BAT', 'BAT', 'RUN', 'K'], 'DONUT');
ok(r.faces[0] === 'POW', 'DONUT converts EYE->POW');
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
ok(sl.used && sl.outcome.bases === 3, 'SLUMP BUSTER: armed single -> triple');
sl = applySlump('slump', true, { kind: 'hit', bases: 3, label: 'TRIPLE' });
ok(sl.outcome.bases === 4, 'SLUMP BUSTER: capped at 4 bases');
sl = applySlump('slump', false, { kind: 'hit', bases: 1, label: 'SINGLE' });
ok(!sl.used && sl.outcome.bases === 1, 'SLUMP BUSTER: not armed = no effect');
sl = applySlump('slump', true, { kind: 'walk', bases: 1, label: 'WALK' });
ok(!sl.used, 'SLUMP BUSTER: walks do not consume it');
ok(loadedFace(0.2) === 'POW' && loadedFace(0.8) === 'K', 'LOADED DICE: 50/50 POW or K');
ok(quirkStrikeK('freeswing') === 2 && quirkStrikeK('loaded') === 3, 'strike limits unchanged');

// --- scenario reqs still matched by engine ---
const prof = HEROES.find(h => h.id === 'PROF');
ok(scenarioMet(prof.scenarios[1].req, ['EYE', 'EYE', 'BAT', 'POW', 'K']), 'PROF Thread the Needle matches EYE2+BAT1+POW1');
const wheels = HEROES.find(h => h.id === 'WHEELS');
ok(metScenarios(wheels.scenarios, ['RUN', 'RUN', 'RUN', 'RUN', 'RUN']).some(s => s.eff.bases === 4), 'WHEELS RUN×5 lights the inside-the-park HR');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL SMOKE CHECKS PASSED');
process.exit(fails ? 1 : 0);
