/* BATS-N-BASES — static data: ballplayers, gear, opponents, economy. */

export const GLYPH = { BAT: '⌁', POW: '✦', EYE: '◎', RUN: '»', K: '✕', ANY: '?' };
export const FLABEL = { BAT: 'BAT', POW: 'POW', EYE: 'EYE', RUN: 'RUN', K: '', ANY: 'ANY' };

/* Slot identity: every gear type snaps with one shape, always. */
export const SLOTS = ['equipment', 'perk', 'quirk'];
export const SLOT_SHAPE = { equipment: 'square', perk: 'circle', quirk: 'triangle' };
export const SLOT_TINT = { equipment: '#9CDFA8', perk: '#9FBEEA', quirk: '#EFA098' };
export const SLOT_TINT_DIM = { equipment: '#28513A', perk: '#274058', quirk: '#54302C' };

/* ---------- Ballplayers (heroes) ----------
   Each comes with 5 identical custom dice (one face mix) and
   4 unique scenarios (Dice Throne-style abilities the player CHOOSES).

   Scenario shape:
     req  — face counts that must be met (uniq: N = N distinct non-K faces)
     eff  — outcome to execute:
            kind 'hit'|'walk', bases, extra (hustle +1), bonus (bonus runs),
            pre 'advance1'|'steal' (runners move before the swing resolves),
            cash N (manager pays budget), doubleRuns
*/
export const HEROES = [
  {
    id: 'DIESEL', name: 'Big Diesel', pos: 'DH', num: 44,
    blurb: 'Swings for the parking lot.',
    faces: ['POW', 'POW', 'POW', 'BAT', 'BAT', 'K'],
    scenarios: [
      { id: 'D1', name: 'TAPE MEASURE', req: { POW: 5 },
        eff: { kind: 'hit', bases: 4, bonus: 2, label: 'TAPE MEASURE BLAST' },
        text: 'Moonshot worth 2 bonus runs.' },
      { id: 'D2', name: 'WRECKING BALL', req: { POW: 3, BAT: 2 },
        eff: { kind: 'hit', bases: 3, label: 'WRECKING BALL' },
        text: 'A screaming triple.' },
      { id: 'D3', name: 'DENT THE WALL', req: { POW: 2, BAT: 2 },
        eff: { kind: 'hit', bases: 2, bonus: 1, label: 'DENTED THE WALL' },
        text: 'Double so loud it counts an extra run.' },
      { id: 'D4', name: 'INTIMIDATE', req: { POW: 2, K: 2 },
        eff: { kind: 'walk', pre: 'steal', label: 'PITCHER RATTLED' },
        text: 'Walk, and your lead runner steals a base.' },
    ],
  },
  {
    id: 'WHEELS', name: 'Wheels', pos: 'CF', num: 7,
    blurb: 'First to the ball. First to the bag.',
    faces: ['RUN', 'RUN', 'RUN', 'BAT', 'EYE', 'K'],
    scenarios: [
      { id: 'W1', name: 'INSIDE THE PARK', req: { RUN: 5 },
        eff: { kind: 'hit', bases: 4, label: 'INSIDE-THE-PARK HR' },
        text: 'Never stopped running. Round-tripper!' },
      { id: 'W2', name: 'JET STREAM', req: { RUN: 4 },
        eff: { kind: 'hit', bases: 2, extra: true, label: 'STRETCH DOUBLE' },
        text: 'Double stretched an extra base.' },
      { id: 'W3', name: 'BUNT AND RUN', req: { BAT: 2, RUN: 2 },
        eff: { kind: 'hit', bases: 1, pre: 'advance1', label: 'BUNT AND RUN' },
        text: 'Runners move up 1, then a single drops in.' },
      { id: 'W4', name: 'DELAYED STEAL', req: { RUN: 2, EYE: 2 },
        eff: { kind: 'walk', pre: 'steal', label: 'WALK AND STEAL' },
        text: 'Walk, and your lead runner steals.' },
    ],
  },
  {
    id: 'PROF', name: 'The Professor', pos: 'C', num: 12,
    blurb: 'Reads the pitcher like a cheap paperback.',
    faces: ['EYE', 'EYE', 'EYE', 'BAT', 'POW', 'K'],
    scenarios: [
      { id: 'P1', name: 'SAW IT COMING', req: { EYE: 2, POW: 2 },
        eff: { kind: 'hit', bases: 4, label: 'SAW IT COMING' },
        text: 'Sat on the fastball. Home run.' },
      { id: 'P2', name: 'THREAD THE NEEDLE', req: { EYE: 2, BAT: 1, POW: 1 },
        eff: { kind: 'hit', bases: 3, label: 'THREADED THE NEEDLE' },
        text: 'Placed where nobody stands. Triple.' },
      { id: 'P3', name: 'PAINT READER', req: { EYE: 2, BAT: 2 },
        eff: { kind: 'hit', bases: 2, label: 'LINED TO THE GAP' },
        text: 'A well-read double.' },
      { id: 'P4', name: 'MIND GAMES', req: { EYE: 4 },
        eff: { kind: 'walk', pre: 'advance1', cash: 1, label: 'FORCED THE BALK' },
        text: 'Walk, runners move up 1, manager pays $1.' },
    ],
  },
  {
    id: 'CAPT', name: 'Captain Clutch', pos: '3B', num: 2,
    blurb: 'Bigger the moment, bigger the swing.',
    faces: ['BAT', 'BAT', 'POW', 'EYE', 'RUN', 'K'],
    scenarios: [
      { id: 'C1', name: 'SIGNATURE SWING', req: { BAT: 3, POW: 2 },
        eff: { kind: 'hit', bases: 4, label: 'SIGNATURE SWING' },
        text: 'The one they put on the poster. HR.' },
      { id: 'C2', name: 'CLUTCH GENE', req: { BAT: 3 },
        eff: { kind: 'hit', bases: 2, doubleRuns: true, label: 'CLUTCH DOUBLE' },
        text: 'Double — runs scored count twice.' },
      { id: 'C3', name: 'TEAM CAPTAIN', req: { BAT: 2, EYE: 2 },
        eff: { kind: 'walk', pre: 'advance1', label: 'CAPTAIN\u2019S WALK' },
        text: 'Walk, and all runners move up 1.' },
      { id: 'C4', name: 'SPARK PLUG', req: { uniq: 4 },
        eff: { kind: 'hit', bases: 1, extra: true, cash: 1, label: 'SPARK PLUG' },
        text: '4 different faces: hustle single, +$1.' },
    ],
  },
];

/* ---------- Manager shop gear ----------
   Consistent rules per slot:
   equipment — tweaks your dice (face conversions on the FIRST roll, or passive die tricks)
   perk      — changes your reroll economy
   quirk     — risk / reward twist (often pays or costs budget)
*/
export const GEAR = {
  // equipment (square)
  GLOVES: { id: 'GLOVES', type: 'equipment', name: 'Batting Gloves', cost: 2,
    conv: ['K', 'BAT'], text: 'First roll each at-bat: one ✕ becomes ⌁.' },
  CLEATS: { id: 'CLEATS', type: 'equipment', name: 'Turf Cleats', cost: 3,
    conv: ['K', 'RUN'], text: 'First roll each at-bat: one ✕ becomes ».' },
  SHADES: { id: 'SHADES', type: 'equipment', name: 'Lucky Shades', cost: 3,
    conv: ['K', 'EYE'], text: 'First roll each at-bat: one ✕ becomes ◎.' },
  MAPLE:  { id: 'MAPLE', type: 'equipment', name: 'Maple Bat', cost: 4,
    conv: ['BAT', 'POW'], text: 'First roll each at-bat: one ⌁ becomes ✦.' },
  DONUT:  { id: 'DONUT', type: 'equipment', name: 'Bat Doughnut', cost: 4,
    conv: ['EYE', 'POW'], text: 'First roll each at-bat: one ◎ becomes ✦.' },
  HELMET: { id: 'HELMET', type: 'equipment', name: 'Rally Helmet', cost: 4,
    guard: true, text: "The enemy pitcher's trick pitch has no effect on you." },
  SPRINGS:{ id: 'SPRINGS', type: 'equipment', name: 'Springy Spikes', cost: 4,
    hustle1: true, text: 'A single » is enough for a hustle base (normally 2).' },
  CORK:   { id: 'CORK', type: 'equipment', name: 'Corked Bat', cost: 6,
    conv: ['ANY', 'POW'], text: 'First roll each at-bat: worst die becomes ✦.' },
  // perks (circle)
  RHYTHM: { id: 'RHYTHM', type: 'perk', name: 'Rally Rhythm', cost: 2,
    perk: 'reroll2out', text: '+1 reroll when there are 2 outs.' },
  FILM:   { id: 'FILM', type: 'perk', name: 'Film Study', cost: 3,
    perk: 'reroll1', text: '+1 reroll every at-bat.' },
  SCOUT:  { id: 'SCOUT', type: 'perk', name: 'Scouting Report', cost: 3,
    perk: 'rerollRISP', text: '+1 reroll with a runner in scoring position.' },
  NINTH:  { id: 'NINTH', type: 'perk', name: 'Ninth Gear', cost: 4,
    perk: 'rerollLate', text: '+2 rerolls from the 3rd inning on.' },
  ZEN:    { id: 'ZEN', type: 'perk', name: 'Zen Focus', cost: 5,
    perk: 'unlockK', text: '✕ dice are never locked — reroll them freely.' },
  SIGNS:  { id: 'SIGNS', type: 'perk', name: 'Sign Stealer', cost: 5,
    perk: 'paidK', text: 'Reroll ✕ dice freely — the fixer charges $1 each.' },
  // quirks (triangle)
  SWING:  { id: 'SWING', type: 'quirk', name: 'Free Swinger', cost: 2,
    quirk: 'freeswing', text: 'Hits gain +1 base… but 2 ✕ is a strikeout.' },
  HECKLER:{ id: 'HECKLER', type: 'quirk', name: 'Heckler', cost: 2,
    quirk: 'heckler', text: 'Every CPU strikeout pays you $1.' },
  SHOW:   { id: 'SHOW', type: 'quirk', name: 'Showboat', cost: 3,
    quirk: 'showboat', text: 'Homers pay +$3. Strikeouts cost you $1.' },
  SLUMP:  { id: 'SLUMP', type: 'quirk', name: 'Slump Buster', cost: 3,
    quirk: 'slump', text: 'After you strike out, your next hit gains +2 bases.' },
  LOADED: { id: 'LOADED', type: 'quirk', name: 'Loaded Dice', cost: 4,
    quirk: 'loaded', text: 'Each at-bat one die is loaded: 50/50 it lands ✦… or ✕.' },
  RABBIT: { id: 'RABBIT', type: 'quirk', name: "Rabbit's Foot", cost: 5,
    quirk: 'rabbit', text: 'Once per game, a strikeout roll is forgiven — all ✕ reroll free.' },
};

/* ---------- Season economy ---------- */
export const ECON = {
  startBudget: 5,
  perRun: 1,       // paid live, every run you drive in
  winBonus: 4,
  lossPay: 1,
  showPay: 1,      // show-up pay every game
  shopSize: 5,
};

export const SEASON_LEN = 10;

/* ---------- CPU scenario archetypes ---------- */
const CPU_SCEN = {
  power: [
    { name: 'DINGER DERBY', req: { POW: 4 }, eff: { kind: 'hit', bases: 4, bonus: 1, label: 'DINGER + 1' } },
    { name: 'WALL BANGER', req: { POW: 3 }, eff: { kind: 'hit', bases: 2, label: 'WALL BANGER' } },
    { name: 'MUSCLE OUT', req: { POW: 2, K: 2 }, eff: { kind: 'walk', label: 'MUSCLED A WALK' } },
  ],
  speed: [
    { name: 'DUST CLOUD', req: { RUN: 4 }, eff: { kind: 'hit', bases: 2, extra: true, label: 'DUST CLOUD' } },
    { name: 'DROP A BUNT', req: { RUN: 2, BAT: 2 }, eff: { kind: 'hit', bases: 1, extra: true, label: 'DRAG BUNT' } },
    { name: 'TAKE OFF', req: { RUN: 2, EYE: 2 }, eff: { kind: 'walk', pre: 'steal', label: 'WALK AND RUN' } },
  ],
  eye: [
    { name: 'X-RAY EYES', req: { EYE: 2, POW: 2 }, eff: { kind: 'hit', bases: 4, label: 'GUESSED RIGHT' } },
    { name: 'PICKED APART', req: { EYE: 2, BAT: 2 }, eff: { kind: 'hit', bases: 2, label: 'PICKED APART' } },
    { name: 'BALK BAIT', req: { EYE: 4 }, eff: { kind: 'walk', pre: 'advance1', label: 'BALK FORCED' } },
  ],
  contact: [
    { name: 'BARREL UP', req: { BAT: 3, POW: 2 }, eff: { kind: 'hit', bases: 4, label: 'BARRELED UP' } },
    { name: 'STAY HOT', req: { BAT: 3 }, eff: { kind: 'hit', bases: 2, label: 'STAY HOT' } },
    { name: 'PEPPER', req: { BAT: 2, RUN: 2 }, eff: { kind: 'hit', bases: 1, extra: true, label: 'PEPPER SHOT' } },
  ],
};

/* ---------- The 10-game season slate ----------
   gear flags are shown snapped to the CPU card AND affect their at-bats:
     eq   — one K becomes BAT on their first roll
     perk — they get 2 rerolls instead of 1
   mod  — pitcher trick used against YOU (same mods as Dice Pennant).
*/
export const OPPONENTS = [
  { key: 'MUD', team: 'MUDVILLE NINE', hero: { name: 'Casey Jr.', pos: 'RF', num: 9 },
    faces: ['BAT', 'BAT', 'POW', 'EYE', 'RUN', 'K'], arch: 'contact',
    gear: {}, mod: null, blurb: 'Plucky. Beatable. Probably.' },
  { key: 'DDV', team: 'DUST DEVILS', hero: { name: 'Twister Cole', pos: 'SS', num: 3 },
    faces: ['RUN', 'RUN', 'BAT', 'BAT', 'EYE', 'K'], arch: 'speed',
    gear: {}, mod: null, blurb: 'They run on everything.' },
  { key: 'HBC', team: 'HARBOR CATS', hero: { name: 'Salty Reyes', pos: '2B', num: 17 },
    faces: ['BAT', 'BAT', 'BAT', 'EYE', 'RUN', 'K'], arch: 'contact',
    gear: {}, mod: 'nohustle', blurb: 'Junkballer on the mound — no hustle bases for you.' },
  { key: 'IRN', team: 'IRON PIGS', hero: { name: 'Hamhock Hale', pos: '1B', num: 33 },
    faces: ['POW', 'POW', 'BAT', 'BAT', 'K', 'K'], arch: 'power',
    gear: { eq: 'GLOVES' }, mod: null, blurb: 'Big swings. Bigger forearms.' },
  { key: 'PGH', team: 'PRAIRIE GHOSTS', hero: { name: 'Whisper Wynn', pos: 'CF', num: 0 },
    faces: ['EYE', 'EYE', 'BAT', 'BAT', 'POW', 'K'], arch: 'eye',
    gear: {}, mod: 'coldeye', blurb: 'With 2 outs, their iceman freezes your ◎ faces.' },
  { key: 'NEO', team: 'NEON KNIGHTS', hero: { name: 'Volt Vargas', pos: 'LF', num: 88 },
    faces: ['POW', 'POW', 'POW', 'BAT', 'K', 'K'], arch: 'power',
    gear: { eq: 'MAPLE' }, mod: null, blurb: 'All gas, no brakes.' },
  { key: 'CPK', team: 'COPPER KINGS', hero: { name: 'Duke Dalton', pos: '3B', num: 21 },
    faces: ['BAT', 'BAT', 'POW', 'POW', 'EYE', 'K'], arch: 'contact',
    gear: { eq: 'GLOVES', perk: 'FILM' }, mod: 'burnlead', blurb: 'Their flamethrower burns your leadoff die to ✕.' },
  { key: 'OWL', team: 'MIDNIGHT OWLS', hero: { name: 'Hoot Moreno', pos: 'C', num: 5 },
    faces: ['EYE', 'EYE', 'EYE', 'BAT', 'POW', 'K'], arch: 'eye',
    gear: { eq: 'SHADES', perk: 'FILM' }, mod: 'coldeye', blurb: 'They see everything. Especially at night.' },
  { key: 'TBD', team: 'THUNDERBIRDS', hero: { name: 'Storm Okafor', pos: 'DH', num: 50 },
    faces: ['POW', 'POW', 'POW', 'BAT', 'BAT', 'K'], arch: 'power',
    gear: { eq: 'MAPLE', perk: 'FILM' }, mod: 'nohustle', blurb: 'The forecast calls for dingers.' },
  { key: 'DYN', team: 'THE DYNASTY', hero: { name: 'Ace Kirby', pos: 'SS', num: 1 },
    faces: ['POW', 'POW', 'BAT', 'BAT', 'EYE', 'K'], arch: 'contact',
    gear: { eq: 'CORK', perk: 'FILM', quirk: 'SWING' }, mod: 'burnlead', blurb: 'Nine pennants. They want ten.' },
];

export function cpuScenarios(opp) { return CPU_SCEN[opp.arch] || []; }
