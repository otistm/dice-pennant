import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.source.html'), 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

if (!styleMatch || !bodyMatch || scripts.length < 4) {
  console.error('Unexpected HTML structure');
  process.exit(1);
}

const dirs = ['src/styles', 'src/engine', 'src/dice3d', 'src/app', 'public'];
for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });

fs.writeFileSync(path.join(root, 'src/styles/main.css'), styleMatch[1].trim() + '\n');

const bodyHtml = bodyMatch[1].replace(/<script>[\s\S]*?<\/script>/g, '').trim();
fs.writeFileSync(path.join(root, 'src/app/body.html'), bodyHtml + '\n');

// DP engine: convert UMD to ES module
let dp = scripts[0][1].trim();
const factoryStart = dp.indexOf('function () {');
const factoryEnd = dp.lastIndexOf('return { F,');
const returnEnd = dp.indexOf('};', factoryEnd);
if (factoryStart < 0 || returnEnd < 0) {
  console.error('Could not parse DP engine UMD wrapper');
  process.exit(1);
}
dp = `/* DICE PENNANT — pure engine. No DOM. Node + browser. */\nexport default (${dp.slice(factoryStart, returnEnd + 1)})();\n`;
fs.writeFileSync(path.join(root, 'src/engine/dp.js'), dp);

// Dice3D + app split
const client = scripts[3][1];
const splitAt = client.indexOf("const Dice3D = createDiceView();");
if (splitAt < 0) {
  console.error('Could not find Dice3D split point');
  process.exit(1);
}

let dice3d = client.slice(0, splitAt + 'const Dice3D = createDiceView();'.length).trim();
dice3d = `import * as THREE from 'three';\n\nconst GLYPH = { BAT: '⌁', POW: '✦', EYE: '◎', RUN: '»', K: '✕' };\nconst FLABEL = { BAT: 'BAT', POW: 'POW', EYE: 'EYE', RUN: 'RUN', K: '' };\nconst sleep = ms => new Promise(r => setTimeout(r, ms));\n\n${dice3d.replace(/^import \* as THREE from 'three';\n\n/, '')}\nexport default Dice3D;\n`;
fs.writeFileSync(path.join(root, 'src/dice3d/index.js'), dice3d + '\n');

let app = client.slice(splitAt + 'const Dice3D = createDiceView();'.length).trim();
app = `import DP from '../engine/dp.js';\nimport Dice3D from '../dice3d/index.js';\n\n${app}\n`;
fs.writeFileSync(path.join(root, 'src/app/main.js'), app + '\n');

console.log('Extracted:');
console.log('  src/styles/main.css');
console.log('  src/engine/dp.js');
console.log('  src/dice3d/index.js');
console.log('  src/app/main.js');
console.log('  src/app/body.html');
