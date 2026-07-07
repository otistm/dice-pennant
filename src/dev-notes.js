const $ = id => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso || '';
  }
}

async function loadDevNotes() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}dev-notes.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('missing');
    return await r.json();
  } catch {
    return { notes: [] };
  }
}

function renderDevNotes(data) {
  const list = $('devNotesList');
  if (!list) return;
  const notes = (data.notes || []).slice().reverse();
  if (!notes.length) {
    list.innerHTML = '<p class="devNotesEmpty">No commits logged yet.</p>';
    return;
  }
  list.innerHTML = notes.map(n => `
    <article class="devNote">
      <time datetime="${escapeHtml(n.date || '')}">${escapeHtml(formatDate(n.date))}</time>
      <code>${escapeHtml(n.sha || '')}</code>
      <p>${escapeHtml(n.message || '')}</p>
    </article>
  `).join('');
}

const btn = $('devNotesBtn');
const overlay = $('devNotesOverlay');
const close = $('devNotesClose');

btn?.addEventListener('click', async () => {
  renderDevNotes(await loadDevNotes());
  overlay?.classList.add('on');
});

close?.addEventListener('click', () => overlay?.classList.remove('on'));
