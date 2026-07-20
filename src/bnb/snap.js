/* BATS-N-BASES — gear-to-card snap mechanic.
   Free pointer drag + magnetic proximity snap onto the ballplayer card's
   shape sockets. Ported in spirit from Dugout's seam snapping: half-shapes
   on both pieces complete each other when the tile clicks flush. */

const SNAP_RADIUS = 90;   // px: magnet + drop acceptance
const PULL_MAX = 0.55;    // how hard the magnet tugs the tile at zero distance

/* ---------- tiny synth (matches the game's oscillator SFX style) ---------- */
const snapSfx = (() => {
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
    pickup() { tone(520, 0, .05, 'triangle', .05); },
    snap()   { tone(340, 0, .05, 'square', .09); tone(680, .05, .09, 'square', .08); tone(1020, .1, .12, 'sine', .06); },
    reject() { tone(200, 0, .09, 'sawtooth', .06); tone(150, .08, .12, 'sawtooth', .05); },
    detach() { tone(600, 0, .05, 'triangle', .06); tone(380, .05, .08, 'triangle', .05); },
  };
})();

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/* Burst FX at a socket when a tile locks in. */
export function snapBurst(x, y, color) {
  const ring = document.createElement('div');
  ring.className = 'snapRing';
  ring.style.left = x + 'px'; ring.style.top = y + 'px';
  ring.style.borderColor = color;
  document.body.appendChild(ring);
  for (let i = 0; i < 6; i++) {
    const p = document.createElement('div');
    p.className = 'snapSpark';
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.background = color;
    const ang = (i / 6) * Math.PI * 2 + Math.random() * .6;
    const d = 34 + Math.random() * 22;
    p.style.setProperty('--dx', Math.cos(ang) * d + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * d + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 650);
  }
  setTimeout(() => ring.remove(), 650);
}

/* Animate a fixed-position ghost element to a target rect, then resolve. */
function glideTo(ghost, rect, dur = 190) {
  return new Promise(res => {
    ghost.style.transition = `left ${dur}ms cubic-bezier(.2,1.4,.4,1), top ${dur}ms cubic-bezier(.2,1.4,.4,1), transform ${dur}ms ease`;
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.transform = 'none';
    setTimeout(res, dur + 20);
  });
}

/* Make a shop/inventory gear tile draggable onto card sockets.
   ctx: {
     canDrag()                  -> bool
     getSockets(type)           -> [{ el, slot }] compatible open sockets
     canAfford()                -> bool (checked on drop)
     onSnap(slot)               -> commit equip (re-render)
     onNoFunds()                -> feedback hook
   } */
export function makeGearDraggable(el, type, ctx) {
  el.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || !ctx.canDrag()) return;
    ev.preventDefault();
    const srcRect = el.getBoundingClientRect();
    const grabDX = ev.clientX - srcRect.left, grabDY = ev.clientY - srcRect.top;

    const ghost = el.cloneNode(true);
    ghost.classList.add('dragGhost');
    ghost.style.width = srcRect.width + 'px';
    ghost.style.height = srcRect.height + 'px';
    ghost.style.left = srcRect.left + 'px';
    ghost.style.top = srcRect.top + 'px';
    document.body.appendChild(ghost);
    el.classList.add('lifted');
    snapSfx.pickup();

    const sockets = ctx.getSockets(type).map(s => ({
      ...s, rect: s.el.getBoundingClientRect(),
    }));
    sockets.forEach(s => s.el.classList.add('wants'));
    document.body.classList.add('dragging');

    let hot = null; // socket currently in magnet range

    function ghostAnchor(s) {
      // land the tile centered in the socket bay, flush against the card seam
      return {
        left: s.rect.left + (s.rect.width - srcRect.width) / 2,
        top: s.rect.top + (s.rect.height - srcRect.height) / 2,
      };
    }

    function move(e) {
      let x = e.clientX - grabDX, y = e.clientY - grabDY;
      const gc = { x: x + srcRect.width / 2, y: y + srcRect.height / 2 };
      let best = null, bd = Infinity;
      for (const s of sockets) {
        const d = dist(gc, center(s.rect));
        if (d < bd) { bd = d; best = s; }
      }
      if (best && bd < SNAP_RADIUS) {
        if (hot !== best) {
          if (hot) hot.el.classList.remove('hot');
          hot = best; hot.el.classList.add('hot');
        }
        // magnetic pull toward the flush-anchored position
        const anchor = ghostAnchor(best);
        const pull = PULL_MAX * (1 - bd / SNAP_RADIUS);
        x += (anchor.left - x) * pull;
        y += (anchor.top - y) * pull;
        ghost.classList.add('nearSnap');
      } else {
        if (hot) { hot.el.classList.remove('hot'); hot = null; }
        ghost.classList.remove('nearSnap');
      }
      ghost.style.left = x + 'px';
      ghost.style.top = y + 'px';
    }
    move(ev);

    async function up(e) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      sockets.forEach(s => s.el.classList.remove('wants', 'hot'));

      // judge the drop from both the ghost's center and the raw release point
      // (some input paths deliver down+up with no moves in between)
      const gc = center(ghost.getBoundingClientRect());
      const pt = { x: e.clientX - grabDX + srcRect.width / 2, y: e.clientY - grabDY + srcRect.height / 2 };
      let target = null, bd = Infinity;
      for (const s of sockets) {
        const d = Math.min(dist(gc, center(s.rect)), dist(pt, center(s.rect)));
        if (d < bd) { bd = d; target = s; }
      }
      if (bd >= SNAP_RADIUS) target = null;

      if (target && !ctx.canAfford()) {
        snapSfx.reject();
        ghost.classList.add('rejected');
        ctx.onNoFunds && ctx.onNoFunds();
        await glideTo(ghost, srcRect, 260);
        ghost.remove(); el.classList.remove('lifted');
        return;
      }
      if (target) {
        const anchor = ghostAnchor(target);
        await glideTo(ghost, { left: anchor.left, top: anchor.top }, 130);
        snapSfx.snap();
        const sc = center(target.rect);
        snapBurst(sc.x, sc.y, target.color || '#FFB63B');
        ghost.remove();
        el.classList.remove('lifted');
        ctx.onSnap(target.slot);
        return;
      }
      await glideTo(ghost, srcRect, 220);
      ghost.remove();
      el.classList.remove('lifted');
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/* Make an equipped tile draggable OUT of its socket to sell it.
   Dropping it back on (or near) its own socket cancels; anywhere else sells.
   ctx: { canDrag() -> bool, onSell() -> commit sale (re-render) } */
export function makeSocketTileDraggable(el, sockEl, ctx) {
  el.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || !ctx.canDrag()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const srcRect = el.getBoundingClientRect();
    const sockRect = sockEl.getBoundingClientRect();
    const grabDX = ev.clientX - srcRect.left, grabDY = ev.clientY - srcRect.top;

    const ghost = el.cloneNode(true);
    ghost.classList.add('dragGhost');
    ghost.style.width = srcRect.width + 'px';
    ghost.style.height = srcRect.height + 'px';
    ghost.style.left = srcRect.left + 'px';
    ghost.style.top = srcRect.top + 'px';
    document.body.appendChild(ghost);
    el.classList.add('lifted');
    snapSfx.pickup();
    document.body.classList.add('dragging');

    const outOfSocket = pt => dist(pt, center(sockRect)) >= SNAP_RADIUS;

    function move(e) {
      const x = e.clientX - grabDX, y = e.clientY - grabDY;
      ghost.style.left = x + 'px';
      ghost.style.top = y + 'px';
      const selling = outOfSocket({ x: x + srcRect.width / 2, y: y + srcRect.height / 2 });
      ghost.classList.toggle('selling', selling);
      sockEl.classList.toggle('hot', !selling);
    }
    move(ev);

    async function up(e) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      sockEl.classList.remove('hot');

      // judge from both the ghost's center and the raw release point
      // (some input paths deliver down+up with no moves in between)
      const gc = center(ghost.getBoundingClientRect());
      const pt = { x: e.clientX, y: e.clientY };
      if (outOfSocket(gc) || outOfSocket(pt)) {
        snapSfx.detach();
        ghost.style.transition = 'opacity .18s, transform .18s';
        ghost.style.opacity = '0';
        ghost.style.transform = 'scale(.7)';
        setTimeout(() => ghost.remove(), 200);
        el.classList.remove('lifted');
        ctx.onSell();
        return;
      }
      await glideTo(ghost, srcRect, 180);
      ghost.remove();
      el.classList.remove('lifted');
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

export { snapSfx };
