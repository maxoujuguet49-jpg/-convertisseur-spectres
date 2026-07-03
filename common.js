const SQZ = {'@':0,'A':1,'B':2,'C':3,'D':4,'E':5,'F':6,'G':7,'H':8,'I':9,
             'a':-1,'b':-2,'c':-3,'d':-4,'e':-5,'f':-6,'g':-7,'h':-8,'i':-9};
const DIF = {'%':0,'J':1,'K':2,'L':3,'M':4,'N':5,'O':6,'P':7,'Q':8,'R':9,
             'j':-1,'k':-2,'l':-3,'m':-4,'n':-5,'o':-6,'p':-7,'q':-8,'r':-9};
const DUP = {'S':1,'T':2,'U':3,'V':4,'W':5,'X':6,'Y':7,'Z':8};

function tokenizeASDFLine(line) {
  const tokens = [];
  let i = 0, currentToken = '', mode = null;
  function flush() {
    if (currentToken !== '' && currentToken !== '-' && currentToken !== '+' && currentToken !== '.') {
      tokens.push({ value: parseFloat(currentToken), mode });
    }
    currentToken = ''; mode = null;
  }
  while (i < line.length) {
    const c = line[i];
    if (c in SQZ) { flush(); mode = 'sqz'; currentToken = String(SQZ[c]); }
    else if (c in DIF) { flush(); mode = 'dif'; currentToken = String(DIF[c]); }
    else if (c in DUP) { flush(); tokens.push({ value: DUP[c], mode: 'dup' }); }
    else if (c === '+' || c === '-') { flush(); mode = 'plain'; currentToken = c; }
    else if (/[0-9.]/.test(c)) { if (mode === null) mode = 'plain'; currentToken += c; }
    else if (c === ' ' || c === '\t' || c === ',') { flush(); }
    i++;
  }
  flush();
  return tokens;
}

function decodeLineToYValues(tokens) {
  const ys = [];
  let runningY = null, lastDelta = 0;
  for (let idx = 1; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (t.mode === 'dup') {
      for (let k = 0; k < t.value - 1; k++) { runningY = runningY + lastDelta; ys.push(runningY); }
    } else if (t.mode === 'dif') {
      runningY = (runningY === null ? 0 : runningY) + t.value;
      lastDelta = t.value;
      ys.push(runningY);
    } else {
      runningY = t.value; lastDelta = 0; ys.push(runningY);
    }
  }
  return ys;
}

function parseJcamp(text) {
  const lines = text.split(/\r?\n/);
  const meta = {};
  let dataLines = [], inData = false, dataFormat = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('##')) {
      const eq = line.indexOf('=');
      const label = line.slice(2, eq === -1 ? undefined : eq).trim().toUpperCase();
      const value = eq === -1 ? '' : line.slice(eq + 1).trim();
      if (label === 'XYDATA') { inData = true; dataFormat = 'XYDATA'; meta[label] = value; continue; }
      if (label === 'XYPOINTS') { inData = true; dataFormat = 'XYPOINTS'; meta[label] = value; continue; }
      if (label === 'END') { inData = false; continue; }
      meta[label] = value; inData = false;
    } else if (inData) {
      dataLines.push(line);
    }
  }

  if (!dataFormat) throw new Error("Aucun bloc ##XYDATA= ou ##XYPOINTS= trouvé dans le fichier.");

  const xFactor = parseFloat(meta['XFACTOR'] || '1') || 1;
  const yFactor = parseFloat(meta['YFACTOR'] || '1') || 1;
  const firstX = parseFloat(meta['FIRSTX']);
  const lastX = parseFloat(meta['LASTX']);
  const nPoints = parseInt(meta['NPOINTS'], 10);

  let xs = [], ys = [];

  if (dataFormat === 'XYPOINTS') {
    for (const line of dataLines) {
      for (const p of line.split(';')) {
        const parts = p.trim().split(/[\s,]+/).filter(Boolean);
        if (parts.length >= 2) {
          xs.push(parseFloat(parts[0]) * xFactor);
          ys.push(parseFloat(parts[1]) * yFactor);
        }
      }
    }
  } else {
    if (isNaN(firstX) || isNaN(lastX) || !nPoints) {
      throw new Error("Métadonnées FIRSTX / LASTX / NPOINTS manquantes ou invalides.");
    }
    const deltaX = nPoints > 1 ? (lastX - firstX) / (nPoints - 1) : 1;
    let globalIndex = 0;
    for (const line of dataLines) {
      const tokens = tokenizeASDFLine(line);
      if (tokens.length === 0) continue;
      const rawYs = decodeLineToYValues(tokens);
      for (const ry of rawYs) {
        xs.push((firstX + globalIndex * deltaX) * xFactor);
        ys.push(ry * yFactor);
        globalIndex++;
      }
    }
  }

  if (xs.length === 0) throw new Error("Aucun point de données n'a pu être décodé.");
  return { meta, xs, ys };
}

/* =========================================================
   SVG trace rendering
   ========================================================= */
function buildTracePath(xs, ys, width, height, padding) {
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = (xMax - xMin) || 1;
  const ySpan = (yMax - yMin) || 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  let d = '';
  for (let i = 0; i < xs.length; i++) {
    // JCAMP X often decreases (e.g. wavenumber); normalize by index position for plotting stability
    const px = padding + ((xs[i] - xMin) / xSpan) * innerW;
    const py = padding + innerH - ((ys[i] - yMin) / ySpan) * innerH;
    d += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2) + ' ';
  }
  return d.trim();
}

function renderTrace(svgEl, xs, ys, opts) {
  opts = opts || {};
  const vb = svgEl.viewBox.baseVal;
  const w = vb.width || 860, h = vb.height || 200;
  const pad = opts.padding !== undefined ? opts.padding : 14;
  const d = buildTracePath(xs, ys, w, h, pad);
  svgEl.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';

  const axis = document.createElementNS(ns, 'line');
  axis.setAttribute('x1', pad); axis.setAttribute('x2', w - pad);
  axis.setAttribute('y1', h - pad); axis.setAttribute('y2', h - pad);
  axis.setAttribute('class', 'axis');
  svgEl.appendChild(axis);

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'line' + (opts.animate ? ' draw-in' : ''));
  svgEl.appendChild(path);
}

/* =========================================================
   Exporters
   ========================================================= */
function toCSV(xs, ys, xLabel, yLabel) {
  let out = (xLabel || 'x') + ',' + (yLabel || 'y') + '\n';
  for (let i = 0; i < xs.length; i++) out += xs[i] + ',' + ys[i] + '\n';
  return out;
}
function toJSON(meta, xs, ys) {
  const data = xs.map((x, i) => ({ x, y: ys[i] }));
  return JSON.stringify({ metadata: meta, points: data }, null, 2);
}
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function baseName(name) { return name.replace(/\.[^/.]+$/, ''); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* =========================================================
   Sample file (demo)
   ========================================================= */
const SAMPLE_JCAMP = `##TITLE=Polymer film - lot A (reference)
##JCAMP-DX=5.01
##DATA TYPE=INFRARED SPECTRUM
##ORIGIN=Prototype Lab
##OWNER=Public
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##XFACTOR=1
##YFACTOR=1
##FIRSTX=4000
##LASTX=700
##NPOINTS=120
##XYDATA=(X++(Y..Y))
4000 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.949
3778.15 0.949 0.948 0.945 0.941 0.934 0.924 0.908 0.885
3556.3 0.856 0.819 0.777 0.731 0.686 0.646 0.617 0.602
3334.45 0.603 0.62 0.65 0.691 0.736 0.782 0.824 0.86
3112.61 0.889 0.91 0.925 0.933 0.918 0.83 0.684 0.668
2890.76 0.809 0.917 0.946 0.95 0.95 0.95 0.95 0.95
2668.91 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
2447.06 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
2225.21 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
2003.36 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
1781.51 0.935 0.789 0.452 0.512 0.84 0.942 0.95 0.95
1559.66 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
1337.82 0.95 0.95 0.949 0.942 0.9 0.788 0.665 0.68
1115.97 0.812 0.912 0.944 0.95 0.95 0.95 0.95 0.95
894.12 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
##END=
`;

const SAMPLE_JCAMP_B = `##TITLE=Polymer film - lot B (variante)
##JCAMP-DX=5.01
##DATA TYPE=INFRARED SPECTRUM
##ORIGIN=Prototype Lab
##OWNER=Public
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##XFACTOR=1
##YFACTOR=1
##FIRSTX=4000
##LASTX=700
##NPOINTS=120
##XYDATA=(X++(Y..Y))
4000 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
3778.15 0.949 0.948 0.947 0.944 0.939 0.932 0.922 0.907
3556.3 0.886 0.86 0.829 0.793 0.756 0.72 0.688 0.664
3334.45 0.652 0.651 0.664 0.687 0.718 0.754 0.792 0.827
3112.61 0.859 0.885 0.906 0.92 0.917 0.853 0.72 0.672
2890.76 0.791 0.907 0.944 0.949 0.95 0.95 0.95 0.95
2668.91 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
2447.06 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
2225.21 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
2003.36 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
1781.51 0.943 0.873 0.656 0.562 0.774 0.922 0.949 0.95
1559.66 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
1337.82 0.95 0.95 0.949 0.942 0.904 0.791 0.617 0.53
1115.97 0.632 0.805 0.91 0.943 0.949 0.95 0.95 0.95
894.12 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
##END=
`;

/* =========================================================
   Scroll reveal
   ========================================================= */
(function setupScrollReveal() {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });
  targets.forEach(el => observer.observe(el));
})();

/* =========================================================
   3D molecule (hero signature element)
   ========================================================= */
function initMoleculeScene() {
  const container = document.getElementById('moleculeCanvas');
  if (!container || typeof THREE === 'undefined') return;

  const atomColors = [0x57C9AC, 0xE8B85F, 0xEC8478, 0x83AEE0, 0xD19BC7];
  // simple ball-and-stick oligomer: a backbone chain with a couple of branches
  const atoms = [
    [0, 0, 0], [1.1, 0.4, 0.2], [2.1, -0.2, 0.5], [3.2, 0.3, 0.1],
    [4.1, -0.3, -0.3], [1.1, 1.5, 0.6], [2.1, -1.3, 0.7],
    [-1.1, 0.5, -0.4], [-1.9, -0.4, 0.5], [3.2, 1.4, 0.6],
    [4.9, 0.5, -0.9], [-1.6, 1.6, -0.9]
  ];
  const bonds = [
    [0,1],[1,2],[2,3],[3,4],[1,5],[2,6],[0,7],[7,8],[3,9],[4,10],[7,11]
  ];

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight || 1.4, 0.1, 100);
  camera.position.set(0, 0, 9);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(4, 6, 8);
  scene.add(dirLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
  rimLight.position.set(-5, -3, -4);
  scene.add(rimLight);

  const group = new THREE.Group();

  // center the molecule
  const center = atoms.reduce((acc, p) => [acc[0]+p[0], acc[1]+p[1], acc[2]+p[2]], [0,0,0]).map(v => v / atoms.length);
  const positions = atoms.map(p => new THREE.Vector3(p[0]-center[0], p[1]-center[1], p[2]-center[2]));

  positions.forEach((pos, i) => {
    const radius = i === 0 ? 0.34 : 0.24;
    const geo = new THREE.SphereGeometry(radius, 20, 20);
    const mat = new THREE.MeshStandardMaterial({ color: atomColors[i % atomColors.length], roughness: 0.4, metalness: 0.05 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(pos);
    group.add(sphere);
  });

  bonds.forEach(([a, b]) => {
    const pa = positions[a], pb = positions[b];
    const dir = new THREE.Vector3().subVectors(pb, pa);
    const length = dir.length();
    const geo = new THREE.CylinderGeometry(0.07, 0.07, length, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0xC7D3D6, roughness: 0.55 });
    const cyl = new THREE.Mesh(geo, mat);
    cyl.position.copy(pa).addScaledVector(dir, 0.5);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    group.add(cyl);
  });

  group.rotation.x = 0.3;
  scene.add(group);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  function animate() {
    if (!reduceMotion) group.rotation.y += 0.006;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

/* =========================================================
   3D waterfall spectrum (home page signature visual)
   ========================================================= */
function generateWaterfallRow(xMin, xMax, nPoints, seed) {
  const peaks = [
    { center: xMin + (xMax - xMin) * 0.15, height: 0.8 + 0.3 * Math.sin(seed * 1.3), width: 90 },
    { center: xMin + (xMax - xMin) * 0.35, height: 0.55 + 0.2 * Math.sin(seed * 2.1), width: 70 },
    { center: xMin + (xMax - xMin) * 0.55, height: 0.9 + 0.25 * Math.sin(seed * 0.7), width: 60 },
    { center: xMin + (xMax - xMin) * 0.72, height: 0.4 + 0.15 * Math.sin(seed * 1.9), width: 50 },
    { center: xMin + (xMax - xMin) * 0.88, height: 0.65 + 0.2 * Math.sin(seed * 2.6), width: 80 },
  ];
  const xs = [], ys = [];
  for (let i = 0; i < nPoints; i++) {
    const x = xMin + (xMax - xMin) * (i / (nPoints - 1));
    let y = 0.05;
    for (const p of peaks) y += p.height * Math.exp(-Math.pow((x - p.center) / p.width, 2));
    xs.push(x); ys.push(y);
  }
  return { xs, ys };
}

function rainbowHue(t) {
  return 0.66 * (1 - Math.max(0, Math.min(1, t)));
}

function initWaterfallScene(containerId) {
  const container = document.getElementById(containerId);
  if (!container || typeof THREE === 'undefined') return;

  const N_TRACES = 24, N_POINTS = 70;
  const xMin = 400, xMax = 4000;
  const spread = 7;
  const depthStep = 0.16;
  const rise = 0.05;
  const heightScale = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight || 1.7, 0.1, 100);
  camera.position.set(0, 3.6, 7.2);
  camera.lookAt(0, 0.4, -1.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  const group = new THREE.Group();
  const sparkPositions = [];

  for (let row = 0; row < N_TRACES; row++) {
    const { xs, ys } = generateWaterfallRow(xMin, xMax, N_POINTS, row * 0.37 + 1);
    const positions = new Float32Array(N_POINTS * 3);
    const colors = new Float32Array(N_POINTS * 3);
    const z = -row * depthStep;
    const yOffset = row * rise;

    let maxY = -Infinity, maxIdx = 0;
    for (let i = 0; i < N_POINTS; i++) {
      const t = i / (N_POINTS - 1);
      const px = (t - 0.5) * spread;
      const py = ys[i] * heightScale + yOffset;
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = z;

      const hue = rainbowHue(t);
      const color = new THREE.Color();
      color.setHSL(hue, 0.75, 0.55);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;

      if (ys[i] > maxY) { maxY = ys[i]; maxIdx = i; }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
    group.add(new THREE.Line(geo, mat));

    if (row % 3 === 0) {
      sparkPositions.push(positions[maxIdx * 3], positions[maxIdx * 3 + 1] + 0.02, positions[maxIdx * 3 + 2]);
    }
  }

  if (sparkPositions.length) {
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkPositions), 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.045, transparent: true, opacity: 0.9 });
    group.add(new THREE.Points(sparkGeo, sparkMat));
  }

  group.rotation.x = -0.12;
  scene.add(group);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const baseRotY = group.rotation.y;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  let t0 = performance.now();
  function animate() {
    if (!reduceMotion) {
      const elapsed = (performance.now() - t0) / 1000;
      group.rotation.y = baseRotY + Math.sin(elapsed * 0.15) * 0.18;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

/* =========================================================
   3D view driven by real comparator data (optional view)
   ========================================================= */
const ACCENT_HEX = {
  'var(--verdigris)': 0x57C9AC, 'var(--brass)': 0xE8B85F,
  'var(--danger)': 0xEC8478, 'var(--slate)': 0x83AEE0, 'var(--plum)': 0xD19BC7
};

function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 40;
  ctx.font = fontSize + 'px "IBM Plex Mono", monospace';
  const textWidth = ctx.measureText(text).width;
  canvas.width = textWidth + 20;
  canvas.height = fontSize + 16;
  ctx.font = fontSize + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  const scaleFactor = 0.0045;
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
  return sprite;
}

function render3DFromItems(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container || typeof THREE === 'undefined') return;
  if (container._stopAnim) { container._stopAnim(); }
  container.innerHTML = '';
  if (!items || !items.length) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight || 1.7, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));

  const spread = 7, depthStep = 0.7, heightScale = 1.7;
  const allXs = items.flatMap(it => it.xs), allYs = items.flatMap(it => it.ys);
  const xMin = Math.min(...allXs), xMax = Math.max(...allXs);
  const yMin = Math.min(...allYs), yMax = Math.max(...allYs);
  const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
  const zSpan = (items.length - 1) * depthStep;

  const group = new THREE.Group();

  // functional group reference planes, drawn first so traces render in front
  const relevantGroups3D = getRelevantGroups(xMin, xMax).map(g =>
    Object.assign({}, g, { gx: ((g.center - xMin) / xSpan - 0.5) * spread })
  );
  const laidOutGroups3D = layoutAnnotationLanes(relevantGroups3D, g => g.gx, g => g.label.length * 0.11 + 0.1, 0.15);
  laidOutGroups3D.forEach(g => {
    const gx = g.gx;
    const planeGeo = new THREE.PlaneGeometry(0.015, heightScale * 1.15);
    const planeMat = new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
    for (let zz = 0; zz >= -zSpan; zz -= depthStep) {
      const seg = new THREE.Mesh(planeGeo, planeMat);
      seg.position.set(gx, heightScale * 0.5, zz);
      group.add(seg);
    }
    const label = makeTextSprite(g.label, g.color);
    label.position.set(gx, heightScale * (1.18 + g.lane * 0.22), 0);
    group.add(label);
  });

  items.forEach((it, row) => {
    const n = it.xs.length;
    const positions = new Float32Array(n * 3);
    const z = -row * depthStep;
    const colorObj = new THREE.Color(ACCENT_HEX[it.color] || 0x57C9AC);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const px = ((it.xs[i] - xMin) / xSpan - 0.5) * spread;
      const py = ((it.ys[i] - yMin) / ySpan) * heightScale;
      positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = z;
      colors[i * 3] = colorObj.r; colors[i * 3 + 1] = colorObj.g; colors[i * 3 + 2] = colorObj.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
    group.add(new THREE.Line(geo, mat));
  });

  // axes
  const axisMat = new THREE.LineBasicMaterial({ color: 0x9FB2AF, transparent: true, opacity: 0.6 });
  function addAxisLine(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    group.add(new THREE.Line(geo, axisMat));
  }
  addAxisLine(new THREE.Vector3(-spread / 2, 0, 0), new THREE.Vector3(spread / 2, 0, 0));
  addAxisLine(new THREE.Vector3(-spread / 2, 0, 0), new THREE.Vector3(-spread / 2, heightScale, 0));
  addAxisLine(new THREE.Vector3(-spread / 2, 0, 0), new THREE.Vector3(-spread / 2, 0, -zSpan));

  const xStartLabel = makeTextSprite(Math.round(xMin) + '', '#9FB2AF');
  xStartLabel.position.set(-spread / 2, -0.14, 0); group.add(xStartLabel);
  const xEndLabel = makeTextSprite(Math.round(xMax) + '', '#9FB2AF');
  xEndLabel.position.set(spread / 2, -0.14, 0); group.add(xEndLabel);
  const xAxisTitle = makeTextSprite(t('compare.axis3dX'), '#9FB2AF');
  xAxisTitle.position.set(0, -0.3, 0); group.add(xAxisTitle);
  const yAxisTitle = makeTextSprite(t('compare.axis3dY'), '#9FB2AF');
  yAxisTitle.position.set(-spread / 2 - 0.55, heightScale, 0); group.add(yAxisTitle);
  const zAxisTitle = makeTextSprite(t('compare.axis3dZ'), '#9FB2AF');
  zAxisTitle.position.set(-spread / 2, -0.14, -zSpan); group.add(zAxisTitle);

  group.position.z = zSpan / 2;
  group.rotation.x = -0.15;
  scene.add(group);

  let dist = 4.5 + items.length * 0.35;
  const minDist = 2.5, maxDist = dist * 2.2;
  camera.position.set(2.2, 2.6, dist);
  const lookTarget = new THREE.Vector3(0, 0.6, -zSpan / 2);
  camera.lookAt(lookTarget);

  function doRender() { renderer.render(scene, camera); }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    doRender();
  }
  window.addEventListener('resize', resize);
  resize();

  /* --- mouse / touch drag to rotate, wheel to zoom --- */
  const canvas = renderer.domElement;
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  let dragging = false, lastX = 0, lastY = 0;

  function startDrag(x, y) { dragging = true; lastX = x; lastY = y; canvas.style.cursor = 'grabbing'; }
  function moveDrag(x, y) {
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    lastX = x; lastY = y;
    group.rotation.y += dx * 0.006;
    group.rotation.x = Math.max(-1.3, Math.min(0.7, group.rotation.x + dy * 0.006));
    doRender();
  }
  function endDrag() { dragging = false; canvas.style.cursor = 'grab'; }

  function updateCameraDistance() {
    const dir = camera.position.clone().sub(lookTarget).normalize();
    camera.position.copy(lookTarget).add(dir.multiplyScalar(dist));
    doRender();
  }

  canvas.addEventListener('pointerdown', (e) => { startDrag(e.clientX, e.clientY); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => moveDrag(e.clientX, e.clientY));
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dist = Math.max(minDist, Math.min(maxDist, dist + e.deltaY * 0.003));
    updateCameraDistance();
  }, { passive: false });

  container._stopAnim = () => {
    window.removeEventListener('resize', resize);
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) { /* not fatal if unsupported */ }
  };
}

/* =========================================================
   Annotated example traces (functional group callouts)
   ========================================================= */
function renderAnnotatedTrace(svgEl, xs, ys, annotations) {
  const ns = 'http://www.w3.org/2000/svg';
  const vb = svgEl.viewBox.baseVal;
  const w = vb.width || 500, h = vb.height || 180;
  const padTop = 34, padSide = 12, padBottom = 20;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
  const innerW = w - padSide * 2, innerH = h - padTop - padBottom;

  function toPx(x) { return padSide + ((x - xMin) / xSpan) * innerW; }
  function toPy(y) { return padTop + innerH - ((y - yMin) / ySpan) * innerH; }

  svgEl.innerHTML = '';
  let d = '';
  xs.forEach((x, i) => { d += (i === 0 ? 'M' : 'L') + toPx(x).toFixed(2) + ',' + toPy(ys[i]).toFixed(2) + ' '; });
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d.trim());
  path.setAttribute('class', 'line');
  svgEl.appendChild(path);

  (annotations || []).forEach(a => {
    let closestIdx = 0, closestDist = Infinity;
    xs.forEach((x, i) => { const dist = Math.abs(x - a.x); if (dist < closestDist) { closestDist = dist; closestIdx = i; } });
    const px = toPx(xs[closestIdx]), py = toPy(ys[closestIdx]);

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', px); line.setAttribute('x2', px);
    line.setAttribute('y1', py - 4); line.setAttribute('y2', 12);
    line.setAttribute('class', 'annotation-line');
    svgEl.appendChild(line);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('r', 2.6);
    dot.setAttribute('class', 'annotation-dot');
    svgEl.appendChild(dot);

    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', px); text.setAttribute('y', 9);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'annotation-label');
    text.textContent = a.label;
    svgEl.appendChild(text);
  });
}

/* =========================================================
   Synthetic spectrum generator (for annotated examples)
   ========================================================= */
function makeGaussianSpectrum(xMin, xMax, nPoints, peaks, baseline) {
  const xs = [], ys = [];
  for (let i = 0; i < nPoints; i++) {
    const x = xMin + (xMax - xMin) * (i / (nPoints - 1));
    let y = baseline !== undefined ? baseline : 0.95;
    for (const p of peaks) y -= p.depth * Math.exp(-Math.pow((x - p.center) / p.width, 2));
    xs.push(x); ys.push(Math.max(0.02, y));
  }
  return { xs, ys };
}

/* =========================================================
   Functional group reference (shared across pages)
   ========================================================= */
const FUNCTIONAL_GROUPS = [
  { label: 'O–H (alcool)', min: 3200, max: 3550, color: '#83AEE0' },
  { label: 'O–H (acide)', min: 2500, max: 3300, color: '#5FA8D6' },
  { label: 'N–H', min: 3300, max: 3500, color: '#8FD6C0' },
  { label: 'C–H', min: 2850, max: 2970, color: '#57C9AC' },
  { label: 'C≡N', min: 2210, max: 2260, color: '#A9D66B' },
  { label: 'C=O', min: 1650, max: 1750, color: '#E8B85F' },
  { label: 'C=C (alcène)', min: 1620, max: 1680, color: '#EFA15C' },
  { label: 'C=C (aromatique)', min: 1450, max: 1600, color: '#EC8478' },
  { label: 'C–O', min: 1000, max: 1300, color: '#D19BC7' },
  { label: 'C–N', min: 1020, max: 1250, color: '#B98FE0' },
];

function getRelevantGroups(xMin, xMax) {
  const lo = Math.min(xMin, xMax), hi = Math.max(xMin, xMax);
  return FUNCTIONAL_GROUPS
    .filter(g => g.min <= hi && g.max >= lo)
    .map(g => {
      const mid = (g.min + g.max) / 2;
      const center = Math.max(lo, Math.min(hi, mid));
      return Object.assign({}, g, { center });
    });
}

/* Assigns a vertical "lane" (0, 1, 2...) to each item so that labels whose
   horizontal footprint would overlap get stacked instead of collapsing
   into each other. getX/getWidth are accessor functions in the caller's
   coordinate space (pixels for 2D, world units for 3D). */
function layoutAnnotationLanes(items, getX, getWidth, gap) {
  const sorted = items.slice().sort((a, b) => getX(a) - getX(b));
  const laneRightEdge = [];
  return sorted.map(item => {
    const x = getX(item), halfW = getWidth(item) / 2;
    let lane = 0;
    while (lane < 8) {
      const rightEdge = laneRightEdge[lane];
      if (rightEdge === undefined || x - halfW >= rightEdge + gap) {
        laneRightEdge[lane] = x + halfW;
        break;
      }
      lane++;
    }
    return Object.assign({}, item, { lane: Math.min(lane, 2) });
  });
}

/* =========================================================
   i18n — language toggle (FR / EN), no cookies, no storage
   ========================================================= */
const TRANSLATIONS = {
  fr: {
    'nav.convert': 'Convertir', 'nav.compare': 'Comparer', 'nav.formulation': 'Formulation',
    'nav.formats': 'Formats', 'nav.upcoming': 'Prochains outils',

    'badge.local': '100% local', 'badge.localFull': '100% local — traitement dans votre navigateur',
    'badge.noaccount': 'Aucun compte', 'badge.noaccountFull': 'Aucun compte requis',
    'badge.free': 'Gratuit', 'badge.batch': 'Traitement par lot',
    'badge.multifile': 'Comparaison multi-fichiers', 'badge.jsonio': 'Import / export JSON',

    'btn.browse': 'Parcourir mes fichiers', 'btn.tryExample': 'Essayer avec un exemple',
    'btn.tryTwoExamples': 'Essayer avec deux exemples',
    'btn.downloadCsv': 'Télécharger CSV', 'btn.downloadJson': 'Télécharger JSON',
    'btn.downloadZip': 'Télécharger tout (.zip)',
    'btn.addComponent': '+ Ajouter un composant', 'btn.addProperty': '+ Ajouter une propriété',
    'btn.loadSample': 'Charger un exemple', 'btn.exportConfig': 'Exporter la config (.json)',
    'btn.importConfig': 'Importer une config (.json)', 'btn.exportMix': 'Exporter ce mix (.csv)',
    'btn.view2d': 'Vue 2D', 'btn.view3d': 'Vue 3D',

    'drop.title': 'Glissez-déposez vos fichiers ici', 'drop.or': 'ou',

    'status.received': 'fichier(s) reçu(s) — traitement en cours…',
    'status.done': 'Traitement terminé.', 'status.readError': 'Impossible de lire le fichier.',
    'status.readErrorNamed': 'Impossible de lire',
    'status.decodeFail': 'Échec du décodage —', 'status.decodeFailOn': 'Échec sur',
    'status.zipUnavailable': 'JSZip indisponible.', 'status.invalidConfig': 'Fichier de configuration invalide.',

    'meta.pointsDecoded': 'points décodés', 'meta.title': 'Titre', 'meta.type': 'Type',
    'meta.origin': 'Origine', 'meta.xunits': 'Unités X', 'meta.yunits': 'Unités Y', 'meta.points': 'Points',

    'compare.empty': "Aucun spectre chargé pour l'instant.", 'compare.remove': 'Retirer',
    'compare.axisX': "Nombre d'onde (cm⁻¹)", 'compare.axisY': 'Intensité',
    'compare.axis3dX': "nombre d'onde (cm⁻¹)", 'compare.axis3dY': 'intensité', 'compare.axis3dZ': 'échantillons',

    'form.name': 'Nom', 'form.unit': 'Unité', 'form.min': 'Min', 'form.max': 'Max',
    'form.startValue': 'Valeur de départ', 'form.base': 'Base', 'form.targetMinMax': 'Cible min / max',
    'form.newComponent': 'Nouveau composant', 'form.newProperty': 'Nouvelle propriété',
    'form.noPropsYet': 'Ajoutez une propriété pour voir un résultat.',

    'peaks.title': 'Pics détectés', 'peaks.none': 'Aucun pic significatif détecté.',
    'peaks.unidentified': 'non identifié',
    'compare.dragHint': '🖱 Glissez pour tourner · molette pour zoomer',

    'lang.toggleLabel': 'Langue',

    'home.eyebrow': 'spectra.tools — outils de laboratoire',
    'home.h1': 'Vos spectres, <span class="accent">en clair</span>.',
    'home.lede': 'Convertir, comparer et explorer des spectres JCAMP-DX — directement dans votre navigateur, sans compte, sans envoi de fichier.',
    'home.groupsLabel': 'GROUPEMENTS FONCTIONNELS — REPÈRES IR',
    'home.moleculeLabel': 'STRUCTURE — MODÈLE 3D',
    'home.moleculeSub': 'rotation automatique',
    'home.toolsTitle': 'Nos outils',
    'home.toolsSub': 'Chacun a sa propre page — clique pour l\'ouvrir.',
    'home.open': 'Ouvrir →',
    'home.examplesTitle': 'Exemples annotés',
    'home.examplesSub': 'Trois signatures IR typiques, avec les groupements fonctionnels repérés directement sur le tracé.',
    'home.understandTitle': 'Comprendre vos spectres',
    'home.understandSub': 'De quoi il s\'agit, et comment ce site s\'en sert.',
    'home.formatsTitle': 'Ce que le site sait faire',
    'home.formatsSub': 'Version 1 — le socle avant d\'ajouter d\'autres formats.',
    'home.upcomingTitle': 'Prochains outils',
    'home.upcomingSub': 'Convertisseur, comparateur et calculateur de formulation sont en ligne. Voici ce qui pourrait suivre.',
    'home.footer': 'Prototype — outils de spectroscopie. Le format JCAMP-DX est un standard ouvert utilisé par la plupart des logiciels de laboratoire (IR, Raman, UV-Vis, RMN).',

    'convert.eyebrow': 'Outil 01 — conversion de spectres',
    'convert.h1': 'Vos spectres JCAMP&#8209;DX, <span class="accent">propres et lisibles</span>.',
    'convert.lede': 'Déposez un ou plusieurs fichiers <strong>.jdx</strong> / <strong>.dx</strong>. L\'outil décode l\'en-tête, reconstruit les points X/Y — y compris les formats compressés SQZ/DIF/DUP — et vous rend des fichiers exploitables tout de suite.',
    'convert.formatsNote': 'Formats acceptés : JCAMP-DX (.jdx, .dx) — blocs XYDATA (X++(Y..Y)) et XYPOINTS.',
    'convert.crosslink': 'Envie de superposer plusieurs spectres au lieu de les convertir un par un ? →',
    'convert.footer': 'Prototype — outil de conversion de fichiers de spectroscopie. Le format JCAMP-DX est un standard ouvert utilisé par la plupart des logiciels de laboratoire (IR, Raman, UV-Vis, RMN).',

    'compare.eyebrow': 'Outil 02 — comparaison de spectres',
    'compare.h1': 'Superposez vos spectres, <span class="accent">repérez les écarts</span> d\'un coup d\'œil.',
    'compare.lede': 'Chargez deux fichiers ou plus pour les afficher sur un même graphique, chacun dans sa couleur, avec une légende pour les identifier et les retirer.',
    'compare.crosslink': 'Besoin d\'exporter un seul spectre en CSV/JSON plutôt que de le comparer ? →',
    'compare.footer': 'Prototype — outil de comparaison de fichiers de spectroscopie. Le format JCAMP-DX est un standard ouvert utilisé par la plupart des logiciels de laboratoire (IR, Raman, UV-Vis, RMN).',

    'formulation.eyebrow': 'Outil 03 — calculateur de formulation',
    'formulation.h1': 'Ajustez vos dosages, <span class="accent">visualisez l\'effet</span> en direct.',
    'formulation.lede': 'Définissez vos composants et des règles simples reliant leur dosage à des propriétés estimées. Ajustez les curseurs pour explorer des compromis.',
    'formulation.disclaimer': '⚠ Modèle linéaire à règles que <em>vous</em> définissez — pas une simulation physico-chimique. Utile pour explorer des tendances et préparer un plan d\'essais, pas pour remplacer des mesures réelles.',
    'formulation.componentsTitle': 'Composants',
    'formulation.componentsHint': 'Nom, unité, et plage de dosage possible pour chacun.',
    'formulation.propertiesTitle': 'Propriétés estimées',
    'formulation.propertiesHint': 'Valeur de base, puis contribution de chaque composant par unité de dosage. Cible optionnelle (zone verte du curseur de résultat).',
    'formulation.simulatorTitle': 'Simulateur',
    'formulation.footer': 'Prototype — calculateur de formulation à règles paramétrables. Pas une simulation physico-chimique.',
  },
  en: {
    'nav.convert': 'Convert', 'nav.compare': 'Compare', 'nav.formulation': 'Formulation',
    'nav.formats': 'Formats', 'nav.upcoming': 'Upcoming tools',

    'badge.local': '100% local', 'badge.localFull': '100% local — processed in your browser',
    'badge.noaccount': 'No account', 'badge.noaccountFull': 'No account required',
    'badge.free': 'Free', 'badge.batch': 'Batch processing',
    'badge.multifile': 'Multi-file comparison', 'badge.jsonio': 'JSON import / export',

    'btn.browse': 'Browse files', 'btn.tryExample': 'Try an example',
    'btn.tryTwoExamples': 'Try two examples',
    'btn.downloadCsv': 'Download CSV', 'btn.downloadJson': 'Download JSON',
    'btn.downloadZip': 'Download all (.zip)',
    'btn.addComponent': '+ Add a component', 'btn.addProperty': '+ Add a property',
    'btn.loadSample': 'Load an example', 'btn.exportConfig': 'Export config (.json)',
    'btn.importConfig': 'Import config (.json)', 'btn.exportMix': 'Export this mix (.csv)',
    'btn.view2d': '2D view', 'btn.view3d': '3D view',

    'drop.title': 'Drag and drop your files here', 'drop.or': 'or',

    'status.received': 'file(s) received — processing…',
    'status.done': 'Processing complete.', 'status.readError': 'Unable to read the file.',
    'status.readErrorNamed': 'Unable to read',
    'status.decodeFail': 'Decoding failed —', 'status.decodeFailOn': 'Failed on',
    'status.zipUnavailable': 'JSZip unavailable.', 'status.invalidConfig': 'Invalid configuration file.',

    'meta.pointsDecoded': 'points decoded', 'meta.title': 'Title', 'meta.type': 'Type',
    'meta.origin': 'Origin', 'meta.xunits': 'X units', 'meta.yunits': 'Y units', 'meta.points': 'Points',

    'compare.empty': 'No spectrum loaded yet.', 'compare.remove': 'Remove',
    'compare.axisX': 'Wavenumber (cm⁻¹)', 'compare.axisY': 'Intensity',
    'compare.axis3dX': 'wavenumber (cm⁻¹)', 'compare.axis3dY': 'intensity', 'compare.axis3dZ': 'samples',

    'form.name': 'Name', 'form.unit': 'Unit', 'form.min': 'Min', 'form.max': 'Max',
    'form.startValue': 'Starting value', 'form.base': 'Base', 'form.targetMinMax': 'Target min / max',
    'form.newComponent': 'New component', 'form.newProperty': 'New property',
    'form.noPropsYet': 'Add a property to see a result.',

    'peaks.title': 'Detected peaks', 'peaks.none': 'No significant peak detected.',
    'peaks.unidentified': 'unidentified',
    'compare.dragHint': '🖱 Drag to rotate · scroll to zoom',

    'lang.toggleLabel': 'Language',

    'home.eyebrow': 'spectra.tools — lab tools',
    'home.h1': 'Your spectra, <span class="accent">made clear</span>.',
    'home.lede': 'Convert, compare, and explore JCAMP-DX spectra — right in your browser, no account, no file upload.',
    'home.groupsLabel': 'FUNCTIONAL GROUPS — IR REFERENCE',
    'home.moleculeLabel': 'STRUCTURE — 3D MODEL',
    'home.moleculeSub': 'automatic rotation',
    'home.toolsTitle': 'Our tools',
    'home.toolsSub': 'Each has its own page — click to open it.',
    'home.open': 'Open →',
    'home.examplesTitle': 'Annotated examples',
    'home.examplesSub': 'Three typical IR signatures, with functional groups marked directly on the trace.',
    'home.understandTitle': 'Understanding your spectra',
    'home.understandSub': 'What it is, and how this site uses it.',
    'home.formatsTitle': 'What the site can do',
    'home.formatsSub': 'Version 1 — the foundation before adding more formats.',
    'home.upcomingTitle': 'Upcoming tools',
    'home.upcomingSub': 'Converter, comparator, and formulation calculator are live. Here\'s what could come next.',
    'home.footer': 'Prototype — spectroscopy tools. JCAMP-DX is an open standard used by most laboratory software (IR, Raman, UV-Vis, NMR).',

    'convert.eyebrow': 'Tool 01 — spectrum conversion',
    'convert.h1': 'Your JCAMP&#8209;DX spectra, <span class="accent">clean and readable</span>.',
    'convert.lede': 'Drop one or more <strong>.jdx</strong> / <strong>.dx</strong> files. The tool decodes the header, reconstructs the X/Y points — including SQZ/DIF/DUP compressed formats — and gives you usable files right away.',
    'convert.formatsNote': 'Accepted formats: JCAMP-DX (.jdx, .dx) — XYDATA (X++(Y..Y)) and XYPOINTS blocks.',
    'convert.crosslink': 'Want to overlay several spectra instead of converting them one by one? →',
    'convert.footer': 'Prototype — spectroscopy file conversion tool. JCAMP-DX is an open standard used by most laboratory software (IR, Raman, UV-Vis, NMR).',

    'compare.eyebrow': 'Tool 02 — spectrum comparison',
    'compare.h1': 'Overlay your spectra, <span class="accent">spot the differences</span> at a glance.',
    'compare.lede': 'Load two or more files to display them on the same chart, each in its own color, with a legend to identify and remove them.',
    'compare.crosslink': 'Need to export a single spectrum to CSV/JSON instead of comparing it? →',
    'compare.footer': 'Prototype — spectroscopy file comparison tool. JCAMP-DX is an open standard used by most laboratory software (IR, Raman, UV-Vis, NMR).',

    'formulation.eyebrow': 'Tool 03 — formulation calculator',
    'formulation.h1': 'Adjust your dosages, <span class="accent">see the effect</span> live.',
    'formulation.lede': 'Define your components and simple rules linking their dosage to estimated properties. Adjust the sliders to explore trade-offs.',
    'formulation.disclaimer': '⚠ A linear rule-based model that <em>you</em> define — not a physico-chemical simulation. Useful for exploring trends and preparing a test plan, not for replacing real measurements.',
    'formulation.componentsTitle': 'Components',
    'formulation.componentsHint': 'Name, unit, and possible dosage range for each one.',
    'formulation.propertiesTitle': 'Estimated properties',
    'formulation.propertiesHint': 'Base value, then each component\'s contribution per unit of dosage. Optional target (green zone on the result slider).',
    'formulation.simulatorTitle': 'Simulator',
    'formulation.footer': 'Prototype — configurable rule-based formulation calculator. Not a physico-chemical simulation.',
  }
};

const INTERNAL_PAGES = ['index.html', 'convertir.html', 'comparer.html', 'formulation.html'];

function getLangFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const lang = params.get('lang');
  return (lang === 'en') ? 'en' : 'fr';
}

let currentLang = getLangFromUrl();

function t(key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || TRANSLATIONS.fr[key] || key;
}

function computeLocalizedHref(href, lang) {
  if (href.startsWith('#')) return href; // same-document fragment: browser preserves the query string automatically
  const [pathPart, hashPart] = href.split('#');
  const fileName = pathPart.split('?')[0];
  if (!INTERNAL_PAGES.includes(fileName)) return href;
  let newHref = fileName;
  if (lang === 'en') newHref += (newHref.includes('?') ? '&' : '?') + 'lang=en';
  if (hashPart) newHref += '#' + hashPart;
  return newHref;
}

function updateInternalLinks(lang) {
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    a.setAttribute('href', computeLocalizedHref(href, lang));
  });
}

function applyLanguage(lang) {
  currentLang = lang === 'en' ? 'en' : 'fr';
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  updateInternalLinks(currentLang);
  document.querySelectorAll('.lang-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
  const url = new URL(window.location.href);
  if (currentLang === 'en') url.searchParams.set('lang', 'en');
  else url.searchParams.delete('lang');
  history.replaceState(null, '', url.toString());
  document.dispatchEvent(new CustomEvent('languagechange'));
}

function initLanguageToggle() {
  document.querySelectorAll('.lang-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-lang]');
      if (!btn) return;
      applyLanguage(btn.dataset.lang);
    });
  });
  applyLanguage(currentLang);
}

document.addEventListener('DOMContentLoaded', initLanguageToggle);

/* =========================================================
   Automatic peak detection + functional-group matching
   ========================================================= */
/* Topographic prominence-based peak detector.
   mode: 'dip' looks for local minima (e.g. transmittance spectra),
   'peak' looks for local maxima (e.g. absorbance spectra). */
function detectPeaks(xs, ys, mode, opts) {
  opts = opts || {};
  const minProminenceRatio = opts.minProminenceRatio ?? 0.06; // fraction of total signal range
  const minSeparation = opts.minSeparation ?? 20; // in x-units (cm-1)
  const n = xs.length;
  if (n < 5) return [];

  const isDip = mode === 'dip';
  const raw = isDip ? ys.map(y => -y) : ys.slice();

  // light smoothing (5-point moving average) to reduce high-frequency noise
  // while preserving genuine (much wider) absorption bands
  const signal = raw.map((v, i) => {
    let sum = 0, count = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j >= 0 && j < n) { sum += raw[j]; count++; }
    }
    return sum / count;
  });

  const sigMin = Math.min(...signal), sigMax = Math.max(...signal);
  const range = (sigMax - sigMin) || 1;
  const minProminence = range * minProminenceRatio;

  // strict local maxima of `signal`
  const candidates = [];
  for (let i = 1; i < n - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] >= signal[i + 1]) candidates.push(i);
  }

  function prominenceAt(i) {
    const v = signal[i];
    let colLeft = v;
    for (let j = i - 1; j >= 0; j--) {
      colLeft = Math.min(colLeft, signal[j]);
      if (signal[j] > v) break;
    }
    let colRight = v;
    for (let j = i + 1; j < n; j++) {
      colRight = Math.min(colRight, signal[j]);
      if (signal[j] > v) break;
    }
    return v - Math.max(colLeft, colRight);
  }

  let scored = candidates
    .map(i => ({ index: i, x: xs[i], y: ys[i], prominence: prominenceAt(i) }))
    .filter(p => p.prominence >= minProminence);

  // non-max suppression: keep the most prominent peak within each minSeparation window
  scored.sort((a, b) => b.prominence - a.prominence);
  const accepted = [];
  for (const p of scored) {
    if (accepted.some(a => Math.abs(a.x - p.x) < minSeparation)) continue;
    accepted.push(p);
  }
  accepted.sort((a, b) => b.x - a.x); // conventional IR order: high wavenumber first
  return accepted;
}


function guessPeakMode(yUnits) {
  const u = (yUnits || '').toUpperCase();
  if (u.includes('TRANSMITT') || u.includes('TRANSMISSION')) return 'dip';
  if (u.includes('ABSORB')) return 'peak';
  return 'dip'; // most common convention for IR when unspecified
}

function matchPeakToGroups(x) {
  // several IR bands legitimately overlap (e.g. broad acid O-H vs C-H, or N-H vs O-H
  // alcohol) — showing every plausible match is more honest than guessing a single one
  return FUNCTIONAL_GROUPS.filter(g => x >= g.min && x <= g.max);
}

function detectAndMatchPeaks(xs, ys, yUnits, opts) {
  const mode = guessPeakMode(yUnits);
  const peaks = detectPeaks(xs, ys, mode, opts);
  return peaks.map(p => Object.assign({}, p, { groups: matchPeakToGroups(p.x) }));
}

function addPeakMarkers(svgEl, xs, ys, peaks) {
  const ns = 'http://www.w3.org/2000/svg';
  const vb = svgEl.viewBox.baseVal;
  const w = vb.width || 500, h = vb.height || 180, pad = 10;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  peaks.forEach(p => {
    const px = pad + ((p.x - xMin) / xSpan) * innerW;
    const py = pad + innerH - ((p.y - yMin) / ySpan) * innerH;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('r', 3);
    dot.setAttribute('class', 'annotation-dot');
    svgEl.appendChild(dot);
  });
}

function peaksListHTML(peaks) {
  if (!peaks.length) return '<p class="peaks-empty">' + t('peaks.none') + '</p>';
  const items = peaks.map(p => {
    const label = p.groups.length ? p.groups.map(g => g.label).join(' / ') : t('peaks.unidentified');
    const color = p.groups.length ? p.groups[0].color : '#9FB2AF';
    return '<li><span class="peak-dot" style="background:' + color + '"></span>' +
           '<span class="peak-x">' + Math.round(p.x) + ' cm⁻¹</span>' +
           '<span class="peak-label">' + escapeHtml(label) + '</span></li>';
  }).join('');
  return '<ul class="peaks-list">' + items + '</ul>';
}
