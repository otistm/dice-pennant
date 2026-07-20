/* BATS-N-BASES — 3D coin toss that decides who bats first.
   Real three.js coin (matches the dice tray aesthetic); falls back to a
   flat DOM coin when WebGL is unavailable. */
import * as THREE from 'three';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function faceTexture(glyph, label, ink) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  // brushed-gold face with a stamped center, like a dugout challenge coin
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, '#FFDE9A');
  g.addColorStop(0.72, '#FFB63B');
  g.addColorStop(1, '#B87818');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.lineWidth = 26;
  x.strokeStyle = '#8A5A10';
  x.beginPath(); x.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2); x.stroke();
  // stitched inner ring — a nod to the baseball
  x.lineWidth = 9;
  x.strokeStyle = 'rgba(90,42,8,.55)';
  x.setLineDash([20, 15]);
  x.beginPath(); x.arc(S / 2, S / 2, S * 0.375, 0, Math.PI * 2); x.stroke();
  x.setLineDash([]);
  x.fillStyle = ink;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '900 200px "Big Shoulders Display",system-ui,sans-serif';
  x.fillText(glyph, S / 2, S / 2 - 62);
  x.font = '900 118px "Big Shoulders Display",system-ui,sans-serif';
  x.fillText(label, S / 2, S / 2 + 108);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/* Flip the coin. Resolves after the result has been shown.
   youFirst — pre-decided result the animation lands on (heads = YOU).
   mount    — element the overlay is appended to.
   isLive   — abort guard; when it returns false the toss cleans up quietly. */
export function coinToss({ youFirst, mount, isLive = () => true, onFlip, onLand }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'bnbCoinToss';
    ov.innerHTML = `<div class="ctTitle">COIN TOSS</div>
      <div class="ctStage"></div>
      <div class="ctCall">&nbsp;</div>
      <div class="ctSub">heads you lead off &mdash; tails they do</div>`;
    mount.appendChild(ov);
    const stage = ov.querySelector('.ctStage');
    const call = ov.querySelector('.ctCall');

    let renderer = null, raf = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      if (renderer) { try { renderer.dispose(); } catch (e) {} }
      ov.remove();
    };
    const finish = async landed => {
      if (landed && isLive()) {
        call.textContent = youFirst ? 'YOU BAT FIRST!' : 'CPU BATS FIRST!';
        call.classList.add('show');
        onLand && onLand();
        await sleep(1300);
      }
      cleanup();
      resolve();
    };

    /* ---------- DOM fallback (no WebGL) ---------- */
    const fallback = () => {
      stage.innerHTML = '<div class="coin2d flipping"><span>YOU</span></div>';
      const coinEl = stage.firstElementChild, span = coinEl.querySelector('span');
      onFlip && onFlip();
      let n = 0;
      const iv = setInterval(() => {
        n++;
        span.textContent = n % 2 ? 'CPU' : 'YOU';
        coinEl.classList.toggle('back', !!(n % 2));
      }, 90);
      setTimeout(() => {
        clearInterval(iv);
        if (!isLive()) { cleanup(); resolve(); return; }
        coinEl.classList.remove('flipping');
        span.textContent = youFirst ? 'YOU' : 'CPU';
        coinEl.classList.toggle('back', !youFirst);
        finish(true);
      }, 1500);
    };

    /* ---------- three.js coin ---------- */
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      if (!renderer.getContext()) throw new Error('no gl');
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(260, 260);
      stage.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
      camera.position.set(0, 2.7, 4.4);
      camera.lookAt(0, 0.15, 0);

      // Coin body: open cylinder rim + two CircleGeometry faces.
      // Circles keep their textures unmirrored on both sides of the flip.
      const R = 1.15, TH = 0.16, GROUND = -0.72;
      const coin = new THREE.Group();
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, TH, 64, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x8a5a10 }));
      const heads = new THREE.Mesh(
        new THREE.CircleGeometry(R, 64),
        new THREE.MeshBasicMaterial({ map: faceTexture('⌁', 'YOU', '#0B231A') }));
      heads.rotation.x = -Math.PI / 2;
      heads.position.y = TH / 2 + 0.001;
      const tails = new THREE.Mesh(
        new THREE.CircleGeometry(R, 64),
        new THREE.MeshBasicMaterial({ map: faceTexture('✕', 'CPU', '#7A1F14') }));
      tails.rotation.x = Math.PI / 2;
      tails.position.y = -TH / 2 - 0.001;
      coin.add(rim, heads, tails);
      coin.position.y = GROUND;
      scene.add(coin);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(1.1, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = GROUND - TH / 2 - 0.02;
      scene.add(shadow);

      const flips = 4 + ((Math.random() * 2) | 0);
      const totalRot = flips * Math.PI * 2 + (youFirst ? 0 : Math.PI); // heads up = YOU
      const FLIGHT = 1900, BOUNCE = 420, PEAK = 1.3;
      let t0 = 0;
      onFlip && onFlip();

      const loop = t => {
        if (!isLive()) { finish(false); return; }
        if (!t0) t0 = t;
        const el = t - t0;
        if (el <= FLIGHT) {
          const p = el / FLIGHT;
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
          coin.rotation.x = totalRot * e;
          coin.rotation.z = 0.22 * Math.sin(p * Math.PI * 2.5) * (1 - p);
          coin.position.y = GROUND + (PEAK - GROUND) * 4 * p * (1 - p);
        } else {
          // settled: tiny dying bounce, exact final orientation
          const q = Math.min(1, (el - FLIGHT) / BOUNCE);
          coin.rotation.x = totalRot;
          coin.rotation.z = 0;
          coin.position.y = GROUND + Math.abs(Math.sin(q * Math.PI * 2)) * 0.16 * (1 - q);
        }
        const h = coin.position.y - GROUND;
        shadow.material.opacity = Math.max(0.1, 0.35 - h * 0.12);
        shadow.scale.setScalar(Math.max(0.6, 1 - h * 0.16));
        renderer.render(scene, camera);
        if (el <= FLIGHT + BOUNCE) raf = requestAnimationFrame(loop);
        else finish(true);
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {
      fallback();
    }
  });
}
