import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'dev-notes.json');

function gitNotes() {
  try {
    const raw = execSync('git log --pretty=format:%H|%aI|%s', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      const i = line.indexOf('|');
      const j = line.indexOf('|', i + 1);
      const sha = line.slice(0, i);
      const date = line.slice(i + 1, j);
      const message = line.slice(j + 1);
      return { sha: sha.slice(0, 7), date, message };
    });
  } catch {
    return [];
  }
}

const notes = gitNotes();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  repo: 'otistm/dice-pennant',
  updated: new Date().toISOString(),
  notes,
}, null, 2) + '\n');

console.log(`dev-notes.json — ${notes.length} commit(s)`);
