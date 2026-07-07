/* DICE PENNANT — pure engine. No DOM. Node + browser. */
export default (function () {

  // ---------- RNG (seedable for headless verification) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Faces ----------
  const F = { BAT: 'BAT', POW: 'POW', EYE: 'EYE', RUN: 'RUN', K: 'K' };

  // ---------- Collectible dice ----------
  const DICE = {
    ROOKIE:  { id: 'ROOKIE',  name: 'Rookie',      faces: [F.BAT, F.BAT, F.POW, F.EYE, F.RUN, F.K], blurb: 'A little of everything.' },
    SLUGGER: { id: 'SLUGGER', name: 'Slugger',     faces: [F.POW, F.POW, F.POW, F.K, F.K, F.K],   blurb: 'Moon or bust.' },
    SPARK:   { id: 'SPARK',   name: 'Sparkplug',   faces: [F.BAT, F.BAT, F.RUN, F.RUN, F.EYE, F.K], blurb: 'Slap it and sprint.' },
    PROF:    { id: 'PROF',    name: 'Professor',   faces: [F.EYE, F.EYE, F.BAT, F.BAT, F.K, F.K], blurb: 'Works the count.' },
    CANNON:  { id: 'CANNON',  name: 'Cannonball',  faces: [F.POW, F.POW, F.BAT, F.BAT, F.K, F.K],   blurb: 'Gap power, good wheels.' },
    JET:     { id: 'JET',     name: 'Jetstream',   faces: [F.RUN, F.RUN, F.RUN, F.BAT, F.BAT, F.K], blurb: 'Beats the throw every time.' },
    HAWK:    { id: 'HAWK',    name: 'Hawkeye',     faces: [F.EYE, F.EYE, F.EYE, F.BAT, F.K, F.K],   blurb: 'Never chases. Ever.' },
    PESKY:   { id: 'PESKY',   name: 'Pesky',       faces: [F.BAT, F.BAT, F.BAT, F.RUN, F.K, F.K],   blurb: 'Death by a thousand singles.' },
    JOKER:   { id: 'JOKER',   name: 'Joker',       faces: [F.POW, F.POW, F.RUN, F.RUN, F.K, F.K],   blurb: 'Nobody knows. Not even him.' },
    TANK:    { id: 'TANK',    name: 'Tank',        faces: [F.POW, F.BAT, F.BAT, F.BAT, F.K, F.K],   blurb: 'One weakness. Good luck finding it.' },
    BULL:    { id: 'BULL',    name: 'Bulldozer',   faces: [F.POW, F.POW, F.POW, F.EYE, F.K, F.K],   blurb: 'The legend. The wall fears him.' },
  };

  // ---------- Cards (once per game) ----------
  const CARDS = {
    CORK:  { id: 'CORK',  name: 'Corked Bat', text: 'Turn one die to POW.' },
    SIGN:  { id: 'SIGN',  name: 'Stolen Sign', text: 'Turn one die to BAT.' },
    TAR:   { id: 'TAR',   name: 'Pine Tar',   text: '+1 reroll this at-bat.' },
    JUICE: { id: 'JUICE', name: 'Juiced Ball',   text: 'A hit this at-bat gains +1 base (max HR).' },
    THIEF: { id: 'THIEF', name: 'Base Thief',    text: 'Your lead runner steals a base.' },
    SQZ:   { id: 'SQZ',   name: 'Safety Squeeze', text: 'If this at-bat is an out, runners still advance 1.' },
    GLOVE: { id: 'GLOVE', name: 'Gold Glove',    text: "Rob the CPU's next hit — it becomes an out." },
    RAIN:  { id: 'RAIN',  name: 'Rain Delay',    text: "CPU's next half ends after 2 outs." },
    HEAT:  { id: 'HEAT',  name: 'Heated Argument', text: 'Unlock one K die and reroll it free.' },
    ROSIN: { id: 'ROSIN', name: 'Rosin Bag',     text: 'Reroll ALL your K dice at once. Risky.' },
    WIND:  { id: 'WIND',  name: 'Tailwind',      text: 'This at-bat, POW ×4 is a MOONSHOT.' },
    CROWD: { id: 'CROWD', name: 'Rally Towels',  text: 'If you score this at-bat, +1 bonus run.' },
    BATBOY:{ id: 'BATBOY', name: 'Batboy',       text: 'Fetch a random card from your binder into your hand.' },
    RALLY: { id: 'RALLY', name: 'Rally Cap',  text: 'All runners advance one base.' },
    CLUTCH:{ id: 'CLUTCH',name: 'Clutch Gene',text: 'Runs scored this at-bat count double.' },
  };

  // ---------- Pitcher traits (CPU variety) ----------
  const PITCHERS = {
    NOBODY: { id: 'NOBODY', name: 'Bullpen Guy',  text: 'No trick pitches.', mod: null },
    FLAME:  { id: 'FLAME',  name: 'Flamethrower', text: 'Comes out firing: your leadoff batter each inning has one die burned to K.', mod: 'burnlead' },
    JUNK:   { id: 'JUNK',   name: 'Junkballer',   text: 'Nothing to drive: RUN faces grant no extra bases.', mod: 'nohustle' },
    ICEMAN: { id: 'ICEMAN', name: 'The Iceman',   text: 'With 2 outs, EYE faces go cold (count as K).', mod: 'coldeye' },
  };

  // ---------- Outcome resolution ----------
  // Returns {kind, bases, extra, label}
  function resolve(faces, opts) {
    opts = opts || {};
    const c = { BAT: 0, POW: 0, EYE: 0, RUN: 0, K: 0 };
    for (const f of faces) c[f]++;
    if (opts.coldEye) { c.K += c.EYE; c.EYE = 0; }
    const extra = c.RUN >= 2 && !opts.noHustle; // hustle: +1 base on any hit
    if (c.POW >= 5) return { kind: 'hit', bases: 4, extra: false, label: 'MOONSHOT', bonus: 1 };
    if (c.POW === 4) return opts.wind
      ? { kind: 'hit', bases: 4, extra: false, label: 'MOONSHOT', bonus: 1 }
      : { kind: 'hit', bases: 4, extra: false, label: 'HOME RUN' };
    if (c.POW === 3) return { kind: 'hit', bases: 2, extra, label: 'OFF THE WALL' };
    if (c.BAT >= 5)  return { kind: 'hit', bases: 3, extra, label: 'TRIPLE' };
    if (c.BAT === 4) return { kind: 'hit', bases: 2, extra, label: 'DOUBLE' };
    if (c.BAT === 3) return { kind: 'hit', bases: 1, extra, label: 'SINGLE' };
    if (c.EYE >= 3)  return { kind: 'walk', bases: 1, extra: false, label: 'WALK' };
    if (c.RUN >= 4)  return { kind: 'hit', bases: 1, extra: !opts.noHustle, label: 'LEG IT OUT' };
    if (c.BAT === 2 && c.RUN >= 3) return { kind: 'hit', bases: 1, extra: false, label: 'SEEING-EYE SINGLE' };
    if (c.K >= 3)    return { kind: 'out', bases: 0, extra: false, label: 'STRUCK OUT' };
    return { kind: 'out', bases: 0, extra: false, label: 'FLIED OUT' };
  }

  // ---------- Base running ----------
  // bases: [1B,2B,3B] booleans. Returns {bases, runs}
  function advance(bases, outcome) {
    let runs = 0;
    const adv = outcome.bases + (outcome.extra ? 1 : 0);
    const nb = [false, false, false];
    const moves = []; // {from:0..3, to:1..4} — 0 = batter at plate, 4 = scored
    if (outcome.kind === 'walk') {
      // forced advances only
      const occ = bases.slice();
      if (occ[0] && occ[1] && occ[2]) { runs++; nb[0] = nb[1] = nb[2] = true;
        moves.push({ from: 3, to: 4 }, { from: 2, to: 3 }, { from: 1, to: 2 }, { from: 0, to: 1 }); }
      else if (occ[0] && occ[1]) { nb[0] = nb[1] = nb[2] = true;
        moves.push({ from: 2, to: 3 }, { from: 1, to: 2 }, { from: 0, to: 1 }); }
      else if (occ[0]) { nb[0] = nb[1] = true; nb[2] = occ[2];
        moves.push({ from: 1, to: 2 }, { from: 0, to: 1 }); }
      else { nb[0] = true; nb[1] = occ[1]; nb[2] = occ[2];
        moves.push({ from: 0, to: 1 }); }
      return { bases: nb, runs, moves };
    }
    if (outcome.kind !== 'hit') return { bases: bases.slice(), runs: 0, moves };
    // everyone (incl. batter) moves `adv` bases; batter starts at 0
    const runners = [];
    for (let i = 0; i < 3; i++) if (bases[i]) runners.push(i + 1);
    runners.push(0); // batter at home plate
    for (const pos of runners) {
      const to = pos + adv;
      moves.push({ from: pos, to: Math.min(to, 4) });
      if (to >= 4) runs++;
      else nb[to - 1] = true;
    }
    if (outcome.bonus) runs += outcome.bonus; // moonshot crowd bonus
    return { bases: nb, runs, moves };
  }

  // ---------- Greedy keep strategy (CPU + hint) ----------
  // Returns boolean[] keep mask
  function greedyKeep(faces) {
    const c = { BAT: 0, POW: 0, EYE: 0, RUN: 0, K: 0 };
    for (const f of faces) c[f]++;
    // score each target line
    const lines = [
      { face: F.POW, w: c.POW * 1.45 },
      { face: F.BAT, w: c.BAT * 1.0 + (c.RUN >= 2 ? 0.35 : 0) },
      { face: F.EYE, w: c.EYE * 0.72 },
      { face: F.RUN, w: c.RUN * 0.55 },
    ];
    lines.sort((a, b) => b.w - a.w);
    const target = lines[0].face;
    return faces.map(f => {
      if (f === target) return true;
      if (target === F.BAT && f === F.RUN && c.RUN >= 2) return true;
      return false;
    });
  }

  // ---------- Single at-bat (headless, using strategy) ----------
  function countK(faces) { let n = 0; for (const f of faces) if (f === F.K) n++; return n; }

  function playAtBat(die, rng, opts) {
    opts = opts || {};
    let rolls = opts.rerolls != null ? opts.rerolls : 1;
    let faces = [];
    for (let i = 0; i < 5; i++) faces.push(die.faces[Math.floor(rng() * 6)]);
    if (opts.burn1) faces[Math.floor(rng() * 5)] = F.K;
    while (rolls > 0) {
      if (countK(faces) >= 3) return { kind: 'out', bases: 0, extra: false, label: 'STRUCK OUT' };
      const out = resolve(faces, opts);
      if (out.kind !== 'out') break; // baseline: bank any result
      const keep = greedyKeep(faces);
      faces = faces.map((f, i) => (f === F.K || keep[i]) ? f : die.faces[Math.floor(rng() * 6)]);
      rolls--;
    }
    if (countK(faces) >= 3) return { kind: 'out', bases: 0, extra: false, label: 'STRUCK OUT' };
    return resolve(faces, opts);
  }

  // ---------- Half inning ----------
  function playHalf(lineup, batterIdx, rng, pitcherMod) {
    let outs = 0, runs = 0, bases = [false, false, false], atBats = 0;
    while (outs < 3) {
      const die = lineup[batterIdx % lineup.length];
      const opts = {};
      if (pitcherMod === 'burnlead' && atBats === 0) opts.burn1 = true;
      if (pitcherMod === 'nohustle') opts.noHustle = true;
      if (pitcherMod === 'coldeye' && outs === 2) opts.coldEye = true;
      const out = playAtBat(die, rng, opts);
      atBats++;
      batterIdx++;
      if (out.kind === 'out') outs++;
      else {
        const r = advance(bases, out);
        bases = r.bases; runs += r.runs;
      }
    }
    return { runs, atBats, batterIdx };
  }

  // ---------- Full headless game ----------
  function playGame(lineupA, lineupB, rng, innings, pitcherModVsA) {
    innings = innings || 3;
    let a = 0, b = 0, abA = 0, abB = 0, biA = 0, biB = 0;
    let inn = 0;
    while (inn < innings || a === b) {
      const ha = playHalf(lineupA, biA, rng, pitcherModVsA || null);
      a += ha.runs; abA += ha.atBats; biA = ha.batterIdx;
      const hb = playHalf(lineupB, biB, rng, null);
      b += hb.runs; abB += hb.atBats; biB = hb.batterIdx;
      inn++;
      if (inn >= innings + 4) break; // cap extras
    }
    return { a, b, abA, abB, innings: inn };
  }

  // total ordering of at-bat outcomes for SHOWDOWN hand comparison
  // MOONSHOT 5.6 > HR 4 > TRIPLE 3 > DOUBLE 2(+hustle 2.4) > LEG IT OUT 1.4 > SINGLE 1 > WALK .7 > OUT 0
  function rankOutcome(o) {
    if (!o || o.kind === 'out') return 0;
    if (o.kind === 'walk') return 0.7;
    return o.bases + (o.extra ? 0.4 : 0) + (o.bonus ? 1.6 : 0);
  }

  return { F, DICE, CARDS, PITCHERS, resolve, advance, greedyKeep, countK, playAtBat, playHalf, playGame, mulberry32, rankOutcome };
})();
