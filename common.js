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
const SAMPLE_JCAMP = `##TITLE=Polymer film - demo
##JCAMP-DX=5.01
##DATA TYPE=INFRARED SPECTRUM
##ORIGIN=Prototype Lab
##OWNER=Public
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##XFACTOR=1
##YFACTOR=1
##FIRSTX=4000
##LASTX=3400
##NPOINTS=60
##XYDATA=(X++(Y..Y))
4000 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
3918.64 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
3837.29 0.95 0.95 0.95 0.95 0.948 0.945 0.936 0.914
3755.93 0.872 0.801 0.701 0.583 0.474 0.408 0.408 0.472
3674.58 0.578 0.692 0.784 0.842 0.865 0.858 0.831 0.79
3593.22 0.741 0.691 0.647 0.615 0.601 0.606 0.629 0.668
3511.86 0.716 0.767 0.815 0.855 0.888 0.911 0.927 0.937
3430.51 0.943 0.947 0.948 0.949
##END=
`;

const SAMPLE_JCAMP_B = `##TITLE=Polymer film - lot B
##JCAMP-DX=5.01
##DATA TYPE=INFRARED SPECTRUM
##ORIGIN=Prototype Lab
##OWNER=Public
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##XFACTOR=1
##YFACTOR=1
##FIRSTX=4000
##LASTX=3400
##NPOINTS=60
##XYDATA=(X++(Y..Y))
4000 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
3918.64 0.95 0.95 0.95 0.95 0.95 0.95 0.95 0.95
3837.29 0.95 0.95 0.949 0.945 0.937 0.918 0.881 0.818
3755.93 0.727 0.62 0.52 0.459 0.457 0.515 0.612 0.719
3674.58 0.81 0.872 0.906 0.917 0.911 0.891 0.861 0.819
3593.22 0.768 0.711 0.654 0.603 0.567 0.551 0.557 0.584
3511.86 0.629 0.684 0.742 0.796 0.843 0.879 0.906 0.924
3430.51 0.936 0.943 0.946 0.948
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
