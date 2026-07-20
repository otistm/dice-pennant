/* BATS-N-BASES — desktop PvE season mode. */
import { createDiceView } from '../dice3d/index.js';
import {
  GLYPH, FLABEL, SLOTS, SLOT_TINT, HEROES, GEAR, ECON, SEASON_LEN,
  OPPONENTS, cpuScenarios,
} from './data.js';
import {
  countFaces, metScenarios, baseline, applyEquipment, rerollsFor, kUnlocked,
  kRerollCost, quirkStrikeK, quirkHitBonus, applySlump, loadedFace,
  runPre, advance, greedyKeep, countK, scoreOutcome,
} from './engine.js';
import { makeGearDraggable, makeSocketTileDraggable } from './snap.js';
import { coinToss } from './coin.js';

const $ = id => document.getElementById(id);
const rng = Math.random;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- synth (mirrors the base game's) ---------- */
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
    coin(n) { for (let i = 0; i < Math.min(n || 1, 4); i++) { tone(988, i * .07, .06, 'sine', .07); tone(1319, i * .07 + .04, .08, 'sine', .06); } },
    pick() { tone(880, 0, .06, 'sine', .07); tone(1175, .06, .1, 'sine', .07); },
  };
})();

/* ---------- season persistence ---------- */
const SKEY = 'dicepennant_bnb_v1';
const sstore = {
  load() { try { const s = localStorage.getItem(SKEY); if (s) return JSON.parse(s); } catch (e) {} return null; },
  save(o) { try { localStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} },
  clear() { try { localStorage.removeItem(SKEY); } catch (e) {} },
};
let SEASON = sstore.load();
const saveSeason = () => SEASON && sstore.save(SEASON);

function restockShop() {
  const owned = SEASON ? Object.values(SEASON.equip).filter(Boolean) : [];
  const pool = Object.keys(GEAR).filter(id => !owned.includes(id));
  const out = [];
  while (out.length < ECON.shopSize && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}
function newSeason(heroId) {
  SEASON = {
    heroId, gameIdx: 0, results: [],
    budget: ECON.startBudget,
    equip: { equipment: null, perk: null, quirk: null },
  };
  SEASON.stock = restockShop();
  saveSeason();
}
const hero = () => HEROES.find(h => h.id === SEASON.heroId) || HEROES[0];
const opp = () => OPPONENTS[Math.min(SEASON.gameIdx, OPPONENTS.length - 1)];
const equippedGear = slot => SEASON.equip[slot] ? GEAR[SEASON.equip[slot]] : null;
const perkKey = () => { const g = equippedGear('perk'); return g ? g.perk : null; };
const quirkKey = () => { const g = equippedGear('quirk'); return g ? g.quirk : null; };

/* ---------- per-game state ---------- */
let B = null;
let BGEN = 0;
const FRESHB = () => ({
  inning: 1, half: 'top',
  score: { away: [], home: [] },
  outs: 0, bases: [false, false, false],
  faces: [], sel: [false, false, false, false, false],
  rollsLeft: 1, rolled: false, busy: false, over: false,
  rabbitUsed: false, leadoff: true, convNote: null, slumpArmed: false,
  youFirst: false, // coin toss: true = you bat in the top half (away team)
});
const isYourHalf = () => B && B.half === (B.youFirst ? 'top' : 'bottom');
const youSide = () => (B.youFirst ? 'away' : 'home');
const cpuSide = () => (B.youFirst ? 'home' : 'away');
const total = side => B.score[side].reduce((s, v) => s + (v || 0), 0);

/* ---------- dice views ---------- */
let youView = null, cpuView = null, you3D = false, cpu3D = false, viewsInit = false;
function initViews() {
  if (viewsInit) { if (you3D) youView.resize(); if (cpu3D) cpuView.resize(); return; }
  viewsInit = true;
  youView = createDiceView();
  you3D = youView.init($('bnbDiceRow'));
  if (you3D) {
    youView.onTap(onDieTap);
    youView.onFail(() => { you3D = false; renderDice(canInteract()); });
  }
  cpuView = createDiceView({ side: true });
  cpu3D = cpuView.init($('bnbCpuDice'));
}
const heroDieDef = () => ({ id: 'BNB_' + hero().id, name: hero().name, faces: hero().faces });
const oppDieDef = () => ({ id: 'BNB_OPP_' + opp().key, name: opp().hero.name, faces: opp().faces });

/* faces override bookkeeping (equipment conversions retexture one die) */
let youOvr = new Set(), cpuOvr = new Set();
function resetOverrides(view, is3D, ovr, def) {
  if (is3D) ovr.forEach(i => view.setDieFaces(i, def.faces));
  ovr.clear();
}
function overrideDie(view, is3D, ovr, i, face) {
  if (is3D) view.setDieFaces(i, [face, face, face, face, face, face]);
  ovr.add(i);
}

/* ---------- marquee / field ---------- */
function marquee(text, isOut) {
  const m = $('bnbMarqueeText');
  m.textContent = text;
  m.classList.toggle('out', !!isOut);
  m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
}
const BASE_XY = [[50, 92], [92, 50], [50, 8], [8, 50], [50, 92]];
function svgEl(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function animateRunners(moves, gen, leg = 240) {
  if (!moves || !moves.length) return Promise.resolve();
  const svg = $('bnbDiamond');
  return Promise.all(moves.map((mv, idx) => new Promise(res => {
    const legs = [];
    for (let p = mv.from; p < mv.to; p++) legs.push([BASE_XY[p], BASE_XY[p + 1]]);
    if (!legs.length) return res();
    const c = svgEl('circle', { class: 'runner', r: 4.2, cx: BASE_XY[mv.from][0], cy: BASE_XY[mv.from][1] });
    svg.appendChild(c);
    const t0 = performance.now() + idx * 80;
    const dur = legs.length * leg;
    (function frame(t) {
      if (gen !== BGEN) { c.remove(); return res(); }
      const e = Math.min(1, Math.max(0, (t - t0) / dur));
      const tt = e * legs.length;
      const li = Math.min(legs.length - 1, tt | 0), lt = tt - li;
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
  return new Promise(res => {
    const svg = $('bnbDiamond');
    const c = svgEl('circle', { class: 'runner dead', r: 4.2, cx: 50, cy: 92 });
    const skull = svgEl('text', { class: 'skull', x: 50, y: 84, 'text-anchor': 'middle', opacity: 0 });
    skull.textContent = '💀';
    svg.appendChild(c); svg.appendChild(skull);
    const t0 = performance.now();
    const dir = Math.random() < .5 ? -1 : 1, vx = dir * (52 + Math.random() * 24), vy0 = -80, grav = 300;
    (function frame(t) {
      if (gen !== BGEN) { c.remove(); skull.remove(); return res(); }
      const s = (t - t0) / 1000;
      if (s < 0.26) { skull.setAttribute('opacity', Math.min(1, s / 0.1)); return requestAnimationFrame(frame); }
      const u = s - 0.26;
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

/* ---------- budget ---------- */
function pay(n, why) {
  if (!n) return;
  SEASON.budget = Math.max(0, SEASON.budget + n);
  saveSeason();
  renderBudget(true);
  if (n > 0) sfx.coin(n);
  const coin = $('bnbCoin');
  const f = document.createElement('div');
  f.className = 'payFloat' + (n < 0 ? ' neg' : '');
  f.textContent = (n > 0 ? '+$' + n : '-$' + (-n)) + (why ? ' ' + why : '');
  coin.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}
function renderBudget(flash) {
  $('bnbCoinN').textContent = SEASON.budget;
  if (flash) {
    const c = $('bnbCoin');
    c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
  }
  renderShop(); // affordability dimming
}

/* ---------- screen construction ---------- */
let built = false;
function buildScreen() {
  if (built) return;
  built = true;
  const scr = document.createElement('div');
  scr.className = 'screen';
  scr.id = 'bnbScreen';
  scr.innerHTML = `
    <button id="bnbQuit" aria-label="Leave game">✕ DUGOUT</button>
    <div class="bnbTop">
      <div class="bnbSeasonTag" id="bnbSeasonTag"></div>
      <div id="bnbBoard">
        <div class="boardhead" id="bnbBoardHead"></div>
        <div class="boardrow" id="bnbRowAway"><span class="tn" id="bnbTnAway">CPU</span></div>
        <div class="boardrow" id="bnbRowHome"><span class="tn" id="bnbTnHome">YOU</span></div>
        <div id="boardFoot"><span id="bnbInnTag">▲ 1ST</span>
          <span class="outbulbs" id="bnbOutBulbs">OUT <i></i><i></i><i></i></span></div>
      </div>
      <div class="bnbBudget">
        <div class="bnbCoin" id="bnbCoin"><span class="c" id="bnbCoinN">0</span><span class="t">BUDGET</span></div>
        <div class="bnbPitchTag" id="bnbPitchTag"></div>
      </div>
    </div>
    <div class="bnbMid">
      <div class="bnbCardCol">
        <div class="bnbRoleTag" id="bnbYouRole"><b>YOU</b></div>
        <div class="cardAsm you" id="bnbYouAsm"></div>
      </div>
      <div class="bnbCenter">
        <div id="bnbDiamondWrap">
          <svg id="bnbDiamond" viewBox="0 0 100 100">
            <path class="chalkline" d="M50 92 L8 50 L50 8 L92 50 Z"/>
            <rect class="basepad" id="bnbPad1" x="86" y="44" width="12" height="12" transform="rotate(45 92 50)"/>
            <rect class="basepad" id="bnbPad2" x="44" y="2"  width="12" height="12" transform="rotate(45 50 8)"/>
            <rect class="basepad" id="bnbPad3" x="2"  y="44" width="12" height="12" transform="rotate(45 8 50)"/>
            <path class="basepad" d="M44 86 h12 v7 l-6 6 l-6 -6 Z" id="bnbPadH"/>
          </svg>
          <div id="bnbMarquee"><div id="bnbMarqueeText"></div></div>
        </div>
        <div class="bnbDiceLbl" id="bnbCpuLbl">CPU'S DICE</div>
        <div id="bnbCpuDice"></div>
        <div class="bnbDiceLbl" id="bnbYouLbl">YOUR DICE</div>
        <div id="bnbDiceRow"></div>
        <div id="bnbPreview"></div>
        <div class="bnbCtrl">
          <button class="ctl" id="bnbRollBtn">ROLL<span id="bnbRollPips"></span></button>
          <button class="ctl" id="bnbBankBtn">TAKE IT</button>
        </div>
        <div id="bnbTurnBanner"><i></i>CPU AT BAT &mdash; YOU'RE IN THE FIELD</div>
      </div>
      <div class="bnbCardCol">
        <div class="bnbRoleTag" id="bnbCpuRole"><b style="color:var(--out)">CPU</b></div>
        <div class="cardAsm cpu" id="bnbCpuAsm"></div>
      </div>
    </div>
    <div class="bnbScenarios" id="bnbScen"></div>
    <div class="bnbShop">
      <div class="bnbShopLbl">MANAGER SHOP</div>
      <div class="bnbShopRow" id="bnbShopRow"></div>
      <div class="bnbShopHint" id="bnbShopHint">Drag gear onto a slot to buy. Drag it off to sell. Restocks every game.</div>
    </div>
    <div class="overlay" id="bnbHeroOverlay">
      <h2 style="color:var(--bulb)">SIGN YOUR BALLPLAYER</h2>
      <div class="sub">One hero. Ten games. Bring home the pennant.</div>
      <div class="heroPickRow" id="bnbHeroRow"></div>
    </div>
    <div class="overlay" id="bnbGameOverlay">
      <h2 id="bnbOvTitle"></h2>
      <div class="sub" id="bnbOvSub"></div>
      <div class="bnbGameList" id="bnbOvGames"></div>
      <div class="payLines" id="bnbOvPay"></div>
      <button class="bigbtn" id="bnbOvGo">PLAY BALL</button>
      <button class="bigbtn ghost" id="bnbOvQuit">BACK TO CLUBHOUSE</button>
    </div>`;
  $('app').appendChild(scr);

  $('bnbRollBtn').onclick = onRoll;
  $('bnbBankBtn').onclick = onBank;
  $('bnbQuit').onclick = leaveMode;
  $('bnbOvQuit').onclick = () => { $('bnbGameOverlay').classList.remove('on'); leaveMode(); };
}

function leaveMode() {
  BGEN++;
  $('bnbScreen').classList.remove('cpuTurn');
  document.body.classList.remove('bnbActive');
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 'titleScreen'));
}

/* ---------- entry ---------- */
export function enterBnB() {
  buildScreen();
  document.body.classList.add('bnbActive');
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 'bnbScreen'));
  initViews();
  if (!SEASON || SEASON.done) {
    showHeroPick();
  } else {
    prepIdleScreen();
    showFrontOffice(null);
  }
}

/* light render of the field behind the front-office overlay */
function prepIdleScreen() {
  buildBoardRows();
  renderCards();
  renderShop();
  renderBudget(false);
  renderScenarios();
  renderCpuDiceIdle(true);
}

/* ---------- hero pick ---------- */
function miniCardHTML(h) {
  const c = countFaces(h.faces);
  const dom = ['POW', 'BAT', 'RUN', 'EYE'].sort((a, b) => c[b] - c[a])[0];
  return `<div class="bpCard">
    <div class="hdr"><span class="team">YOUR CLUB</span><span class="num">#${h.num}</span></div>
    <div class="nm">${h.name.toUpperCase()}</div>
    <div class="pos">${h.pos} · BALLPLAYER</div>
    <div class="portrait"><span class="g">${GLYPH[dom]}</span><span class="capNum">#${h.num}</span></div>
    <div class="facesRow">${h.faces.map(f => `<i class="fc-${f}">${GLYPH[f]}</i>`).join('')}</div>
    <div class="blurb">${h.blurb}</div>
  </div>`;
}
function showHeroPick() {
  const row = $('bnbHeroRow');
  row.innerHTML = '';
  HEROES.forEach(h => {
    const el = document.createElement('div');
    el.className = 'heroPick';
    el.innerHTML = miniCardHTML(h);
    el.onclick = () => {
      sfx.pick();
      newSeason(h.id);
      $('bnbHeroOverlay').classList.remove('on');
      showFrontOffice(null);
    };
    row.appendChild(el);
  });
  $('bnbHeroOverlay').classList.add('on');
}

/* ---------- front office (between games) ---------- */
function gameListHTML() {
  let out = '';
  for (let i = 0; i < SEASON_LEN; i++) {
    const r = SEASON.results[i];
    const cls = r === 'W' ? 'w' : r ? 'l' : (i === SEASON.gameIdx ? 'next' : '');
    out += `<i class="${cls}">${r || i + 1}</i>`;
  }
  return out;
}
function showFrontOffice(payLines) {
  const done = SEASON.gameIdx >= SEASON_LEN;
  const wins = SEASON.results.filter(r => r === 'W').length;
  const t = $('bnbOvTitle');
  if (done) {
    SEASON.done = true; saveSeason();
    const champ = wins >= 6;
    t.textContent = champ ? 'PENNANT WINNERS!' : 'SEASON OVER';
    t.className = champ ? 'win' : 'loss';
    $('bnbOvSub').textContent = `FINAL RECORD ${wins} – ${SEASON_LEN - wins}`;
    $('bnbOvGo').textContent = 'NEW SEASON';
    $('bnbOvGo').onclick = () => {
      sstore.clear(); SEASON = null;
      $('bnbGameOverlay').classList.remove('on');
      showHeroPick();
    };
  } else {
    const o = opp();
    t.textContent = payLines ? payLines.title : 'FRONT OFFICE';
    t.className = payLines ? payLines.cls : 'win';
    $('bnbOvSub').innerHTML = `GAME ${SEASON.gameIdx + 1} OF ${SEASON_LEN} — VS <b style="color:var(--bulb)">${o.team}</b><br>
      <span style="font-size:13px">${o.blurb}</span>`;
    $('bnbOvGo').textContent = 'PLAY BALL';
    $('bnbOvGo').onclick = () => { $('bnbGameOverlay').classList.remove('on'); startBnbGame(); };
  }
  $('bnbOvGames').innerHTML = gameListHTML();
  $('bnbOvPay').innerHTML = payLines
    ? payLines.lines.map(l => `<span>${l}</span>`).join('') : '';
  $('bnbGameOverlay').classList.add('on');
}

/* ---------- board ---------- */
function boardCols() { return Math.max(3, B ? B.inning : 3); }
function buildBoardRows() {
  const n = boardCols();
  const tpl = `56px repeat(${n},1fr) 34px`;
  ['bnbBoardHead', 'bnbRowAway', 'bnbRowHome'].forEach(id => $(id).style.gridTemplateColumns = tpl);
  $('bnbBoardHead').innerHTML = '<span></span>' + Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('') + '<span>R</span>';
  for (const side of ['Away', 'Home']) {
    const row = $('bnbRow' + side);
    row.querySelectorAll('.cell').forEach(c => c.remove());
    for (let i = 0; i < n; i++) { const c = document.createElement('span'); c.className = 'cell dim'; row.appendChild(c); }
    const r = document.createElement('span'); r.className = 'cell R'; r.textContent = '0'; row.appendChild(r);
  }
}
function ensureBoardCols() {
  const want = boardCols();
  const have = $('bnbRowHome').querySelectorAll('.cell').length - 1;
  if (want <= have) return;
  buildBoardRowsPreserve(want, have);
}
function buildBoardRowsPreserve(want) {
  const tpl = `56px repeat(${want},1fr) 34px`;
  ['bnbBoardHead', 'bnbRowAway', 'bnbRowHome'].forEach(id => $(id).style.gridTemplateColumns = tpl);
  $('bnbBoardHead').innerHTML = '<span></span>' + Array.from({ length: want }, (_, i) => `<span>${i + 1}</span>`).join('') + '<span>R</span>';
  for (const side of ['Away', 'Home']) {
    const row = $('bnbRow' + side);
    const rCell = row.querySelector('.cell.R');
    const have = row.querySelectorAll('.cell').length - 1;
    for (let i = have; i < want; i++) {
      const c = document.createElement('span'); c.className = 'cell dim';
      row.insertBefore(c, rCell);
    }
  }
}
function renderBoard() {
  ensureBoardCols();
  const n = boardCols();
  for (const side of ['away', 'home']) {
    const cells = $('bnbRow' + (side === 'away' ? 'Away' : 'Home')).querySelectorAll('.cell');
    const line = B.score[side];
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const v = line[i];
      cells[i].textContent = v == null ? '' : v;
      cells[i].classList.toggle('dim', v == null);
      if (v != null) tot += v;
    }
    cells[n].textContent = tot;
  }
  const oppName = opp().team.split(' ')[0];
  $('bnbTnAway').textContent = B.youFirst ? 'YOU' : oppName;
  $('bnbTnHome').textContent = B.youFirst ? oppName : 'YOU';
  $('bnbTnAway').classList.toggle('batting', B.half === 'top');
  $('bnbTnHome').classList.toggle('batting', B.half === 'bottom');
  const ord = ['1ST', '2ND', '3RD'][B.inning - 1] || (B.inning + 'TH');
  $('bnbInnTag').textContent = (B.half === 'top' ? '▲ ' : '▼ ') + ord;
  $('bnbOutBulbs').querySelectorAll('i').forEach((b, i) => b.classList.toggle('lit', i < B.outs));
  ['bnbPad1', 'bnbPad2', 'bnbPad3'].forEach((p, i) => $(p).classList.toggle('occ', B.bases[i]));
  document.querySelector('#bnbYouAsm .bpCard')?.classList.toggle('batting', isYourHalf());
  document.querySelector('#bnbCpuAsm .bpCard')?.classList.toggle('batting', !isYourHalf());
  $('bnbSeasonTag').innerHTML = `<b>BATS-N-BASES</b> · GAME ${Math.min(SEASON.gameIdx + 1, SEASON_LEN)}/${SEASON_LEN}
    <br><span class="opp">VS ${opp().team}</span>
    <div class="bnbGameList" style="justify-content:flex-start;margin-top:4px">${gameListHTML()}</div>`;
  $('bnbPitchTag').innerHTML = opp().mod
    ? `THEIR MOUND: <b>${{ burnlead: 'FLAMETHROWER', nohustle: 'JUNKBALLER', coldeye: 'ICEMAN' }[opp().mod]}</b> — ${
        helmetOn() ? '<b style="color:var(--grass)">blocked by your Rally Helmet</b>'
        : { burnlead: 'your leadoff batter each inning has one die burned to ✕',
            nohustle: 'RUN faces grant no extra bases',
            coldeye: 'with 2 outs your ◎ faces count as ✕' }[opp().mod]}` : '';
}

/* ---------- cards + sockets ---------- */
function gearTileHTML(g, side, opts = {}) {
  return `<div class="gearTile ${g.type}${side === 'cpu' ? ' cpuSide' : ''}" data-gear="${g.id}"
      role="button" aria-label="GEAR ${g.name}">
    ${opts.cost ? `<span class="cost">${g.cost}</span>` : ''}
    <span class="gnm">${g.name.toUpperCase()}</span>
    <span class="gtx">${g.text}</span>
  </div>`;
}
function cardHTML(who) {
  const isYou = who === 'you';
  const h = isYou ? hero() : opp().hero;
  const faces = isYou ? hero().faces : opp().faces;
  const c = countFaces(faces);
  const dom = ['POW', 'BAT', 'RUN', 'EYE'].sort((a, b) => c[b] - c[a])[0];
  return `<div class="bpCard">
    <div class="hdr"><span class="team">${isYou ? 'YOUR CLUB' : opp().team}</span><span class="num">#${h.num}</span></div>
    <div class="nm">${h.name.toUpperCase()}</div>
    <div class="pos">${h.pos} · BALLPLAYER</div>
    <div class="portrait"><span class="g">${GLYPH[dom]}</span><span class="capNum">#${h.num}</span></div>
    <div class="facesRow">${faces.map(f => `<i class="fc-${f}">${GLYPH[f]}</i>`).join('')}</div>
    <div class="blurb">${isYou ? hero().blurb : opp().blurb}</div>
  </div>`;
}
function renderCards() {
  // YOU
  const yAsm = $('bnbYouAsm');
  yAsm.innerHTML = `<div class="sockRail">${SLOTS.map(s => {
    const g = equippedGear(s);
    return `<div class="socket ${s}${g ? ' filled' : ''}" data-slot="${s}" role="button" aria-label="SOCKET ${s}">
      <span class="lbl">${s.toUpperCase()}</span>
      ${g ? gearTileHTML(g, 'you') : ''}
    </div>`;
  }).join('')}</div>${cardHTML('you')}`;
  // CPU (gear pre-snapped, mirrored)
  const o = opp();
  const cpuEquip = { equipment: o.gear.eq, perk: o.gear.perk, quirk: o.gear.quirk };
  const cAsm = $('bnbCpuAsm');
  cAsm.innerHTML = `${cardHTML('cpu')}<div class="sockRail">${SLOTS.map(s => {
    const gid = cpuEquip[s];
    const g = gid ? GEAR[gid] : null;
    return `<div class="socket ${s}${g ? ' filled' : ''}" data-slot="${s}">
      <span class="lbl">${s.toUpperCase()}</span>
      ${g ? gearTileHTML(g, 'cpu') : ''}
    </div>`;
  }).join('')}</div>`;
  // drag an equipped tile out of its socket to sell it (half refund)
  yAsm.querySelectorAll('.socket .gearTile').forEach(tile => {
    const sock = tile.closest('.socket');
    makeSocketTileDraggable(tile, sock, {
      canDrag: () => !document.querySelector('#bnbGameOverlay.on, #bnbHeroOverlay.on'),
      onSell: () => {
        const g = GEAR[tile.dataset.gear];
        SEASON.equip[g.type] = null;
        pay(Math.floor(g.cost / 2), 'SOLD');
        saveSeason();
        renderCards();
        if (B) renderBoard();
      },
    });
  });
}

/* ---------- shop ---------- */
function renderShop() {
  const row = $('bnbShopRow');
  if (!row || !SEASON) return;
  row.innerHTML = '';
  (SEASON.stock || []).forEach(gid => {
    const g = GEAR[gid];
    const wrap = document.createElement('div');
    wrap.innerHTML = gearTileHTML(g, 'you', { cost: true });
    const el = wrap.firstElementChild;
    if (g.cost > SEASON.budget) el.style.opacity = .55;
    row.appendChild(el);
    makeGearDraggable(el, g.type, {
      canDrag: () => !document.querySelector('#bnbGameOverlay.on, #bnbHeroOverlay.on'),
      getSockets: type => {
        const sock = document.querySelector(`#bnbYouAsm .socket[data-slot="${type}"]`);
        return sock ? [{ el: sock, slot: type, color: SLOT_TINT[type] }] : [];
      },
      canAfford: () => SEASON.budget >= g.cost,
      onNoFunds: () => {
        marquee('NO BUDGET!', true);
      },
      onSnap: slot => {
        const old = equippedGear(slot);
        SEASON.budget -= g.cost;
        if (old) SEASON.budget += Math.floor(old.cost / 2);
        SEASON.equip[slot] = g.id;
        SEASON.stock = SEASON.stock.filter(x => x !== g.id);
        saveSeason();
        renderBudget(true);
        renderCards();
        if (B) renderBoard();
        requestAnimationFrame(() => {
          const t = document.querySelector(`#bnbYouAsm .socket[data-slot="${slot}"] .gearTile`);
          if (t) t.classList.add('justSnapped');
        });
      },
    });
  });
}

/* ---------- scenarios ---------- */
function reqChips(req) {
  let chips = '';
  for (const k of ['POW', 'BAT', 'EYE', 'RUN', 'K']) {
    for (let i = 0; i < (req[k] || 0); i++) chips += `<i class="fc-${k}">${GLYPH[k]}</i>`;
  }
  for (let i = 0; i < (req.uniq || 0); i++) chips += `<i class="fc-ANY">?</i>`;
  return chips;
}
function renderScenarios() {
  const row = $('bnbScen');
  row.innerHTML = '';
  const interactive = canInteract() && B.rolled;
  const met = interactive ? metScenarios(hero().scenarios, B.faces).map(s => s.id) : [];
  hero().scenarios.forEach(s => {
    const el = document.createElement('div');
    const isMet = met.includes(s.id);
    el.className = 'scenCard' + (isMet ? ' met' : (interactive ? ' dimmed' : ''));
    el.innerHTML = `${isMet ? '<span class="playTag">PLAY IT</span>' : ''}
      <div class="snm">${s.name}</div>
      <div class="req">${reqChips(s.req)}</div>
      <div class="stx">${s.text}</div>`;
    if (isMet) el.onclick = () => playScenario(s);
    row.appendChild(el);
  });
}

/* ---------- dice UI ---------- */
function canInteract() { return B && !B.busy && !B.over && isYourHalf(); }
function renderDice(interactive) {
  const ghosts = (!B.rolled && !B.over && isYourHalf()) ? hero().faces.slice(0, 5) : null;
  if (you3D) {
    youView.setBatter(heroDieDef());
    youView.setState({ faces: B.faces, sel: B.sel, picking: false, interactive, ghostFaces: ghosts,
      kSelectable: kUnlocked(perkKey()) });
    return;
  }
  const row = $('bnbDiceRow'); row.innerHTML = '';
  const zen = kUnlocked(perkKey());
  if (!B.faces.length || B.faces.every(f => f == null)) {
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
  B.faces.forEach((f, i) => {
    const b = document.createElement('button');
    const locked = f === 'K' && !zen;
    b.className = 'die f-' + f + (locked ? ' k' : '') + (B.sel[i] && !locked ? ' sel' : '');
    b.innerHTML = `<span class="g">${GLYPH[f]}</span><span class="l">${FLABEL[f]}</span>`;
    b.disabled = !interactive;
    b.onclick = () => onDieTap(i);
    row.appendChild(b);
  });
}
function renderCpuDiceIdle(ghost) {
  if (cpu3D) {
    cpuView.setBatter(oppDieDef());
    cpuView.resize();
    cpuView.setState({ faces: [null, null, null, null, null], sel: [], picking: false, interactive: false,
      ghostFaces: ghost ? opp().faces.slice(0, 5) : null });
  } else {
    $('bnbCpuDice').innerHTML = ghost
      ? `<div class="chips" style="opacity:.45">${opp().faces.slice(0, 5).map(f => `<i class="${f === 'K' ? 'k' : 'f-' + f}">${GLYPH[f]}</i>`).join('')}</div>` : '';
  }
}
function cpuChips(faces) {
  $('bnbCpuDice').innerHTML = `<div class="chips">${faces.map(f => `<i class="${f === 'K' ? 'k' : 'f-' + f}">${GLYPH[f]}</i>`).join('')}</div>`;
}
async function cpuRollAnim(faces, spinning, gen) {
  if (cpu3D) {
    await cpuView.roll(spinning, faces, () => gen === BGEN, n => sfx.land(n));
    if (gen !== BGEN) return;
    cpuView.setState({ faces, sel: [], picking: false, interactive: false });
  } else { await sleep(380); if (gen === BGEN) cpuChips(faces); }
}
function renderRollPips() {
  const p = $('bnbRollPips');
  p.innerHTML = '';
  for (let i = 0; i < Math.max(B.rollsLeft, 0); i++) { const el = document.createElement('i'); el.className = 'on'; p.appendChild(el); }
}
function renderPreview() {
  const pv = $('bnbPreview');
  if (!B.rolled || !isYourHalf()) { pv.innerHTML = ''; return; }
  let o = quirkHitBonus(quirkKey(), baseline(B.faces, pitchOpts()));
  o = applySlump(quirkKey(), B.slumpArmed, o).outcome;
  const k = countK(B.faces);
  const kLim = quirkStrikeK(quirkKey());
  const hint = B.rollsLeft > 0 ? ` <span style="color:var(--chalk-dim)">· tap dice to reroll</span>` : '';
  const warn = k === kLim - 1 ? ` · ⚠ ${k} STRIKE${k > 1 ? 'S' : ''}` : '';
  if (o.kind === 'out') pv.innerHTML = `swinging away: <b style="color:var(--out)">OUT</b>${warn}${hint}`;
  else pv.innerHTML = `swinging away: <b>${o.label}${o.extra ? ' +HUSTLE' : ''}</b>${hint} <span style="color:var(--chalk-dim)">· or play a lit scenario</span>`;
}
function updateButtons() {
  const canRoll = canInteract() && (!B.rolled || (B.rollsLeft > 0 && B.sel.some(Boolean)));
  $('bnbRollBtn').disabled = !canRoll;
  $('bnbBankBtn').disabled = !(canInteract() && B.rolled);
  $('bnbRollBtn').firstChild.textContent = B.rolled ? 'REROLL' : 'ROLL';
}

/* ---------- pitcher opts vs YOU ---------- */
const helmetOn = () => { const eq = equippedGear('equipment'); return !!(eq && eq.guard); };
function pitchOpts() {
  const o = {};
  if (!helmetOn()) {
    if (opp().mod === 'nohustle') o.noHustle = true;
    if (opp().mod === 'coldeye' && B.outs === 2) o.coldEye = true;
  }
  const eq = equippedGear('equipment');
  if (eq && eq.hustle1) o.hustle1 = true;
  return o;
}

/* ---------- your at-bat ---------- */
function startAtBat() {
  B.faces = [null, null, null, null, null];
  B.sel = [false, false, false, false, false];
  B.rollsLeft = rerollsFor(perkKey(), { outs: B.outs, bases: B.bases, inning: B.inning });
  B.rolled = false;
  resetOverrides(youView, you3D, youOvr, heroDieDef());
  $('bnbYouLbl').innerHTML = `NOW BATTING: <b>${hero().name.toUpperCase()}</b>`;
  if (you3D) { youView.setBatter(heroDieDef()); youView.resize(); }
  renderDice(false);
  renderRollPips(); renderPreview(); renderScenarios(); renderBoard(); updateButtons();
}

async function onRoll() {
  if (!canInteract()) return;
  if (B.rolled && !(B.rollsLeft > 0 && B.sel.some(Boolean))) return;
  B.busy = true;
  const gen = BGEN;
  sfx.roll();
  const first = !B.rolled;
  const zen = kUnlocked(perkKey());
  const spinning = B.faces.map((f, i) => first ? true : (B.sel[i] && (f !== 'K' || zen)));
  // reset overrides on any die that spins again
  spinning.forEach((s, i) => {
    if (s && youOvr.has(i)) { if (you3D) youView.setDieFaces(i, hero().faces); youOvr.delete(i); }
  });
  // Sign Stealer: pay the fixer $1 per ✕ die being rerolled
  if (!first) {
    const kCost = kRerollCost(perkKey()) * B.faces.filter((f, i) => spinning[i] && f === 'K').length;
    if (kCost) pay(-kCost, 'SIGN STEALER');
  }
  B.faces = B.faces.map((f, i) => spinning[i] ? hero().faces[Math.floor(rng() * 6)] : f);
  let notes = [];
  if (first) {
    if (opp().mod === 'burnlead' && B.leadoff) {
      B.leadoff = false;
      if (helmetOn()) {
        notes.push(['RALLY HELMET SHRUGS OFF THE HEAT!', false]);
      } else {
        B.faces[Math.floor(rng() * 5)] = 'K';
        notes.push(['HIGH HEAT!', true]);
      }
    }
    if (quirkKey() === 'loaded') {
      const li = Math.floor(rng() * 5);
      const lf = loadedFace(rng());
      B.faces[li] = lf;
      overrideDie(youView, you3D, youOvr, li, lf);
      notes.push([lf === 'POW' ? 'LOADED DICE: ✦!' : 'LOADED DICE: ✕…', lf === 'K']);
    }
    const eq = equippedGear('equipment');
    if (eq && eq.conv) {
      const r = applyEquipment(B.faces, eq.id);
      if (r.idx >= 0) {
        B.faces = r.faces;
        overrideDie(youView, you3D, youOvr, r.idx, B.faces[r.idx]);
        notes.push([eq.name.toUpperCase() + '!', false]);
      }
    }
    B.rolled = true;
  } else {
    B.rollsLeft--;
    B.sel = [false, false, false, false, false];
  }
  renderScenarios();
  await animateYouRoll(spinning, gen);
  if (gen !== BGEN) return;
  for (const [txt, bad] of notes) { marquee(txt, bad); await sleep(280); if (gen !== BGEN) return; }
  B.busy = false;
  afterRoll();
}

function animateYouRoll(spinning, gen) {
  if (you3D) {
    renderDice(false);
    return youView.roll(spinning, B.faces, () => gen === BGEN, n => sfx.land(n));
  }
  renderDice(false);
  const els = [...document.querySelectorAll('#bnbDiceRow .die')];
  const stops = [];
  let order = 0;
  els.forEach((el, i) => {
    if (!spinning[i]) return;
    const finalF = B.faces[i];
    const g = el.querySelector('.g'), l = el.querySelector('.l');
    el.className = 'die rolling' + (order % 2 ? ' alt' : '');
    const iv = setInterval(() => {
      const f = hero().faces[(Math.random() * 6) | 0];
      g.textContent = GLYPH[f]; l.textContent = FLABEL[f];
    }, 70);
    const stopAt = 330 + order * 95 + ((Math.random() * 50) | 0);
    const n = order; order++;
    stops.push(new Promise(done => setTimeout(() => {
      clearInterval(iv);
      if (gen !== BGEN) return done();
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
  const kLim = quirkStrikeK(quirkKey());
  const k = countK(B.faces);
  if (k >= kLim) {
    // Rabbit's Foot: once per game, the strikeout is forgiven
    if (quirkKey() === 'rabbit' && !B.rabbitUsed) {
      B.rabbitUsed = true;
      marquee("RABBIT'S FOOT!");
      const spinning = B.faces.map(f => f === 'K');
      spinning.forEach((s, i) => {
        if (s && youOvr.has(i)) { if (you3D) youView.setDieFaces(i, hero().faces); youOvr.delete(i); }
      });
      B.faces = B.faces.map((f, i) => spinning[i] ? hero().faces[Math.floor(rng() * 6)] : f);
      (async () => {
        const gen = BGEN;
        B.busy = true;
        await animateYouRoll(spinning, gen);
        if (gen !== BGEN) return;
        B.busy = false;
        afterRoll();
      })();
      return;
    }
    renderDice(false); renderRollPips(); renderScenarios();
    return settleYou({ kind: 'out', bases: 0, label: 'STRUCK OUT' }, null);
  }
  renderDice(canInteract());
  renderRollPips(); renderPreview(); renderScenarios(); updateButtons();
}

function onDieTap(i) {
  if (!canInteract() || !B.rolled || B.rollsLeft <= 0) return;
  const zen = kUnlocked(perkKey());
  if (B.faces[i] === 'K' && !zen) return;
  const kFee = kRerollCost(perkKey());
  if (kFee && B.faces[i] === 'K' && !B.sel[i]) {
    const kSel = B.faces.filter((f, j) => B.sel[j] && f === 'K').length;
    if (SEASON.budget < (kSel + 1) * kFee) { marquee('NO BUDGET FOR THE FIXER!', true); return; }
  }
  B.sel[i] = !B.sel[i];
  sfx.hold();
  renderDice(true);
  updateButtons();
}

function onBank() {
  if (!canInteract() || !B.rolled) return;
  const o = quirkHitBonus(quirkKey(), baseline(B.faces, pitchOpts()));
  settleYou(o, null);
}

function playScenario(s) {
  if (!canInteract() || !B.rolled) return;
  sfx.pick();
  const eff = { ...s.eff, bases: s.eff.bases || 0, kind: s.eff.kind };
  settleYou(quirkHitBonus(quirkKey(), eff), s);
}

async function settleYou(outcome, scen) {
  const gen = BGEN;
  B.busy = true;
  updateButtons();
  renderDice(false); renderScenarios();
  // Slump Buster: first hit after one of your strikeouts gains +2 bases
  {
    const sl = applySlump(quirkKey(), B.slumpArmed, outcome);
    if (sl.used) { outcome = sl.outcome; B.slumpArmed = false; }
  }
  let runsThisAB = 0;
  if (outcome.kind === 'out') {
    B.outs++;
    sfx.out();
    animateOut(gen);
    marquee(outcome.label, true);
    if (outcome.label === 'STRUCK OUT') {
      if (quirkKey() === 'showboat') pay(-1, 'SHOWBOAT');
      if (quirkKey() === 'slump') B.slumpArmed = true;
    }
    renderBoard();
  } else {
    // scenario pre-effects fire first (steal / runners up)
    if (outcome.pre) {
      const pr = runPre(B.bases, outcome.pre);
      B.bases = pr.bases;
      runsThisAB += pr.runs;
      ['bnbPad1', 'bnbPad2', 'bnbPad3'].forEach(p => $(p).classList.remove('occ'));
      await animateRunners(pr.moves, gen, 200);
      if (gen !== BGEN) return;
    }
    const r = advance(B.bases, outcome);
    B.bases = r.bases;
    let runs = r.runs + runsThisAB;
    if (outcome.doubleRuns && runs) runs *= 2;
    runsThisAB = runs;
    addRuns(youSide(), runs);
    if (outcome.bases === 4) sfx.big(); else if (outcome.kind === 'walk') sfx.walk(); else sfx.hit();
    marquee(outcome.label + (runs ? ` · ${runs} IN!` : ''));
    ['bnbPad1', 'bnbPad2', 'bnbPad3'].forEach(p => $(p).classList.remove('occ'));
    animateRunners(r.moves, gen).then(() => { if (gen === BGEN) renderBoard(); });
    if (runs) pay(runs * ECON.perRun, 'RUNS');
    if (quirkKey() === 'showboat' && outcome.bases === 4) pay(3, 'SHOWBOAT');
    if (outcome.cash) pay(outcome.cash, scen ? scen.name : '');
  }
  renderPreview();
  await sleep(1100);
  if (gen !== BGEN) return;
  B.busy = false;
  if (checkWalkoff()) return;
  if (B.outs >= 3) return endHalf();
  startAtBat();
}

function addRuns(side, n) {
  if (!n) return;
  const i = B.inning - 1;
  B.score[side][i] = (B.score[side][i] || 0) + n;
}

/* Whoever bats last (home) can walk it off — the CPU too, when you bat first. */
function checkWalkoff() {
  if (B.half === 'bottom' && B.inning >= 3 && total('home') > total('away')) {
    marquee(isYourHalf() ? 'WALK-OFF!' : 'CPU WALKS IT OFF!', !isYourHalf());
    endBnbGame();
    return true;
  }
  return false;
}

/* ---------- innings ---------- */
async function endHalf() {
  const gen = BGEN;
  const side = B.half === 'top' ? 'away' : 'home';
  if (B.score[side][B.inning - 1] == null) B.score[side][B.inning - 1] = 0;
  B.outs = 0; B.bases = [false, false, false];
  if (B.half === 'top') {
    if (B.inning >= 3 && total('home') > total('away')) return endBnbGame();
    B.half = 'bottom';
  } else {
    if (B.inning >= 3 && total('home') !== total('away')) return endBnbGame();
    if (B.inning >= 9) return endBnbGame();
    B.inning++; B.half = 'top';
  }
  renderBoard();
  await sleep(600);
  if (gen !== BGEN) return;
  beginHalf();
}

function setTurnUI() {
  const cpuBatting = !!B && !B.over && !isYourHalf();
  $('bnbScreen').classList.toggle('cpuTurn', cpuBatting);
  const hint = $('bnbShopHint');
  if (hint) hint.textContent = cpuBatting
    ? 'CPU is batting — new gear kicks in for your next at-bat.'
    : 'Drag gear onto a slot to buy. Drag it off to sell. Restocks every game.';
}

function beginHalf() {
  renderBoard();
  setTurnUI();
  if (isYourHalf()) {
    B.leadoff = true; // flamethrower burns your leadoff batter each inning
    $('bnbCpuLbl').textContent = "CPU'S DICE";
    renderCpuDiceIdle(true);
    startAtBat();
  } else {
    $('bnbYouLbl').textContent = 'YOUR DICE';
    B.faces = [null, null, null, null, null];
    B.rolled = false;
    renderDice(false);
    renderRollPips(); renderPreview(); renderScenarios(); updateButtons();
    cpuHalf();
  }
}

/* ---------- CPU offense (visible dice + scenario choices) ---------- */
async function cpuHalf() {
  const gen = BGEN;
  while (gen === BGEN && B.outs < 3 && !B.over) {
    await cpuAtBat(gen);
    if (gen !== BGEN || B.over) return;
    if (checkWalkoff()) return;
    await sleep(650);
  }
  if (gen !== BGEN || B.over) return;
  endHalf();
}

async function cpuAtBat(gen) {
  const o = opp();
  const die = oppDieDef();
  resetOverrides(cpuView, cpu3D, cpuOvr, die);
  $('bnbCpuLbl').innerHTML = `CPU AT THE PLATE: <b>${o.hero.name.toUpperCase()}</b>`;
  renderCpuDiceIdle(true);
  await sleep(420);
  if (gen !== BGEN) return;
  sfx.roll();
  let faces = [0, 1, 2, 3, 4].map(() => o.faces[Math.floor(rng() * 6)]);
  // their equipment converts a face on the first roll
  if (o.gear.eq) {
    const r = applyEquipment(faces, o.gear.eq);
    if (r.idx >= 0) { faces = r.faces; overrideDie(cpuView, cpu3D, cpuOvr, r.idx, faces[r.idx]); }
  }
  await cpuRollAnim(faces, [true, true, true, true, true], gen);
  if (gen !== BGEN) return;
  let rerolls = o.gear.perk === 'FILM' ? 2 : 1;
  const scens = cpuScenarios(o);
  const bestNow = f => {
    const opts = [baseline(f, {}), ...metScenarios(scens, f).map(s => s.eff)];
    let best = null, bv = -Infinity;
    for (const x of opts) { const v = scoreOutcome(x, B.bases); if (v > bv) { bv = v; best = x; } }
    return { best, bv };
  };
  while (rerolls > 0 && countK(faces) < 3) {
    const { bv } = bestNow(faces);
    if (bv >= 2) break; // happy with what's showing
    const keep = greedyKeep(faces);
    const sel = faces.map((f, i) => f !== 'K' && !keep[i]);
    if (!sel.some(Boolean)) break;
    await sleep(420 + Math.random() * 280);
    if (gen !== BGEN) return;
    sel.forEach((s, i) => {
      if (s && cpuOvr.has(i)) { if (cpu3D) cpuView.setDieFaces(i, o.faces); cpuOvr.delete(i); }
    });
    faces = faces.map((f, i) => sel[i] ? o.faces[Math.floor(rng() * 6)] : f);
    await cpuRollAnim(faces, sel, gen);
    if (gen !== BGEN) return;
    rerolls--;
  }
  await sleep(350);
  if (gen !== BGEN) return;
  // resolve
  let outcome;
  let viaScen = null;
  if (countK(faces) >= 3) outcome = { kind: 'out', bases: 0, label: 'STRUCK OUT' };
  else {
    const opts = [{ eff: baseline(faces, {}), s: null }, ...metScenarios(scens, faces).map(s => ({ eff: s.eff, s }))];
    let bv = -Infinity;
    for (const x of opts) {
      const v = scoreOutcome(x.eff, B.bases);
      if (v > bv) { bv = v; outcome = x.eff; viaScen = x.s; }
    }
  }
  if (outcome.kind === 'out') {
    B.outs++;
    sfx.out();
    animateOut(gen);
    marquee(outcome.label, true);
    if (quirkKey() === 'heckler' && outcome.label === 'STRUCK OUT') pay(1, 'HECKLER');
  } else {
    let runs = 0;
    if (outcome.pre) {
      const pr = runPre(B.bases, outcome.pre);
      B.bases = pr.bases; runs += pr.runs;
      ['bnbPad1', 'bnbPad2', 'bnbPad3'].forEach(p => $(p).classList.remove('occ'));
      await animateRunners(pr.moves, gen, 180);
      if (gen !== BGEN) return;
    }
    const r = advance(B.bases, outcome);
    B.bases = r.bases;
    runs += r.runs;
    addRuns(cpuSide(), runs);
    if (outcome.bases === 4) sfx.big(); else if (outcome.kind === 'walk') sfx.walk(); else sfx.hit();
    marquee((viaScen ? viaScen.name + ' — ' : '') + outcome.label + (runs ? ` · ${runs} IN` : ''), false);
    ['bnbPad1', 'bnbPad2', 'bnbPad3'].forEach(p => $(p).classList.remove('occ'));
    animateRunners(r.moves, gen, 170).then(() => { if (gen === BGEN) renderBoard(); });
  }
  renderBoard();
  await sleep(700);
}

/* ---------- game start / end ---------- */
async function startBnbGame() {
  BGEN++;
  const gen = BGEN;
  B = FRESHB();
  B.youFirst = rng() < 0.5; // decided now; the coin toss reveals it
  buildBoardRows();
  renderBudget(false);
  renderCards();
  renderShop();
  renderScenarios();
  renderBoard();
  initViews();
  renderCpuDiceIdle(true);
  B.faces = [null, null, null, null, null];
  renderDice(false);
  updateButtons();
  await coinToss({
    youFirst: B.youFirst,
    mount: $('bnbScreen'),
    isLive: () => gen === BGEN,
    onFlip: () => sfx.roll(),
    onLand: () => sfx.coin(2),
  });
  if (gen !== BGEN) return;
  marquee('PLAY BALL!');
  beginHalf();
}

function endBnbGame() {
  B.over = true;
  $('bnbScreen').classList.remove('cpuTurn');
  const you = total(youSide()), them = total(cpuSide());
  const won = you > them;
  const beaten = opp().team;
  SEASON.results[SEASON.gameIdx] = won ? 'W' : 'L';
  SEASON.gameIdx++;
  const lines = [`FINAL — ${beaten} ${them} · YOU ${you}`];
  pay(ECON.showPay, ''); lines.push(`SHOW-UP PAY <b>+$${ECON.showPay}</b>`);
  if (won) { pay(ECON.winBonus, ''); lines.push(`WIN BONUS <b>+$${ECON.winBonus}</b>`); }
  else { pay(ECON.lossPay, ''); lines.push(`CONSOLATION <b>+$${ECON.lossPay}</b>`); }
  SEASON.stock = restockShop();
  lines.push('SHOP RESTOCKED FOR NEXT GAME');
  saveSeason();
  setTimeout(() => {
    BGEN++; // stop any lingering animations once the overlay takes over
    showFrontOffice({
      title: won ? 'YOU WIN!' : (you === them ? 'CALLED — TIE' : 'TOUGH LOSS'),
      cls: won ? 'win' : 'loss',
      lines,
    });
  }, 1400);
}

/* ---------- wiring ---------- */
const titleBtn = document.getElementById('bnbBtn');
if (titleBtn) titleBtn.onclick = enterBnB;

/* test hooks */
window.__BNB_TEST = {
  get B() { return B; }, get SEASON() { return SEASON; },
  enterBnB, startBnbGame,
  forceFaces(f) { B.faces = f; B.rolled = true; B.busy = false; afterRoll(); },
  settleYou, onRoll, onBank, endHalf, renderBoard,
  get hero() { return hero(); }, get opp() { return opp(); },
  clearSeason() { sstore.clear(); SEASON = null; },
};
