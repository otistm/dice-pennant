/* BATS-N-BASES — 3D coin toss that decides who bats first.
   Real three.js coin (matches the dice tray aesthetic); falls back to a
   flat DOM coin when WebGL is unavailable. Always mounts on document.body
   so it covers the viewport as a true overlay (not a flex child of #bnbScreen). */
import * as THREE from 'three';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function faceTexture(glyph, label, ink) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, '#FFDE9A');
  g.addColorStop(0.72, '#FFB63B');
  g.addColorStop(1, '#B87818');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.lineWidth = 26;
  x.strokeStyle = '#8A5A10';
  x.beginPath(); x.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2); x.stroke();
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
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* Flip the coin. Resolves after the result has been shown.
   youFirst — pre-decided result the animation lands on (heads = YOU).
   isLive   — abort guard; when it returns false the toss cleans up quietly. */
export function coinToss({ youFirst, isLive = () => true, onFlip, onLand }) {
  return new Promise(resolve => {
    // tear down any leftover toss (double-clicks / HMR)
    document.getElementById('bnbCoinToss')?.remove();

    const ov = document.createElement('div');
    ov.id = 'bnbCoinToss';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Coin toss');
    ov.innerHTML = `<div class="ctTitle">COIN TOSS</div>
      <div class="ctStage"></div>
      <div class="ctCall">&nbsp;</div>
      <div class="ctSub">heads you lead off &mdash; tails they do</div>`;
    // Body mount: escape #bnbScreen's flex + overflow, always cover the viewport
    document.body.appendChild(ov);
    const stage = ov.querySelector('.ctStage');
    const call = ov.querySelector('.ctCall');

    let renderer = null, raf = 0, done = false;
    const disposables = [];
    const cleanup = () => {
      cancelAnimationFrame(raf);
      disposables.forEach(o => { try { o.dispose?.(); } catch (e) {} });
      if (renderer) {
        try { renderer.dispose(); renderer.forceContextLoss?.(); } catch (e) {}
        renderer.domElement?.remove();
        renderer = null;
      }
      ov.remove();
    };
    const finish = async landed => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      if (landed && isLive()) {
        call.textContent = youFirst ? 'YOU BAT FIRST!' : 'CPU BATS FIRST!';
        call.classList.add('show');
        try { onLand && onLand(); } catch (e) {}
        await sleep(1300);
      }
      cleanup();
      resolve();
    };

    /* ---------- DOM fallback (no WebGL / context exhaustion) ---------- */
    const fallback = () => {
      stage.innerHTML = '<div class="coin2d flipping"><span>YOU</span></div>';
      const coinEl = stage.firstElementChild, span = coinEl.querySelector('span');
      try { onFlip && onFlip(); } catch (e) {}
      let n = 0;
      const iv = setInterval(() => {
        n++;
        span.textContent = n % 2 ? 'CPU' : 'YOU';
        coinEl.classList.toggle('back', !!(n % 2));
      }, 90);
      setTimeout(() => {
        clearInterval(iv);
        if (!isLive()) { finish(false); return; }
        coinEl.classList.remove('flipping');
        span.textContent = youFirst ? 'YOU' : 'CPU';
        coinEl.classList.toggle('back', !youFirst);
        finish(true);
      }, 1500);
    };

    /* ---------- three.js coin ---------- */
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      if (!renderer.getContext()) throw new Error('no gl');
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(320, 320);
      renderer.setClearColor(0x000000, 0);
      stage.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
      // Framed so the coin stays inside the canvas even at the peak of the toss
      camera.position.set(0, 1.55, 5.4);
      camera.lookAt(0, 0.05, 0);

      const R = 1.05, TH = 0.15, GROUND = -0.55;
      const coin = new THREE.Group();
      const rimGeo = new THREE.CylinderGeometry(R, R, TH, 64, 1, true);
      const headsGeo = new THREE.CircleGeometry(R, 64);
      const tailsGeo = new THREE.CircleGeometry(R, 64);
      const shadowGeo = new THREE.CircleGeometry(1.1, 32);
      const rimMat = new THREE.MeshBasicMaterial({ color: 0x8a5a10 });
      const headsMat = new THREE.MeshBasicMaterial({ map: faceTexture('⌁', 'YOU', '#0B231A') });
      const tailsMat = new THREE.MeshBasicMaterial({ map: faceTexture('✕', 'CPU', '#7A1F14') });
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false,
      });
      disposables.push(rimGeo, headsGeo, tailsGeo, shadowGeo, rimMat, headsMat, tailsMat, shadowMat,
        headsMat.map, tailsMat.map);

      const rim = new THREE.Mesh(rimGeo, rimMat);
      const heads = new THREE.Mesh(headsGeo, headsMat);
      heads.rotation.x = -Math.PI / 2;
      heads.position.y = TH / 2 + 0.001;
      const tails = new THREE.Mesh(tailsGeo, tailsMat);
      tails.rotation.x = Math.PI / 2;
      tails.position.y = -TH / 2 - 0.001;
      coin.add(rim, heads, tails);
      coin.position.y = GROUND;
      scene.add(coin);

      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = GROUND - TH / 2 - 0.02;
      scene.add(shadow);

      const flips = 4 + ((Math.random() * 2) | 0);
      const totalRot = flips * Math.PI * 2 + (youFirst ? 0 : Math.PI);
      const FLIGHT = 1900, BOUNCE = 420, PEAK = 0.95;
      let t0 = 0;
      try { onFlip && onFlip(); } catch (e) {}

      const loop = t => {
        if (done) return;
        if (!isLive()) { finish(false); return; }
        try {
          if (!t0) t0 = t;
          const el = t - t0;
          if (el <= FLIGHT) {
            const p = el / FLIGHT;
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            coin.rotation.x = totalRot * e;
            coin.rotation.z = 0.22 * Math.sin(p * Math.PI * 2.5) * (1 - p);
            coin.position.y = GROUND + (PEAK - GROUND) * 4 * p * (1 - p);
          } else {
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
        } catch (err) {
          // WebGL died mid-flip — finish with the already-decided result
          finish(true);
        }
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {
      fallback();
    }
  });
}
