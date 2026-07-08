import DP from '../engine/dp.js';
import Dice3D, { createDiceView } from '../dice3d/index.js';

'use strict';
const $ = id => document.getElementById(id);
const rng = Math.random;
const GLYPH = { BAT: '⌁', POW: '✦', EYE: '◎', RUN: '»', K: '✕' };
const FLABEL = { BAT: 'BAT', POW: 'POW', EYE: 'EYE', RUN: 'RUN', K: '' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- persistence (memory fallback if storage unavailable) ---------- */
const store = (() => {
  let mem = null;
  const KEY = 'dicepennant_v1';
  return {
    load() {
      try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) {}
      return mem;
    },
    save(o) { mem = o; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  };
})();

let profile = store.load() || {
  wins: 0, games: 0,
  dice: { ROOKIE: 3 },
  cards: { TAR: 1, RALLY: 1 },
  lineup: ['ROOKIE', 'ROOKIE', 'ROOKIE'],
};
const saveProfile = () => store.save(profile);

/* ---------- tiny synth ---------- */
const sfx = (() => {
  let ctx = null;
  const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  function tone(f, t, dur, type, vol) {
    try {
      const c = ac(), o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(vol || .08, c.currentTime + t);
      g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime + t); o.stop(c.currentTime + t + dur + .02);
    } catch (e) {}
  }
  return {
    roll() { for (let i = 0; i < 4; i++) tone(180 + rng() * 120, i * .05, .05, 'triangle', .05); },
    hold() { tone(660, 0, .07, 'square', .05); },
    land(n) { tone(300 + n * 60, 0, .045, 'square', .06); },
    hit()  { tone(523, 0, .1); tone(784, .09, .16); },
    big()  { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .09, .22, 'square', .09)); },
    out()  { tone(140, 0, .22, 'sawtooth', .07); },
    walk() { tone(440, 0, .09); tone(554, .09, .12); },
    card() { tone(880, 0, .06, 'sine', .07); tone(1175, .06, .1, 'sine', .07); }
  };
})();

/* ---------- game state ---------- */
let G = null; // active game
let GEN = 0;  // generation token: stale async loops bail out
const FRESH = () => ({
  mode: 'cpu',              // 'cpu' | 'pvp' | 'show' | 'ace'
  inning: 1, half: 'top',   // top = AWAY bats
  score: { away: [], home: [] },
  outs: 0, bases: [false, false, false],
  batIdx: { away: 0, home: 0 },
  lineups: { away: null, home: null },
  pitcher: null,            // trait applies to HUMAN (home) side in cpu mode
  hand: [], used: {},       // card ids in hand, played flags
  // at-bat scratch
  faces: [], sel: [], rollsLeft: 0, rolled: false, clutch: false,
  picking: null,            // card id awaiting die target
  over: false, busy: false,
  juice: false, squeeze: false, crowd: false, wind: false,
  cpuFx: { glove: false, rain: false },
  // showdown / vs-the-ace (3-seat table)
  round: 0, steams: null, seatPlayP: null,
  ace: null, acePlayP: null,
});
function isTable() { return G && (G.mode === 'show' || G.mode === 'ace'); }

const dieById = id => DP.DICE[id];
const lineupDice = ids => ids.map(dieById);

function cpuLineup() {
  const w = profile.wins;
  if (w < 2) return ['ROOKIE', 'ROOKIE', 'ROOKIE'];
  if (w < 5) return pickN(['ROOKIE', 'ROOKIE', 'SPARK', 'PROF', 'JOKER'], 3);
  if (w < 8) return pickN(['SPARK', 'PROF', 'CANNON', 'SLUGGER', 'HAWK', 'PESKY', 'JOKER'], 3);
  return pickN(['CANNON', 'SLUGGER', 'HAWK', 'PESKY', 'JET', 'TANK', 'BULL'], 3);
}
function pickN(pool, n) { const p = pool.slice(); const out = []; for (let i = 0; i < n; i++) out.push(p.splice(Math.floor(rng() * p.length), 1)[0]); return out; }
function cpuPitcher() {
  if (profile.wins < 1) return DP.PITCHERS.NOBODY;
  const keys = Object.keys(DP.PITCHERS);
  return DP.PITCHERS[keys[Math.floor(rng() * keys.length)]];
}
function drawHand() {
  const pool = [];
  for (const [id, n] of Object.entries(profile.cards)) for (let i = 0; i < n; i++) pool.push(id);
  const hand = [];
  while (hand.length < 3 && pool.length) hand.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return hand;
}

/* ---------- screens ---------- */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
function refreshTitle() {}

/* ---------- board rendering ---------- */
function boardCols() { return isTable() ? 9 : Math.max(3, G.inning); }
function setBoardCols(n) {
  const tpl = `64px repeat(${n},1fr) 34px`;
  document.querySelectorAll('.boardrow, .boardhead').forEach(el => el.style.gridTemplateColumns = tpl);
  const head = $('boardHead');
  head.innerHTML = '<span></span>' + Array.from({ length: n }, (_, i) =>
    `<span>${i + 1}</span>`).join('') + '<span>R</span>';
}
function buildBoardRows() {
  $('rowThird').style.display = isTable() ? '' : 'none';
  const sides = isTable() ? ['Away', 'Third', 'Home'] : ['Away', 'Home'];
  const n = boardCols();
  setBoardCols(n);
  for (const side of sides) {
    const row = $('row' + side);
    row.querySelectorAll('.cell').forEach(c => c.remove());
    for (let i = 0; i < n; i++) { const c = document.createElement('span'); c.className = 'cell dim'; row.appendChild(c); }
    const r = document.createElement('span'); r.className = 'cell R'; r.textContent = '0'; row.appendChild(r);
  }
}
// grow the board a column when the game runs into extra innings
function ensureBoardCols() {
  const want = boardCols();
  const have = $('rowHome').querySelectorAll('.cell').length - 1; // minus R
  if (want <= have) return;
  setBoardCols(want);
  const sides = isTable() ? ['Away', 'Third', 'Home'] : ['Away', 'Home'];
  for (const side of sides) {
    const row = $('row' + side);
    const rCell = row.querySelector('.cell.R');
    for (let i = have; i < want; i++) {
      const c = document.createElement('span'); c.className = 'cell dim';
      row.insertBefore(c, rCell);
    }
  }
}
/* ---------- field animation: runners on hits, skull knock-off on outs ---------- */
const BASE_XY = [[50, 92], [92, 50], [50, 8], [8, 50], [50, 92]]; // plate→1B→2B→3B→home
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function svgEl(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
// moves: [{from:0..3, to:1..4}] from engine advance(); leg = ms per base
function animateRunners(moves, gen, leg = 240, cls = '') {
  if (REDUCED || !moves || !moves.length) return Promise.resolve();
  const svg = $('diamond');
  return Promise.all(moves.map((mv, idx) => new Promise(res => {
    const legs = [];
    for (let p = mv.from; p < mv.to; p++) legs.push([BASE_XY[p], BASE_XY[p + 1]]);
    if (!legs.length) return res();
    const c = svgEl('circle', { class: 'runner' + (cls ? ' ' + cls : ''), r: 4.2, cx: BASE_XY[mv.from][0], cy: BASE_XY[mv.from][1] });
    svg.appendChild(c);
    const t0 = performance.now() + idx * 80; // trailing runners stagger
    const dur = legs.length * leg;
    (function frame(t) {
      if (gen !== GEN) { c.remove(); return res(); }
      const e = Math.min(1, Math.max(0, (t - t0) / dur));
      const total = e * legs.length;
      const li = Math.min(legs.length - 1, total | 0), lt = total - li;
      const [a, b] = legs[li];
      c.setAttribute('cx', a[0] + (b[0] - a[0]) * lt);
      c.setAttribute('cy', a[1] + (b[1] - a[1]) * lt);
      if (e < 1) return requestAnimationFrame(frame);
      if (mv.to === 4) { c.classList.add('score'); setTimeout(() => { c.remove(); res(); }, 260); }
      else setTimeout(() => { c.remove(); res(); }, 80);
    })(performance.now());
  })));
}
function animateOut(gen) {
  if (REDUCED) return Promise.resolve();
  return new Promise(res => {
    const svg = $('diamond');
    const c = svgEl('circle', { class: 'runner dead', r: 4.2, cx: 50, cy: 92 });
    const skull = svgEl('text', { class: 'skull', x: 50, y: 84, 'text-anchor': 'middle', opacity: 0 });
    skull.textContent = '💀';
    svg.appendChild(c); svg.appendChild(skull);
    const t0 = performance.now();
    const dir = Math.random() < .5 ? -1 : 1, vx = dir * (52 + Math.random() * 24), vy0 = -80, grav = 300;
    (function frame(t) {
      if (gen !== GEN) { c.remove(); skull.remove(); return res(); }
      const s = (t - t0) / 1000;
      if (s < 0.26) { // beat: skull pops over the plate first
        skull.setAttribute('opacity', Math.min(1, s / 0.1));
        return requestAnimationFrame(frame);
      }
      const u = s - 0.26; // then the batter is launched off the field
      c.setAttribute('cx', 50 + vx * u);
      c.setAttribute('cy', 92 + vy0 * u + grav * u * u * 0.5);
      c.setAttribute('opacity', Math.max(0, 1 - u * 0.7));
      skull.setAttribute('y', 84 - u * 12);
      skull.setAttribute('opacity', Math.max(0, 1 - u * 1.3));
      if (u < 0.95) return requestAnimationFrame(frame);
      c.remove(); skull.remove(); res();
    })(performance.now());
  });
}

function renderBoard() {
  if (isTable()) return renderShowBoard();
  clearPadDots();
  ensureBoardCols();
  const n = boardCols();
  for (const side of ['away', 'home']) {
    const cells = $('row' + (side === 'away' ? 'Away' : 'Home')).querySelectorAll('.cell');
    const line = G.score[side];
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const v = line[i];
      cells[i].textContent = v == null ? '' : v;
      cells[i].classList.toggle('dim', v == null);
      if (v != null) tot += v;
    }
    cells[n].textContent = tot;
  }
  const names = { cpu: ['CPU', 'YOU'], pvp: ['PLYR 1', 'PLYR 2'] }[G.mode];
  $('tnAway').textContent = names[0]; $('tnHome').textContent = names[1];
  $('tnAway').classList.toggle('batting', G.half === 'top');
  $('tnHome').classList.toggle('batting', G.half === 'bottom');
  const ord = ['1ST', '2ND', '3RD'][G.inning - 1] || (G.inning + 'TH');
  $('innTag').textContent = (G.half === 'top' ? '▲ ' : '▼ ') + ord;
  $('outBulbs').querySelectorAll('i').forEach((b, i) => b.classList.toggle('lit', i < G.outs));
  ['pad1', 'pad2', 'pad3'].forEach((p, i) => $(p).classList.toggle('occ', G.bases[i]));
  const pt = G.pitcher;
  $('pitcherTag').innerHTML = (G.mode === 'cpu' && G.half === 'bottom' && pt && pt.mod)
    ? `ON THE MOUND: <b>${pt.name}</b> — ${pt.text}` : '';
}
function total(side) { return G.score[side].reduce((s, v) => s + (v || 0), 0); }

/* ================= SHOWDOWN / VS THE ACE (3-seat table) ================= */
const ACES = [
  { name: 'THE PROSPECT', faces: ['BAT', 'EYE', 'RUN', 'K', 'K', 'K'], fx: null, text: 'Green as the outfield grass.' },
  { name: 'THE ACE', faces: ['BAT', 'BAT', 'EYE', 'K', 'K', 'K'], fx: null, text: 'Paints the corners.' },
  { name: 'THE LEGEND', faces: ['BAT', 'BAT', 'BAT', 'RUN', 'K', 'K'], fx: null, text: 'You have heard the stories.' },
];
const ACE_FX = [
  { fx: 'burn', tag: 'SMOKE', text: "One of every batter's dice burns to K on the first roll." },
  { fx: 'nohustle', tag: 'JUNK', text: 'Nothing to run on: hustle bases are disabled.' },
  { fx: 'icewalk', tag: 'ICE', text: 'Walks never beat this arm.' },
];
function pickAce() {
  const w = profile.wins;
  const base = { ...ACES[w < 3 ? 0 : w < 8 ? 1 : 2] };
  if (w >= 2) {
    const f = ACE_FX[Math.floor(rng() * ACE_FX.length)];
    base.fx = f.fx; base.fxTag = f.tag; base.fxText = f.text;
  }
  return base;
}
function pitchName(rank) {
  if (rank <= 0) return 'WILD PITCH';
  if (rank <= 0.7) return 'CHANGEUP';
  if (rank <= 1.4) return 'FASTBALL';
  if (rank <= 2.4) return 'SLIDER';
  if (rank <= 3) return 'CURVEBALL';
  if (rank <= 4) return 'SPLITTER';
  return 'UNTOUCHABLE';
}
const SEAT_META = [
  { name: 'YOU',  cls: '',   dot: '#FFB63B', stroke: '#5a3c0c' },
  { name: 'TIDE', cls: 'tL', dot: '#6FC7B4', stroke: '#0d3b31' },
  { name: 'CLAY', cls: 'tR', dot: '#D2703E', stroke: '#3b1a0d' },
];
const seatViews = [null, null, null, null], seatChips = [false, false, false, false];
const SEAT_EL = { 1: 'seatL', 2: 'seatR', 3: 'seatT' };
function seatContainer(sn) { return $(SEAT_EL[sn]).querySelector('.seatDice'); }

function initSeatViews(seats) {
  (seats || [1, 2]).forEach(sn => {
    const cont = seatContainer(sn);
    if (seatViews[sn]) { seatViews[sn].resize(); return; }
    if (seatChips[sn]) return;
    if (USE3D) {
      const v = createDiceView({ side: true });
      if (v.init(cont)) { seatViews[sn] = v; return; }
    }
    seatChips[sn] = true;
  });
}
function chipsRender(sn, faces, ghost) {
  seatContainer(sn).innerHTML = `<div class="chips" style="opacity:${ghost ? .45 : 1}">` +
    faces.map(f => `<i class="${f === 'K' ? 'k' : 'f-' + f}">${GLYPH[f]}</i>`).join('') + '</div>';
}
function seatOutChip(sn, text, isOut) {
  if (!SEAT_EL[sn]) return;
  const el = $(SEAT_EL[sn]).querySelector('.seatOut');
  el.textContent = text || '';
  el.classList.toggle('o', !!isOut);
}
function seatGhost(sn, die) {
  if (seatViews[sn]) {
    seatViews[sn].setBatter(die); seatViews[sn].resize();
    seatViews[sn].setState({ faces: [null, null, null, null, null], sel: [], picking: false, interactive: false, ghostFaces: die.faces.slice(0, 5) });
  } else chipsRender(sn, die.faces.slice(0, 5), true);
}
async function seatRollAnim(sn, t, spinning, gen) {
  if (seatViews[sn]) {
    await seatViews[sn].roll(spinning, t.faces, () => gen === GEN);
    if (gen !== GEN) return;
    seatViews[sn].setState({ faces: t.faces, sel: [], picking: false, interactive: false });
  } else { await sleep(340); if (gen === GEN) chipsRender(sn, t.faces, false); }
}
function outcomeForFaces(faces, opts) {
  if (DP.countK(faces) >= 3) return { kind: 'out', bases: 0, label: 'STRUCK OUT' };
  return DP.resolve(faces, opts || {});
}
async function playSeat(sn, gen) {
  const t = G.steams[sn];
  const die = t.lineup[(G.round - 1) % 3];
  await sleep(500 + Math.random() * 500);
  if (gen !== GEN) return;
  t.faces = [0, 1, 2, 3, 4].map(() => die.faces[Math.floor(rng() * 6)]);
  if (G.mode === 'ace' && G.ace && G.ace.fx === 'burn') t.faces[Math.floor(rng() * 5)] = 'K';
  await seatRollAnim(sn, t, [true, true, true, true, true], gen);
  if (gen !== GEN) return;
  if (DP.countK(t.faces) < 3) {
    const keep = DP.greedyKeep(t.faces);
    const sel = t.faces.map((f, i) => f !== 'K' && !keep[i]);
    if (sel.some(Boolean)) {
      await sleep(420 + Math.random() * 300);
      if (gen !== GEN) return;
      t.faces = t.faces.map((f, i) => sel[i] ? die.faces[Math.floor(rng() * 6)] : f);
      await seatRollAnim(sn, t, sel, gen);
      if (gen !== GEN) return;
    }
  }
  t.outcome = outcomeForFaces(t.faces, tableOpts());
  seatOutChip(sn, t.outcome.kind === 'out' ? 'OUT' : t.outcome.label, t.outcome.kind === 'out');
}

async function playAce(gen) {
  const a = G.ace;
  const die = { id: 'ACE', name: a.name, faces: a.faces };
  seatGhost(3, die);
  seatOutChip(3, '');
  await sleep(300);
  if (gen !== GEN) return;
  a.hand = [0, 1, 2, 3, 4].map(() => a.faces[Math.floor(rng() * 6)]);
  await seatRollAnim(3, { faces: a.hand }, [true, true, true, true, true], gen);
  if (gen !== GEN) return;
  if (DP.countK(a.hand) < 3) {
    const keep = DP.greedyKeep(a.hand);
    const sel = a.hand.map((f, i) => f !== 'K' && !keep[i]);
    if (sel.some(Boolean)) {
      await sleep(320);
      if (gen !== GEN) return;
      a.hand = a.hand.map((f, i) => sel[i] ? a.faces[Math.floor(rng() * 6)] : f);
      await seatRollAnim(3, { faces: a.hand }, sel, gen);
      if (gen !== GEN) return;
    }
  }
  a.outcome = outcomeForFaces(a.hand, {});
  a.rank = DP.rankOutcome(a.outcome);
  seatOutChip(3, `${pitchName(a.rank)} — BEAT ${a.rank <= 0 ? 'ANYTHING' : a.outcome.kind === 'walk' ? 'A WALK' : a.outcome.label}`,
    a.rank <= 0);
}

const PADC = [[92, 50], [50, 8], [8, 50]];
function clearPadDots() { const g = $('padDots'); if (g) g.remove(); }
function renderPadDots(excludeSeat) {
  clearPadDots();
  if (!isTable() || !G.steams) return;
  const ex = Array.isArray(excludeSeat) ? excludeSeat : [excludeSeat];
  const g = svgEl('g', { id: 'padDots' });
  const OFF = [[0, 4.8], [-4.8, -2.8], [4.8, -2.8]];
  G.steams.forEach((t, sn) => {
    if (ex.includes(sn)) return;
    t.bases.forEach((occ, b) => {
      if (!occ) return;
      g.appendChild(svgEl('circle', { class: 'padDot', r: 2.5,
        cx: PADC[b][0] + OFF[sn][0], cy: PADC[b][1] + OFF[sn][1],
        fill: SEAT_META[sn].dot, stroke: SEAT_META[sn].stroke }));
    });
  });
  $('diamond').appendChild(g);
}
function renderShowBoard() {
  const rows = [['Home', 0], ['Away', 1], ['Third', 2]];
  for (const [row, sn] of rows) {
    const cells = $('row' + row).querySelectorAll('.cell');
    const line = G.steams[sn].line;
    let tot = 0;
    for (let i = 0; i < 9; i++) {
      const v = line[i];
      cells[i].textContent = v == null ? '' : v;
      cells[i].classList.toggle('dim', v == null);
      if (v != null) tot += v;
    }
    cells[9].textContent = tot;
  }
  $('tnAway').textContent = 'TIDE'; $('tnThird').textContent = 'CLAY'; $('tnHome').textContent = 'YOU';
  $('tnAway').classList.remove('batting'); $('tnHome').classList.remove('batting'); $('tnThird').classList.remove('batting');
  $('innTag').textContent = 'ROUND ' + Math.max(1, G.round) + ' / 9';
  ['pad1', 'pad2', 'pad3'].forEach(p => $(p).classList.remove('occ'));
  renderPadDots(-1);
  $('pitcherTag').innerHTML = (G.mode === 'ace' && G.ace && G.ace.fx)
    ? `ON THE MOUND: <b>${G.ace.name}</b> — ${G.ace.fxText}` : '';
}

function startRound() {
  G.round++;
  G.half = 'bottom';
  G.batIdx.home = G.round - 1;
  G.steams.forEach(t => { t.outcome = null; });
  seatOutChip(1, ''); seatOutChip(2, '');
  const gen = GEN;
  seatGhost(1, G.steams[1].lineup[(G.round - 1) % 3]);
  seatGhost(2, G.steams[2].lineup[(G.round - 1) % 3]);
  G.acePlayP = G.mode === 'ace' ? playAce(gen) : Promise.resolve();
  G.seatPlayP = Promise.all([playSeat(1, gen), playSeat(2, gen)]);
  startAtBat();
}
async function showdownSettle(outcome) {
  const gen = GEN;
  G.busy = true; G.picking = null;
  $('rollBtn').disabled = true; $('bankBtn').disabled = true;
  renderDice(false); renderPreview();
  G.steams[0].outcome = outcome;
  seatOutChip(0, '');
  marquee('SHOWDOWN…');
  await (G.seatPlayP || Promise.resolve());
  if (gen !== GEN) return;
  await sleep(500);
  if (gen !== GEN) return;
  await (G.acePlayP || Promise.resolve());
  if (gen !== GEN) return;
  const rankOf = t => {
    let r = DP.rankOutcome(t.outcome);
    if (G.mode === 'ace' && G.ace.fx === 'icewalk' && t.outcome && t.outcome.kind === 'walk') r = 0;
    return r;
  };
  const ranks = G.steams.map(rankOf);
  const r0 = G.round - 1;
  if (G.mode === 'ace') {
    G.steams.forEach(t => { t.line[r0] = 0; });
    const bar = G.ace.rank;
    const winners2 = ranks.map((r, i) => [r, i]).filter(x => x[0] > bar).map(x => x[1]);
    if (!winners2.length) {
      marquee(`${G.ace.name} DEALS — SIDE RETIRED`, true); sfx.out(); animateOut(gen);
    } else {
      let bestRuns = 0, lines = [];
      const allMoves = [];
      for (const w2 of winners2) {
        const t = G.steams[w2];
        const adv = DP.advance(t.bases, t.outcome);
        t.bases = adv.bases;
        t.line[r0] = adv.runs;
        bestRuns = Math.max(bestRuns, adv.runs);
        lines.push(`${t.name} ${t.outcome.label}`);
        allMoves.push([adv.moves, SEAT_META[w2].cls]);
      }
      if (bestRuns || winners2.some(w2 => G.steams[w2].outcome.bases === 4)) sfx.big(); else sfx.hit();
      marquee(lines.join(' · '));
      renderPadDots(winners2);
      Promise.all(allMoves.map(([m, c]) => animateRunners(m, gen, 240, c)))
        .then(() => { if (gen === GEN) renderPadDots(-1); });
    }
    setTimeout(() => { if (gen === GEN) renderBoard(); }, 650);
    await sleep(1650);
    if (gen !== GEN) return;
    G.busy = false;
    if (G.round >= 9) return endShowdown();
    return startRound();
  }
  const top = Math.max(...ranks);
  const winners = ranks.map((r, i) => [r, i]).filter(x => x[0] === top).map(x => x[1]);
  G.steams.forEach(t => { t.line[r0] = 0; });
  if (top === 0) {
    marquee('ALL BUST', true); sfx.out(); animateOut(gen);
  } else if (winners.length > 1) {
    marquee('STAND-OFF — NO PLAY', true); sfx.out();
  } else {
    const w = winners[0], t = G.steams[w], o = t.outcome;
    const adv = DP.advance(t.bases, o);
    t.bases = adv.bases;
    t.line[r0] = adv.runs;
    if (o.bases === 4) sfx.big(); else if (o.kind === 'walk') sfx.walk(); else sfx.hit();
    marquee(`${t.name} — ${o.label}${adv.runs ? ` · ${adv.runs} IN!` : ''}`, false);
    renderPadDots(w);
    animateRunners(adv.moves, gen, 240, SEAT_META[w].cls).then(() => { if (gen === GEN) renderPadDots(-1); });
  }
  setTimeout(() => { if (gen === GEN) renderBoard(); }, top === 0 || winners.length > 1 ? 200 : 650);
  await sleep(1650);
  if (gen !== GEN) return;
  G.busy = false;
  if (G.round >= 9) return endShowdown();
  startRound();
}
function endShowdown() {
  G.over = true;
  const totals = G.steams.map(t => t.line.reduce((a, v) => a + (v || 0), 0));
  const best = Math.max(...totals);
  const winners = totals.map((v, i) => [v, i]).filter(x => x[0] === best).map(x => x[1]);
  const t = $('endTitle');
  profile.games++;
  const youWin = winners.length === 1 && winners[0] === 0;
  if (youWin) { profile.wins++; }
  saveProfile();
  if (winners.length > 1) { t.textContent = 'SPLIT POT — DRAW'; t.className = 'win'; }
  else if (youWin) { t.textContent = 'YOU TAKE THE TABLE'; t.className = 'win'; }
  else { t.textContent = `${G.steams[winners[0]].name} TAKES THE TABLE`; t.className = 'loss'; }
  if (G.mode === 'ace' && totals.every(v => v === 0)) { t.textContent = `${G.ace.name} THROWS A NO-HITTER`; t.className = 'loss'; }
  $('endSub').textContent = `YOU ${totals[0]} · TIDE ${totals[1]} · CLAY ${totals[2]}`;
  $('packZone').innerHTML = '';
  if (youWin) offerPack();
  setTimeout(() => $('endOverlay').classList.add('on'), 900);
}

/* ---------- marquee ---------- */
function marquee(text, isOut) {
  const m = $('marqueeText');
  m.textContent = text;
  m.classList.toggle('out', !!isOut);
  m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
}

/* ---------- dice UI ---------- */
let USE3D = false;
let dice3dReady = false;
function initDice3D() {
  if (dice3dReady) return USE3D;
  dice3dReady = true;
  USE3D = Dice3D.init($('diceRow'));
  stampBuild();
  if (USE3D) {
    Dice3D.onTap(onDieTap);
    Dice3D.onFail((e) => {
      USE3D = false;
      window.__DP_DIAG = '3D dice disabled: ' + (e && e.message);
      try { console.warn('[DICE PENNANT]', window.__DP_DIAG); } catch (_) {}
      stampBuild('fallback');
      renderDice(!G.busy && isHumanHalf());
    });
  }
  return USE3D;
}
function renderDice(interactive) {
  const ghosts = (!G.rolled && G.faces.length && !G.over)
    ? currentBatterDie().faces.slice(0, 5) : null;
  if (USE3D) {
    Dice3D.setState({ faces: G.faces, sel: G.sel, picking: G.picking != null, interactive, ghostFaces: ghosts });
    return;
  }
  const row = $('diceRow'); row.innerHTML = '';
  if (!G.faces.length || G.faces.every(f => f == null)) {
    if (!ghosts) return;
    ghosts.forEach(f => {
      const b = document.createElement('button');
      b.className = 'die ghost f-' + f;
      b.disabled = true;
      b.innerHTML = `<span class="g">${GLYPH[f]}</span><span class="l">${FLABEL[f]}</span>`;
      row.appendChild(b);
    });
    return;
  }
  G.faces.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'die f-' + f + (f === 'K' ? ' k' : '') + (G.sel[i] && f !== 'K' ? ' sel' : '') + (G.picking != null ? ' picking' : '');
    b.innerHTML = `<span class="g">${GLYPH[f]}</span><span class="l">${FLABEL[f]}</span>`;
    b.disabled = !interactive;
    b.onclick = () => onDieTap(i);
    row.appendChild(b);
  });
}
function renderRollPips() {
  $('rollPips').innerHTML = '';
  for (let i = 0; i < Math.max(G.rollsLeft, 0); i++) { const p = document.createElement('i'); p.className = 'on'; $('rollPips').appendChild(p); }
}
function currentOutcome() {
  const opts = pitchOpts();
  if (DP.countK(G.faces) >= 3) return { kind: 'out', bases: 0, label: 'STRUCK OUT' };
  return DP.resolve(G.faces, opts);
}
function tableOpts() {
  const o = {};
  if (G.mode === 'ace' && G.ace && G.ace.fx === 'nohustle') o.noHustle = true;
  return o;
}
function pitchOpts() {
  const opts = Object.assign({}, tableOpts());
  if (G.wind) opts.wind = true;
  if (G.mode === 'cpu' && G.half === 'bottom' && G.pitcher) {
    if (G.pitcher.mod === 'nohustle') opts.noHustle = true;
    if (G.pitcher.mod === 'coldeye' && G.outs === 2) opts.coldEye = true;
  }
  return opts;
}
function renderPreview() {
  if (!G.rolled) { $('preview').innerHTML = ''; return; }
  const o = currentOutcome();
  const k = DP.countK(G.faces);
  const hint = G.rollsLeft > 0 ? ` <span style="color:var(--chalk-dim)">· tap dice to reroll</span>` : '';
  if (o.kind === 'out') $('preview').innerHTML = k >= 3 ? '' : `showing: <b style="color:var(--out)">OUT</b>${k === 2 ? ' · ⚠ 2 STRIKES' : ''}${hint}`;
  else $('preview').innerHTML = `showing: <b>${o.label}${o.extra ? ' +HUSTLE' : ''}</b>${hint}`;
}
function renderHand() {
  const row = $('handRow'); row.innerHTML = '';
  if (G.mode === 'pvp') return;
  G.hand.forEach((cid, idx) => {
    if (G.used[idx]) return;
    const c = DP.CARDS[cid];
    const b = document.createElement('button');
    b.className = 'cardchip' + (G.picking === idx ? ' armed' : '');
    b.innerHTML = `${c.name}<small>${c.text}</small>`;
    b.disabled = !cardLegal(cid);
    b.onclick = () => playCard(idx);
    row.appendChild(b);
  });
}
function cardLegal(cid) {
  if (!isHumanHalf() || G.busy || G.over) return false;
  if (cid === 'RALLY' || cid === 'THIEF' || cid === 'SQZ') return G.bases.some(Boolean);
  if (cid === 'GLOVE') return G.mode === 'cpu' && !G.cpuFx.glove;
  if (cid === 'RAIN') return G.mode === 'cpu' && !G.cpuFx.rain;
  if (cid === 'BATBOY') return Object.values(profile.cards).some(n => n > 0) && G.hand.length < 6;
  if (cid === 'HEAT' || cid === 'ROSIN') return G.rolled && DP.countK(G.faces) >= 1 && DP.countK(G.faces) < 3;
  if (cid === 'TAR' || cid === 'CLUTCH' || cid === 'JUICE' || cid === 'WIND' || cid === 'CROWD') return G.rolled;
  return G.rolled; // CORK, SIGN need dice on table
}

/* ---------- at-bat flow ---------- */
function isHumanHalf() {
  if (G.mode === 'pvp' || isTable()) return true;
  return G.half === 'bottom';
}
function currentLineup() { return G.half === 'top' ? G.lineups.away : G.lineups.home; }
function currentBatterDie() {
  const side = G.half === 'top' ? 'away' : 'home';
  return currentLineup()[G.batIdx[side] % 3];
}

function startAtBat() {
  G.faces = []; G.sel = [false, false, false, false, false];
  G.rollsLeft = 1; G.rolled = false; G.clutch = false; G.picking = null;
  G.juice = false; G.squeeze = false; G.crowd = false; G.wind = false;
  const die = currentBatterDie();
  const side = G.half === 'top' ? 'away' : 'home';
  $('batterTag').innerHTML = `NOW BATTING: <b>${die.name.toUpperCase()}</b>`;
  $('rollBtn').disabled = false; $('bankBtn').disabled = true;
  $('rollBtn').firstChild.textContent = 'ROLL';
  G.faces = [null, null, null, null, null];
  if (USE3D) { Dice3D.setBatter(die); Dice3D.resize(); }
  renderDice(false);
  renderRollPips(); renderPreview(); renderHand(); renderBoard();
}

function rollFaces(first) {
  const die = currentBatterDie();
  const burn = first && (
    (G.mode === 'cpu' && G.half === 'bottom' && G.pitcher && G.pitcher.mod === 'burnlead' && G._leadoffPending) ||
    (G.mode === 'ace' && G.ace && G.ace.fx === 'burn')
  );
  G.faces = G.faces.map((f, i) => {
    if (!first && (!G.sel[i] || f === 'K')) return f;
    return die.faces[Math.floor(rng() * 6)];
  });
  if (burn) {
    G.faces[Math.floor(rng() * 5)] = 'K';
    if (G.mode === 'cpu') G._leadoffPending = false;
    marquee('HIGH HEAT!', true);
  }
}

async function onRoll() {
  if (G.busy || G.over) return;
  G.busy = true;
  const myGen = GEN;
  sfx.roll();
  const first = !G.rolled;
  const spinning = G.faces.map((f, i) => first ? true : (G.sel[i] && f !== 'K'));
  rollFaces(first);
  if (first) G.rolled = true; else { G.rollsLeft--; G.sel = [false, false, false, false, false]; }
  await animateRoll(spinning, myGen);
  if (myGen !== GEN) return;
  G.busy = false;
  afterRoll();
}

/* tumble spinning dice through random faces, stop them left-to-right with a bounce */
function animateRoll(spinning, myGen) {
  if (USE3D) {
    renderDice(false);
    return Dice3D.roll(spinning, G.faces, () => myGen === GEN, n => sfx.land(n));
  }
  renderDice(false);
  const die = currentBatterDie();
  const els = [...document.querySelectorAll('#diceRow .die')];
  const stops = [];
  let order = 0;
  els.forEach((el, i) => {
    if (!spinning[i]) return;
    const finalF = G.faces[i];
    const g = el.querySelector('.g'), l = el.querySelector('.l');
    el.className = 'die rolling' + (order % 2 ? ' alt' : '');
    const iv = setInterval(() => {
      const f = die.faces[(Math.random() * 6) | 0];
      g.textContent = GLYPH[f]; l.textContent = FLABEL[f];
    }, 70);
    const stopAt = 330 + order * 95 + ((Math.random() * 50) | 0);
    const n = order; order++;
    stops.push(new Promise(done => setTimeout(() => {
      clearInterval(iv);
      if (myGen !== GEN) return done();
      el.className = 'die landing f-' + finalF + (finalF === 'K' ? ' k' : '');
      g.textContent = GLYPH[finalF]; l.textContent = FLABEL[finalF];
      sfx.land(n);
      done();
    }, stopAt)));
  });
  if (!stops.length) return sleep(200);
  return Promise.all(stops).then(() => sleep(300));
}

function afterRoll() {
  const k = DP.countK(G.faces);
  if (k >= 3) { renderDice(false); renderRollPips(); return settle({ kind: 'out', bases: 0, label: 'STRUCK OUT' }); }
  const o = currentOutcome();
  const canReroll = G.rollsLeft > 0;
  renderDice(canReroll); renderRollPips(); renderPreview(); renderHand();
  $('rollBtn').firstChild.textContent = 'REROLL';
  updateRollBtn();
  $('bankBtn').disabled = false;
  if (!canReroll && !G.picking) {
    // no choices left unless a card can still be played; auto-settle if hand empty/illegal
    const anyCard = G.mode === 'cpu' && G.hand.some((c, i) => !G.used[i] && cardLegal(c));
    if (!anyCard) return settle(o);
  }
}

function updateRollBtn() {
  if (!G.rolled) return;
  $('rollBtn').disabled = !(G.rollsLeft > 0 && G.sel.some(Boolean));
}
function onDieTap(i) {
  if (G.busy || !G.rolled) return;
  if (G.picking != null) {
    const cid = G.hand[G.picking];
    if (cid === 'HEAT') {
      if (G.faces[i] !== 'K') return; // argue a strike call, nothing else
      G.used[G.picking] = true; G.picking = null;
      sfx.card();
      const die = currentBatterDie();
      G.faces[i] = die.faces[Math.floor(rng() * 6)];
      marquee('CALL OVERTURNED!');
      const spinning = G.faces.map((_, j) => j === i);
      (async () => {
        const myGen = GEN;
        G.busy = true;
        await animateRoll(spinning, myGen);
        if (myGen !== GEN) return;
        G.busy = false;
        afterRoll();
      })();
      return;
    }
    G.faces[i] = cid === 'CORK' ? 'POW' : 'BAT';
    G.used[G.picking] = true; G.picking = null;
    sfx.card();
    marquee(cid === 'CORK' ? 'CORKED!' : 'GOT THE SIGN!');
    return afterRoll();
  }
  if (G.faces[i] === 'K' || G.rollsLeft <= 0) return;
  G.sel[i] = !G.sel[i];
  sfx.hold();
  renderDice(true);
  updateRollBtn();
}

function playCard(idx) {
  const cid = G.hand[idx];
  if (!cardLegal(cid)) return;
  if (cid === 'CORK' || cid === 'SIGN' || cid === 'HEAT') {
    G.picking = G.picking === idx ? null : idx;
    renderHand(); renderDice(true);
    return;
  }
  G.used[idx] = true;
  sfx.card();
  if (cid === 'TAR') { G.rollsLeft++; marquee('PINE TAR!'); afterRoll(); }
  if (cid === 'RALLY') {
    // runners only (no batter): shift one base
    const old = G.bases.slice();
    const nb = [false, G.bases[0], G.bases[1]]; const runs = G.bases[2] ? 1 : 0;
    G.bases = nb; addRuns(runs); marquee('RALLY CAPS ON!');
    const moves = [];
    old.forEach((occ, i) => { if (occ) moves.push({ from: i + 1, to: i + 2 }); });
    ['pad1', 'pad2', 'pad3'].forEach(p => $(p).classList.remove('occ'));
    animateRunners(moves, GEN).then(() => renderBoard());
    renderHand();
    if (checkWalkoff()) return;
  }
  if (cid === 'CLUTCH') { G.clutch = true; marquee('CLUTCH GENE!'); renderHand(); }
  if (cid === 'JUICE') { G.juice = true; marquee('JUICED BALL!'); renderHand(); }
  if (cid === 'WIND') { G.wind = true; marquee('TAILWIND!'); renderHand(); renderPreview(); }
  if (cid === 'CROWD') { G.crowd = true; marquee('RALLY TOWELS OUT!'); renderHand(); }
  if (cid === 'SQZ') { G.squeeze = true; marquee('SQUEEZE IS ON!'); renderHand(); }
  if (cid === 'GLOVE') { G.cpuFx.glove = true; marquee('GOLD GLOVE READY 🧤'); renderHand(); }
  if (cid === 'RAIN') { G.cpuFx.rain = true; marquee('RAIN CLOUDS GATHER…'); renderHand(); }
  if (cid === 'THIEF') {
    const lead = G.bases[2] ? 2 : G.bases[1] ? 1 : 0;
    const old = G.bases.slice();
    G.bases[lead] = false;
    let runs = 0;
    if (lead === 2) runs = 1; else G.bases[lead + 1] = true;
    addRuns(runs);
    marquee(runs ? 'STEALS HOME!' : 'STOLEN BASE!');
    ['pad1', 'pad2', 'pad3'].forEach(p => $(p).classList.remove('occ'));
    animateRunners([{ from: lead + 1, to: lead + 2 }], GEN).then(() => renderBoard());
    renderHand();
    if (checkWalkoff()) return;
  }
  if (cid === 'ROSIN') {
    const spinning = G.faces.map(f => f === 'K');
    const die = currentBatterDie();
    G.faces = G.faces.map((f, i) => spinning[i] ? die.faces[Math.floor(rng() * 6)] : f);
    marquee('ROSIN BAG!');
    renderHand();
    (async () => {
      const myGen = GEN;
      G.busy = true;
      await animateRoll(spinning, myGen);
      if (myGen !== GEN) return;
      G.busy = false;
      afterRoll();
    })();
  }
  if (cid === 'BATBOY') {
    const pool = [];
    for (const [id2, n] of Object.entries(profile.cards)) for (let i = 0; i < n; i++) if (id2 !== 'BATBOY') pool.push(id2);
    if (pool.length) {
      const pick = pool[Math.floor(rng() * pool.length)];
      G.hand.push(pick);
      marquee(`BATBOY BRINGS: ${DP.CARDS[pick].name.toUpperCase()}!`);
    } else marquee('BATBOY FINDS NOTHING…');
    renderHand();
  }
}

function onBank() {
  if (G.busy || !G.rolled || G.over) return;
  settle(currentOutcome());
}

function addRuns(n) {
  if (!n) return;
  const side = G.half === 'top' ? 'away' : 'home';
  const i = G.inning - 1;
  G.score[side][i] = (G.score[side][i] || 0) + n;
}

async function settle(outcome) {
  if (isTable()) return showdownSettle(outcome);
  const gen = GEN;
  G.busy = true;
  $('rollBtn').disabled = true; $('bankBtn').disabled = true; G.picking = null;
  const side = G.half === 'top' ? 'away' : 'home';
  G.batIdx[side]++;
  if (outcome.kind === 'out') {
    G.outs++;
    sfx.out();
    animateOut(gen);
    if (G.squeeze && G.bases.some(Boolean)) {
      const old = G.bases.slice();
      G.bases = [false, old[0], old[1]];
      const sr = old[2] ? 1 : 0;
      addRuns(sr);
      marquee(outcome.label + ' · SQUEEZE!', true);
      const mvs = []; old.forEach((occ, i) => { if (occ) mvs.push({ from: i + 1, to: i + 2 }); });
      animateRunners(mvs, gen).then(() => { if (gen === GEN) renderBoard(); });
    } else marquee(outcome.label, true);
    renderBoard();
  } else {
    if (G.juice && outcome.kind === 'hit' && outcome.bases < 4) {
      outcome = { ...outcome, bases: outcome.bases + 1, label: outcome.label + ' +JUICE' };
    }
    const r = DP.advance(G.bases, outcome);
    let runs = r.runs;
    if (G.clutch && runs) { runs *= 2; }
    if (G.crowd && runs) { runs += 1; }
    G.bases = r.bases;
    addRuns(runs);
    if (outcome.bases === 4) sfx.big(); else if (outcome.kind === 'walk') sfx.walk(); else sfx.hit();
    marquee(outcome.label + (G.clutch && runs ? ' ×2!' : '') + (runs ? ` · ${runs} IN!` : ''));
    // pads + line score light up when the runners actually arrive
    ['pad1', 'pad2', 'pad3'].forEach(p => $(p).classList.remove('occ'));
    animateRunners(r.moves, gen).then(() => { if (gen === GEN) renderBoard(); });
  }
  renderHand(); renderPreview();
  await sleep(1050);
  if (gen !== GEN) return;
  G.busy = false;
  if (checkWalkoff()) return;
  if (G.outs >= 3) return endHalf();
  nextBatter();
}

function checkWalkoff() {
  // bottom of final (or extra) inning: home takes lead = game over
  if (G.half === 'bottom' && G.inning >= 3 && total('home') > total('away')) {
    marquee('WALK-OFF!');
    return endGame(), true;
  }
  return false;
}

function nextBatter() {
  if (isHumanHalf()) startAtBat();
  else cpuHalfStep();
}

async function endHalf() {
  const gen = GEN;
  const side = G.half === 'top' ? 'away' : 'home';
  if (G.score[side][G.inning - 1] == null) G.score[side][G.inning - 1] = 0;
  G.outs = 0; G.bases = [false, false, false];
  if (G.half === 'top') {
    // skip bottom of final inning if home already leads
    if (G.inning >= 3 && total('home') > total('away')) return endGame();
    G.half = 'bottom';
    G._leadoffPending = true;
  } else {
    if (G.inning >= 3 && total('home') !== total('away')) return endGame();
    if (G.inning >= 9) return endGame(); // called on darkness
    G.inning++; G.half = 'top';
  }
  renderBoard();
  await sleep(500);
  if (gen !== GEN) return;
  beginHalf();
}

function beginHalf() {
  if (G.mode === 'pvp') {
    $('handoffSub').textContent = (G.half === 'top' ? 'PLAYER 1' : 'PLAYER 2') + ' — grab the dice.';
    $('handoffOverlay').classList.add('on');
    return;
  }
  if (isHumanHalf()) { $('ticker').classList.remove('on'); startAtBat(); }
  else cpuHalfIntro();
}

/* ---------- CPU offense (compressed) ---------- */
async function cpuHalfIntro() {
  const gen = GEN;
  $('ticker').classList.add('on');
  $('batterTag').textContent = ''; $('preview').innerHTML = ''; $('handRow').innerHTML = '';
  G.faces = [null, null, null, null, null]; G.sel = [false, false, false, false, false]; G.rolled = false;
  if (USE3D) Dice3D.setBatter(currentBatterDie());
  renderDice(false);
  $('rollBtn').disabled = true; $('bankBtn').disabled = true; renderRollPips();
  $('tickerLine').innerHTML = 'CPU AT THE PLATE…';
  await sleep(600);
  if (gen !== GEN) return;
  cpuHalfStep();
}
async function cpuHalfStep() {
  const gen = GEN;
  if (G.over) return;
  const die = currentBatterDie();
  let o = DP.playAtBat(die, rng, {});
  G.batIdx.away++;
  if (o.kind !== 'out' && G.cpuFx.glove) {
    G.cpuFx.glove = false;
    o = { kind: 'out', bases: 0, label: 'ROBBED! 🧤' };
  }
  let line;
  if (o.kind === 'out') { G.outs++; animateOut(gen); line = `${die.name} — <b class="o">${o.label}</b>`; }
  else {
    const r = DP.advance(G.bases, o);
    G.bases = r.bases; addRuns(r.runs);
    ['pad1', 'pad2', 'pad3'].forEach(p => $(p).classList.remove('occ'));
    animateRunners(r.moves, gen, 150).then(() => { if (gen === GEN) renderBoard(); });
    line = `${die.name} — <b>${o.label}${r.runs ? ` · ${r.runs} IN` : ''}</b>`;
  }
  $('tickerLine').innerHTML = line;
  if (USE3D) Dice3D.setBatter(currentBatterDie());
  renderDice(false);
  renderBoard();
  await sleep(820);
  if (gen !== GEN || G.over) return;
  const outLimit = G.cpuFx.rain ? 2 : 3;
  if (G.outs >= outLimit) {
    if (G.cpuFx.rain) { G.cpuFx.rain = false; marquee('RAIN DELAY — HALF CALLED', true); }
    return endHalf();
  }
  cpuHalfStep();
}

/* ---------- game start/end ---------- */
function startGame(mode) {
  GEN++;
  G = FRESH();
  G.mode = mode;
  $('gameScreen').classList.toggle('showdown', mode === 'show' || mode === 'ace');
  $('gameScreen').classList.toggle('acemode', mode === 'ace');
  show('gameScreen');
  initDice3D();
  if (mode === 'show' || mode === 'ace') {
    if (mode === 'ace') {
      G.ace = pickAce();
      $('seatT').querySelector('.seatName').textContent = G.ace.fxTag || '';
      $('seatT').querySelector('.seatOut').textContent = '';
      initSeatViews([1, 2, 3]);
    } else {
      initSeatViews([1, 2]);
    }
    G.steams = SEAT_META.map((m, i) => ({
      name: m.name,
      line: Array(9).fill(null),
      bases: [false, false, false],
      lineup: i === 0 ? lineupDice(profile.lineup) : lineupDice(cpuLineup()),
      outcome: null,
    }));
    G.lineups.home = G.steams[0].lineup;
    G.lineups.away = G.steams[1].lineup;
    G.pitcher = null; G.hand = []; G.used = {};
    buildBoardRows(); renderBoard();
    $('ticker').classList.remove('on');
    $('endOverlay').classList.remove('on'); $('handoffOverlay').classList.remove('on');
    startRound();
    return;
  }
  G.lineups.home = lineupDice(profile.lineup);
  G.lineups.away = mode === 'cpu' ? lineupDice(cpuLineup()) : lineupDice(profile.lineup);
  G.pitcher = mode === 'cpu' ? cpuPitcher() : null;
  G.hand = mode === 'cpu' ? drawHand() : [];
  G.used = {};
  buildBoardRows(); renderBoard();
  $('ticker').classList.remove('on');
  $('endOverlay').classList.remove('on'); $('handoffOverlay').classList.remove('on');
  beginHalf();
}

function endGame() {
  G.over = true;
  const h = total('home'), a = total('away');
  const humanWon = G.mode === 'cpu' ? h > a : null;
  $('ticker').classList.remove('on');
  const t = $('endTitle');
  if (G.mode === 'pvp') {
    t.textContent = h === a ? 'CALLED — TIE' : (h > a ? 'PLAYER 2 WINS' : 'PLAYER 1 WINS');
    t.className = 'win';
    $('endSub').textContent = `FINAL ${a} – ${h}`;
    $('packZone').innerHTML = '';
  } else {
    profile.games++;
    if (humanWon) profile.wins++;
    saveProfile();
    t.textContent = h === a ? 'CALLED — TIE' : humanWon ? 'YOU WIN!' : 'TOUGH LOSS';
    t.className = humanWon ? 'win' : 'loss';
    $('endSub').textContent = `FINAL — CPU ${a} · YOU ${h}`;
    $('packZone').innerHTML = '';
    if (humanWon) offerPack();
  }
  setTimeout(() => $('endOverlay').classList.add('on'), 900);
  refreshTitle();
}

/* ---------- packs ---------- */
function offerPack() {
  const z = $('packZone');
  const p = document.createElement('button');
  p.className = 'pack';
  p.innerHTML = `<span class="foil">✦</span><span>WAX PACK</span><span style="font-size:11px;color:var(--chalk-dim)">TAP TO RIP</span>`;
  p.onclick = () => { sfx.big(); z.innerHTML = ''; z.appendChild(renderPull(rollPull())); saveProfile(); };
  z.appendChild(p);
}
function rollPull() {
  const firstWin = profile.wins === 1;
  const dieRoll = firstWin || rng() < 0.4;
  if (dieRoll) {
    let pool;
    if (firstWin) pool = ['SPARK', 'PROF', 'CANNON', 'SLUGGER'];
    else {
      pool = ['SPARK', 'SPARK', 'SPARK', 'PROF', 'PROF', 'PROF', 'JOKER', 'JOKER', 'JOKER',
              'HAWK', 'HAWK', 'PESKY', 'PESKY', 'CANNON', 'CANNON', 'SLUGGER', 'SLUGGER',
              'JET', 'TANK'];
      if (profile.wins >= 5) pool.push('BULL');
    }
    const id = pool[Math.floor(rng() * pool.length)];
    profile.dice[id] = (profile.dice[id] || 0) + 1;
    return { kind: 'DIE', id };
  }
  const ids = Object.keys(DP.CARDS);
  const id = ids[Math.floor(rng() * ids.length)];
  profile.cards[id] = (profile.cards[id] || 0) + 1;
  return { kind: 'CARD', id };
}
function renderPull(pull) {
  const d = document.createElement('div');
  d.className = 'reveal';
  if (pull.kind === 'DIE') {
    const die = DP.DICE[pull.id];
    d.innerHTML = `<div class="rkind">NEW PLAYER DIE</div><div class="rname">${die.name.toUpperCase()}</div>
      <div class="faces">${die.faces.map(f => `<i class="fc-${f}">${GLYPH[f]}</i>`).join('')}</div>
      <div class="rtext">${die.blurb} Set your order in the Clubhouse.</div>`;
  } else {
    const c = DP.CARDS[pull.id];
    d.innerHTML = `<div class="rkind">NEW CARD</div><div class="rname">${c.name.toUpperCase()}</div><div class="rtext">${c.text}</div>`;
  }
  return d;
}

/* ---------- collection screen ---------- */
function renderCollection() {
  const dl = $('diceList'); dl.innerHTML = '';
  for (const [id, n] of Object.entries(profile.dice)) {
    if (!n) continue;
    const die = DP.DICE[id];
    const el = document.createElement('div'); el.className = 'dcard';
    const slots = [0, 1, 2].map(s => {
      const inSlot = profile.lineup[s] === id;
      return `<button data-die="${id}" data-slot="${s}" class="${inSlot ? 'inslot' : ''}">${s + 1}</button>`;
    }).join('');
    el.innerHTML = `<div class="info"><div class="nm">${die.name} <span class="ccount">×${n}</span></div>
      <div class="bl">${die.blurb}</div>
      <div class="faces">${die.faces.map(f => `<i class="fc-${f}">${GLYPH[f]} ${FLABEL[f] || 'K'}</i>`).join('')}</div></div>
      <div class="slotbtns">${slots}</div>`;
    dl.appendChild(el);
  }
  // scouting report: every die not yet signed shows as a locked card
  for (const id of Object.keys(DP.DICE)) {
    if (profile.dice[id]) continue;
    const die = DP.DICE[id];
    const el = document.createElement('div'); el.className = 'dcard locked';
    el.innerHTML = `<div class="info"><div class="nm">${die.name} <span class="ccount">UNSIGNED</span></div>
      <div class="bl">${die.blurb}</div>
      <div class="faces">${die.faces.map(f => `<i class="fc-${f}">${GLYPH[f]} ${FLABEL[f] || 'K'}</i>`).join('')}</div></div>
      <div class="slotbtns" style="visibility:hidden"><button>1</button></div>`;
    dl.appendChild(el);
  }
  dl.querySelectorAll('.slotbtns button').forEach(b => b.onclick = () => {
    const id = b.dataset.die, s = +b.dataset.slot;
    // enforce owned copies: count uses of id in lineup if we place it
    const next = profile.lineup.slice(); next[s] = id;
    const uses = next.filter(x => x === id).length;
    if (uses > (profile.dice[id] || 0)) return marqueeToastColl(`Only own ×${profile.dice[id]}`);
    profile.lineup = next; saveProfile(); renderCollection();
  });
  const cl = $('cardList'); cl.innerHTML = '';
  for (const id of Object.keys(DP.CARDS)) {
    const c = DP.CARDS[id];
    const n = profile.cards[id] || 0;
    const el = document.createElement('div');
    el.className = 'dcard' + (n ? '' : ' locked');
    el.innerHTML = `<div class="info"><div class="nm">${c.name} <span class="ccount">${n ? '×' + n : 'NOT COLLECTED'}</span></div><div class="bl">${c.text}</div></div>`;
    cl.appendChild(el);
  }
}
function marqueeToastColl(msg) { $('collScreen').querySelector('.hint').textContent = msg; setTimeout(renderCollection, 1200); }

/* ---------- wiring ---------- */
$('playBtn').onclick = () => startGame('cpu');
$('pvpBtn').onclick = () => startGame('pvp');
$('showBtn').onclick = () => startGame('show');
$('aceBtn').onclick = () => startGame('ace');
let quitTimer = null;
$('quitBtn').onclick = () => {
  const b = $('quitBtn');
  if (!b.classList.contains('arm')) {
    b.classList.add('arm'); b.textContent = 'FORFEIT?';
    clearTimeout(quitTimer);
    quitTimer = setTimeout(() => { b.classList.remove('arm'); b.textContent = '\u2715'; }, 2000);
    return;
  }
  clearTimeout(quitTimer);
  b.classList.remove('arm'); b.textContent = '\u2715';
  GEN++;                                   // kill every pending timer/animation
  if ((G.mode === 'cpu' || G.mode === 'show' || G.mode === 'ace') && !G.over) { profile.games++; saveProfile(); }
  G.over = true;
  $('endOverlay').classList.remove('on'); $('handoffOverlay').classList.remove('on'); $('ticker').classList.remove('on');
  refreshTitle();
  show('titleScreen');
};
$('collBtn').onclick = () => { renderCollection(); show('collScreen'); };
$('collBack').onclick = () => { refreshTitle(); show('titleScreen'); };
$('rollBtn').onclick = onRoll;
$('bankBtn').onclick = onBank;
$('againBtn').onclick = () => startGame(G.mode);
$('homeBtn').onclick = () => { renderCollection(); show('collScreen'); };
$('handoffGo').onclick = () => { $('handoffOverlay').classList.remove('on'); startAtBat(); };
const BUILD = __APP_BUILD__;
function stampBuild(extra) {
  const el = $('buildTag');
  if (el) el.textContent = BUILD + ' · ' + (USE3D ? '3D DICE' : '2D DICE') + (extra ? ' · ' + extra : '');
}
setTimeout(stampBuild, 0);
refreshTitle();

/* test hooks (headless smoke) */
window.__DP_TEST = {
  get G() { return G; }, profile, startGame, onRoll, onBank, settle,
  forceFaces(f) { G.faces = f; G.rolled = true; }, total, addRuns, endHalf,
  dice3d: Dice3D, get use3d() { return USE3D; }, onDieTap, playCard, renderHand, get profile() { return profile; }, renderBoard, boardCols,
};

