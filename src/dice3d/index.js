import * as THREE from 'three';

const GLYPH = { BAT: '⌁', POW: '✦', EYE: '◎', RUN: '»', K: '✕' };
const FLABEL = { BAT: 'BAT', POW: 'POW', EYE: 'EYE', RUN: 'RUN', K: '' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= DICE 3D (Three.js) =================
   Real 3D dice in a canvas. Falls back to DOM dice when
   THREE / WebGL is unavailable (e.g. headless tests).    */
const __diceTexCache = {};
const TEX_CACHE_ID = 'crisp1';
const FACE_TEX = 1024; // 4× reference — extra mip headroom keeps labels legible
let __faceUps = null;
function createDiceView(opts = {}) {
  const N = 5, GAP = opts.side ? 1.22 : 1.18, SIZE = 1;
  // BoxGeometry material slots: +x -x +y -y +z -z ; local face normals:
  const NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let renderer, scene, camera, ray, canvas, container;
  let dice = [], defId = null, tapCb = null, live = false;
  let state = { faces: [null,null,null,null,null], sel: [], picking: false, interactive: false };
  const texCache = __diceTexCache;
  const FACE_INK = { BAT:'#0B231A', POW:'#D2703E', EYE:'#1C6E5C', RUN:'#4C7A22', K:'#E14B3B' };

  function polishTexture(t) {
    // Mipmaps stay on for smooth tile edges; max anisotropy keeps labels sharp at tilt.
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 16;
    t.needsUpdate = true;
    return t;
  }

  // Supersample label ink, then downscale onto the face — crisp source for the mip chain.
  function drawFaceLabel(ctx, text, cx, cy, fontSize, ink) {
    if (!text) return;
    const SS = 2, pad = Math.round(fontSize * 0.55);
    const W = fontSize + pad * 2, H = fontSize + pad * 2;
    const oc = document.createElement('canvas');
    oc.width = W * SS; oc.height = H * SS;
    const ox = oc.getContext('2d');
    ox.imageSmoothingEnabled = true;
    ox.imageSmoothingQuality = 'high';
    ox.fillStyle = ink;
    ox.textAlign = 'center';
    ox.textBaseline = 'middle';
    ox.font = `900 ${fontSize * SS}px "Big Shoulders Display",system-ui,sans-serif`;
    ox.fillText(text, oc.width / 2, oc.height / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(oc, Math.round(cx - W / 2), Math.round(cy - H / 2), W, H);
  }

  function faceTexture(f) {
    const key = f + ':' + TEX_CACHE_ID;
    if (texCache[key]) return texCache[key];
    const S = FACE_TEX, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    // dark seam base + rounded chalk tile = soft-edged die look (reference proportions ×4)
    x.fillStyle = '#081A12'; x.fillRect(0, 0, S, S);
    const r = 160, p = 36;
    x.beginPath();
    x.moveTo(p + r, p); x.arcTo(S - p, p, S - p, S - p, r); x.arcTo(S - p, S - p, p, S - p, r);
    x.arcTo(p, S - p, p, p, r); x.arcTo(p, p, S - p, p, r); x.closePath();
    x.fillStyle = f === 'K' ? '#3A1613' : '#EFEAD8'; x.fill();
    x.strokeStyle = f === 'K' ? '#E14B3B' : 'rgba(11,35,26,.25)'; x.lineWidth = 24; x.stroke();
    const ink = FACE_INK[f] || '#0B231A';
    const mid = S / 2;
    drawFaceLabel(x, GLYPH[f], mid, mid - 136, 432, ink);
    drawFaceLabel(x, FLABEL[f], mid, mid + 264, 208, ink);
    texCache[key] = polishTexture(new THREE.CanvasTexture(c));
    return texCache[key];
  }

  function ringTexture() {
    if (texCache.__ring_aa) return texCache.__ring_aa;
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    const g = x.createRadialGradient(S/2, S/2, S*0.18, S/2, S/2, S*0.5);
    g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.55, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return texCache.__ring_aa = polishTexture(new THREE.CanvasTexture(c));
  }

  function init(el) {
    if (typeof THREE === 'undefined') return false;
    try {
      container = el;
      canvas = document.createElement('canvas');
      if (opts.side) canvas.className = 'dice3dSide'; else canvas.id = 'dice3d';
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      if (!renderer.getContext()) throw new Error('no gl');
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      Object.values(texCache).forEach(polishTexture);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, 2, 0.1, 50);
      ray = new THREE.Raycaster();
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const sun = new THREE.DirectionalLight(0xffe2b0, 0.7);
      sun.position.set(2.5, 6, 4); scene.add(sun);
      const rim = new THREE.DirectionalLight(0x6fc7b4, 0.25);
      rim.position.set(-3, 2, -4); scene.add(rim);
      for (let i = 0; i < N; i++) dice.push(makeSlot(i));
      el.innerHTML = ''; el.appendChild(canvas);
      window.addEventListener('resize', resize);
      canvas.addEventListener('pointerdown', onPointer);
      resize();
      live = true;
      requestAnimationFrame(tick);
      return true;
    } catch (e) { return false; }
  }

  function makeSlot(i) {
    const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    const mats = NORMALS.map(() => new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set((i - (N - 1) / 2) * GAP, 0, 0);
    mesh.visible = false;
    mesh.userData.i = i;
    scene.add(mesh);
    // fake contact shadow
    const sh = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(mesh.position.x, -SIZE / 2 + 0.01, 0);
    scene.add(sh);
    // held / picking halo
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.66, 0.86, 32),
      new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xffb63b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.set(mesh.position.x, -SIZE / 2 + 0.02, 0);
    scene.add(halo);
    return { mesh, sh, halo, mode: 'idle', spinAxis: new THREE.Vector3(1, 0, 0), spinSpeed: 0,
             baseY: 0, landFrom: null, landTo: null, landT: 0, landDur: 0.2, faceSlots: [] };
  }

  function setBatter(def) {
    if (!live || defId === def.id) return;
    defId = def.id;
    dice.forEach(d => {
      d.faceSlots = def.faces.slice(0, 6);
      d.mesh.material.forEach((m, s) => { m.map = faceTexture(d.faceSlots[s]); m.needsUpdate = true; });
    });
  }

  // retexture one die's slots (e.g. gear converting a face); pass 6 faces
  function setDieFaces(i, faces6) {
    if (!live || !dice[i]) return;
    const d = dice[i];
    d.faceSlots = faces6.slice(0, 6);
    d.mesh.material.forEach((m, s) => { m.map = faceTexture(d.faceSlots[s]); m.needsUpdate = true; });
  }

  function computeFaceUps() {
    // for each of the 6 box faces, find the local direction of increasing v
    // (with flipY textures, that's the direction the label's top points)
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const pos = geo.attributes.position, uv = geo.attributes.uv, ups = [];
    for (let g = 0; g < 6; g++) {
      const idx = Array.from(geo.index.array.slice(g * 6, g * 6 + 6));
      const a = idx[0];
      let b = a;
      for (const j of idx) {
        if (Math.abs(uv.getX(j) - uv.getX(a)) < 1e-6 && Math.abs(uv.getY(j) - uv.getY(a)) > 0.5) { b = j; break; }
      }
      const va = new THREE.Vector3().fromBufferAttribute(pos, a);
      const vb = new THREE.Vector3().fromBufferAttribute(pos, b);
      const up = (uv.getY(b) > uv.getY(a) ? vb.sub(va) : va.sub(vb)).normalize();
      ups.push(up);
    }
    geo.dispose();
    return ups;
  }

  function upQuatFor(d, face) {
    // orient the rolled face toward the camera with its label upright
    if (!__faceUps) __faceUps = computeFaceUps();
    const slots = [];
    d.faceSlots.forEach((f, s) => { if (f === face) slots.push(s); });
    const s = slots.length ? slots[(Math.random() * slots.length) | 0] : 2;
    const n = new THREE.Vector3(...NORMALS[s]);           // local face normal
    const u = __faceUps[s].clone();                        // local label-up
    const z2 = camera.position.clone().sub(new THREE.Vector3(d.mesh.position.x, 0, 0)).normalize();
    const y2 = new THREE.Vector3(0, 1, 0).addScaledVector(z2, -z2.y).normalize(); // screen-up ⟂ view dir
    const x2 = new THREE.Vector3().crossVectors(y2, z2);
    const W = new THREE.Matrix4().makeBasis(x2, y2, z2);
    const L = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(u, n), u, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(W.multiply(L.transpose()));
    const jitter = new THREE.Quaternion().setFromAxisAngle(n, (Math.random() - .5) * 0.12);
    return q.multiply(jitter);
  }

  function setDieMaterial(d, face) {
    const locked = face === 'K';
    d.mesh.material.forEach(m => {
      m.color.setHex(locked ? 0x8a5450 : 0xffffff);
      m.transparent = false;
      m.opacity = 1;
    });
  }

  function setGhostMaterial(d) {
    d.mesh.material.forEach(m => {
      m.color.setHex(0x8f8f85);
      m.transparent = false;
      m.opacity = 1;
    });
  }

  function setState(s) {
    if (!live) return;
    state = {
      ...s,
      faces: s.faces ? s.faces.slice() : [],
      sel: s.sel ? s.sel.slice() : [],
      ghostFaces: s.ghostFaces ? s.ghostFaces.slice() : null,
    };
    dice.forEach((d, i) => {
      const f = s.faces[i];
      const ghost = f == null && s.ghostFaces && s.ghostFaces[i] != null;
      d.mesh.visible = f != null || ghost;
      d.sh.visible = d.halo.visible = d.mesh.visible;
      if (!d.mesh.visible) { d.halo.material.opacity = 0; return; }
      if (ghost) {
        // resting, dimmed dice showing the batter's face mix before the throw
        if (d.ghostFor !== s.ghostFaces[i]) {
          d.ghostFor = s.ghostFaces[i];
          d.mesh.quaternion.copy(upQuatFor(d, s.ghostFaces[i]));
        }
        setGhostMaterial(d);
        d.baseY = 0;
        return;
      }
      d.ghostFor = null;
      setDieMaterial(d, f);
      if (d.mode === 'idle') d.baseY = (s.sel[i] && (s.kSelectable || f !== 'K')) ? 0.42 : 0;
    });
  }

  // spinning[] -> tumble; finals from faces[]; staggered face-up landings
  function roll(spinning, finals, isLiveFn, onLand) {
    if (!live) return Promise.resolve();
    const stops = [];
    let order = 0;
    dice.forEach((d, i) => {
      if (finals[i] == null) return;
      d.mesh.visible = d.sh.visible = d.halo.visible = true;
      d.ghostFor = null;
      setDieMaterial(d, finals[i]);
      if (!spinning[i]) return;   // unselected / K dice sit still
      d.mode = 'spin';
      d.halo.material.opacity = 0;
      d.spinAxis.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
      d.spinSpeed = 11 + Math.random() * 7;
      d.spinPhase = Math.random() * Math.PI * 2;
      const stopAt = 380 + order * 100 + ((Math.random() * 60) | 0);
      const n = order; order++;
      stops.push(new Promise(done => setTimeout(() => {
        if (!isLiveFn()) { d.mode = 'idle'; return done(); }
        d.mode = 'land';
        d.landFrom = d.mesh.quaternion.clone();
        d.landTo = upQuatFor(d, finals[i]);
        d.landT = 0; d.landFromY = d.mesh.position.y;
        onLand && onLand(n);
        setTimeout(done, 230);
      }, stopAt)));
    });
    if (!stops.length) return sleep(200);
    return Promise.all(stops).then(() => sleep(120)).then(() => {
      setState({ ...state, faces: finals.slice(), ghostFaces: null });
    });
  }

  const clock = (typeof THREE !== 'undefined') ? new THREE.Clock() : null;
  let t0 = 0, failCb = null, frameErrs = 0, probeOK = false, probeFrames = 0;
  function probe() {
    // read back a strip of pixels; if dice are on stage but nothing is ever
    // drawn, this renderer is lying to us — bail out to the DOM dice
    if (opts.side || probeOK || !dice.some(d => d.mesh.visible)) return;
    const gl = renderer.getContext();
    if (!gl || !gl.readPixels) { probeOK = true; return; }
    const W = canvas.width, H = canvas.height, px = new Uint8Array(4);
    for (let s = 1; s <= 5; s++) {
      gl.readPixels(((W * s / 6) | 0), (H / 2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] || px[1] || px[2] || px[3]) { probeOK = true; return; }
    }
    if (++probeFrames > 90) throw new Error('3D output blank');
  }
  function tick() {
    if (!live) return;
    requestAnimationFrame(tick);
    try {
      step();
      probe();
      frameErrs = 0;
    } catch (e) {
      if (++frameErrs >= 3 || /blank/.test(e.message)) {   // 3D is broken here: let DOM dice take over
        live = false;
        try { canvas.remove(); } catch (_) {}
        failCb && failCb(e);
      }
    }
  }
  function step() {
    const dt = Math.min(clock.getDelta(), 0.05);
    t0 += dt;
    dice.forEach((d, i) => {
      if (!d.mesh.visible) return;
      const m = d.mesh;
      if (d.mode === 'spin') {
        // airborne tumble: hop + free rotation, axis drifts
        m.position.y = 0.75 + 0.3 * Math.sin(t0 * 10 + d.spinPhase);
        d.spinAxis.x += (Math.random() - .5) * 0.15; d.spinAxis.normalize();
        const dq = new THREE.Quaternion().setFromAxisAngle(d.spinAxis, d.spinSpeed * dt);
        m.quaternion.premultiply(dq);
      } else if (d.mode === 'land') {
        d.landT = Math.min(1, d.landT + dt / d.landDur);
        const t = d.landT, e = 1 - Math.pow(1 - t, 3);        // ease-out cubic
        m.quaternion.copy(d.landFrom).slerp(d.landTo, e);
        // drop with one small rebound
        const y = t < 0.62 ? d.landFromY * (1 - t / 0.62)
                : 0.14 * Math.sin(Math.PI * (t - 0.62) / 0.38);
        m.position.y = Math.max(0, y);
        if (t >= 1) { d.mode = 'idle'; m.quaternion.copy(d.landTo); m.position.y = 0; }
      } else {
        // idle: glide toward baseY; selected dice float gently
        const target = d.baseY + (d.baseY > 0 ? 0.045 * Math.sin(t0 * 3 + i) : 0);
        m.position.y += (target - m.position.y) * Math.min(1, dt * 10);
      }
      // contact shadow + halo track height
      const h = m.position.y;
      d.sh.material.opacity = Math.max(0.08, 0.42 - h * 0.28);
      d.sh.scale.setScalar(Math.max(0.55, 1 - h * 0.3));
      const sel = state.sel[i] && (state.kSelectable || state.faces[i] !== 'K');   // marked for the rethrow
      const pick = state.picking && state.faces[i] != null;
      d.halo.material.color.setHex(pick ? 0x6fc7b4 : 0xd2703e);
      d.halo.material.opacity = d.mode !== 'idle' ? 0 : pick ? 0.55 + 0.3 * Math.sin(t0 * 6) : sel ? 0.85 : 0;
    });
    renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth || 320, h = container.clientHeight || 118;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pull camera in close — dice should dominate the tray.
    // side/ace seats use a slightly looser frame than the main tray.
    const pad = opts.side ? 0.42 : 0.32;
    const near = opts.side ? 0.28 : 0.18;
    const half = (N - 1) / 2 * GAP + SIZE * pad;
    const vfov = camera.fov * Math.PI / 180;
    const dist = Math.max(opts.side ? 3.2 : 3.05, half / (Math.tan(vfov / 2) * camera.aspect) + near);
    camera.position.set(0, dist * 0.62, dist);
    camera.lookAt(0, 0.35, 0);
    camera.updateProjectionMatrix();
  }

  function onPointer(ev) {
    if (!state.interactive || !tapCb) return;
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const hit = ray.intersectObjects(dice.map(d => d.mesh))[0];
    if (hit) tapCb(hit.object.userData.i);
  }

  return { init, setBatter, setDieFaces, setState, roll, resize, onTap: cb => tapCb = cb,
           onFail: cb => failCb = cb,
           _dbg: () => ({ dice, state, live, NORMALS, camera, faceUps: __faceUps }) };
}
const Dice3D = createDiceView();
export default Dice3D;
export { createDiceView };

