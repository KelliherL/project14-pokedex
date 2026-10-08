/*
* "How the Pokédex recognises a Pokémon" animation, ported from the standalone HTML explainer.
* Plays over the whole screen using the captured camera frame as the photo, and finishes on the
* normalised crop from the backend.
*
* playCaptureAnimation(container, options) mounts it and returns a dispose function.
* */
import * as THREE from 'three';
import './recognitionAnimation.css';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => {
    const k = clamp(x);
    return k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
};
const seg = (t, a, b) => ease((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;

// seeded so the sieve patterns and particles look the same every run
function makeRnd(start) {
    let seed = start;
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------- timeline + captions ----------
const STEPS = [[0, 'Capture', 'The camera grabs a single frame.'], [2.5, 'Locate and crop', 'A detector finds the Pokémon and crops to it. This box does not come from the classifier.'], [5, 'Split into channels', 'Every pixel is three numbers from 0 to 255. OpenCV stores them as blue, green, red. Taller means brighter.'], [9, 'Resize and normalize', "Shrink to the model's input size and scale 0–255 down to 0.0–1.0. Still an ordered grid, nothing is scrambled."], [13, 'The model', 'Layers of learned filters (the weights) look for patterns: edges, then curves, then shapes, then parts. Matches combine and pass on; the rest is dropped.'], [20.5, 'Scores', 'The last layer gives one score per Pokémon. The highest wins.'], [25, 'Result', 'Out comes the normalised image the classifier worked on, with the name it gave.'],];
const END = 29;
const MAX_SCORE_ROWS = 4;

// ---------- scene constants ----------
const PHOTO = 4.4; // longest side of the photo plane, world units
const PY = 0.3;
const PLANE = 2.25; // longest side of the channel planes once lifted off the photo
const GRID = 40; // channel grid resolution along a square crop
const CHAN = [[0, 0, 1], [0, 1, 0], [1, 0, 0]]; // B, G, R (OpenCV order)
const TH = 5;
const TW = 2;
const Y0 = 2.9;
const YBOT = -TH / 2;
const SY = [1.4, 0.3, -0.8, -1.9];
const LCOL = ['#5ad1ff', '#7dff9b', '#ffd45a', '#ff7ad9'];
const LNAME = ['edges', 'curves', 'shapes', 'parts'];
const PARTICLES = 900;
const KEEP = 0.58;
const SPEED = 1.6;
const PT0 = 13.2;
const CARD = 3.4; // longest side of the final normalised image

/*
* Crop rectangle in source pixels: the bounding box of the detection quad, or a centred square
* when the backend didn't send one.
* */
function cropRect(quad, fw, fh) {
    if (Array.isArray(quad) && quad.length >= 3) {
        const xs = quad.map(([x]) => x * fw);
        const ys = quad.map(([, y]) => y * fh);
        const pad = 0.04 * Math.max(fw, fh);
        const x0 = clamp(Math.min(...xs) - pad, 0, fw - 8);
        const y0 = clamp(Math.min(...ys) - pad, 0, fh - 8);
        const x1 = clamp(Math.max(...xs) + pad, x0 + 8, fw);
        const y1 = clamp(Math.max(...ys) + pad, y0 + 8, fh);
        return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
    }
    const s = Math.min(fw, fh) * 0.6;
    return {x: (fw - s) / 2, y: (fh - s) / 2, w: s, h: s};
}

function frameShape(w, h, t) {
    const o = new THREE.Shape();
    const ow = w / 2 + t;
    const oh = h / 2 + t;
    o.moveTo(-ow, -oh);
    o.lineTo(ow, -oh);
    o.lineTo(ow, oh);
    o.lineTo(-ow, oh);
    const i = new THREE.Path();
    i.moveTo(-w / 2, -h / 2);
    i.lineTo(-w / 2, h / 2);
    i.lineTo(w / 2, h / 2);
    i.lineTo(w / 2, -h / 2);
    o.holes.push(i);
    return o;
}

function textureFrom(source) {
    const tex = new THREE.Texture(source);
    tex.needsUpdate = true;
    return tex;
}

function sourceSize(source) {
    return {
        w: source.naturalWidth || source.videoWidth || source.width,
        h: source.naturalHeight || source.videoHeight || source.height,
    };
}

/*
* frame:      canvas/image of the captured still
* normalised: canvas/image shown at the end (the /normalised crop)
* quad:       normalised detection quad from the ws, optional
* scores:     top5 from the ws, [{name, confidence}], optional
* onClose:    called when the user closes the overlay
* */
export function playCaptureAnimation(container, {
    frame, normalised, quad = null, scores = [], dexId = null, info = null, onClose,
}) {
    // the animation was written against three r128, which had no colour management
    THREE.ColorManagement.enabled = false;
    const rnd = makeRnd(7);
    const top = (scores ?? []).slice(0, MAX_SCORE_ROWS);
    const winner = top[0];
    const label = winner ? `${winner.name} ${Math.round(clamp(winner.confidence) * 100)}%` : 'No match';

    // ---------- DOM ----------
    const root = document.createElement('div');
    root.className = 'cap-stage';
    root.innerHTML = `
        <canvas></canvas>
        <div class="cap-flash"></div>
        <div class="cap-caption"><h1></h1><p></p><div class="cap-steps"></div></div>
        <div class="cap-bars"><h2>Classifier scores</h2><div class="cap-rows"></div></div>
        <div class="cap-controls">
            <button type="button" data-act="replay">Replay</button>
            <button type="button" data-act="skip">Skip animation</button>
            <button type="button" data-act="info" style="visibility:hidden">Show data</button>
            <button type="button" data-act="close">Close</button>
        </div>
        <pre class="cap-info" hidden></pre>`;
    container.appendChild(root);
    const flashEl = root.querySelector('.cap-flash');
    const titleEl = root.querySelector('.cap-caption h1');
    const textEl = root.querySelector('.cap-caption p');
    const stepsEl = root.querySelector('.cap-steps');
    const barsEl = root.querySelector('.cap-bars');
    const rowsEl = root.querySelector('.cap-rows');
    const skipBtn = root.querySelector('[data-act="skip"]');
    STEPS.forEach(() => stepsEl.appendChild(document.createElement('span')));

    // names come from the backend, so build rows with textContent rather than innerHTML
    const fills = top.map(({name}, i) => {
        const row = document.createElement('div');
        row.className = i ? 'cap-row' : 'cap-row win';
        const nameEl = document.createElement('span');
        nameEl.textContent = name;
        nameEl.title = name;
        const track = document.createElement('div');
        track.className = 'cap-track';
        const fill = document.createElement('div');
        fill.className = 'cap-fill';
        track.appendChild(fill);
        const pct = document.createElement('span');
        pct.className = 'cap-pct';
        pct.textContent = '0%';
        row.append(nameEl, track, pct);
        rowsEl.appendChild(row);
        return [fill, pct];
    });
    if (!top.length) {
        const empty = document.createElement('p');
        empty.className = 'cap-empty';
        empty.textContent = 'No scores came back from the classifier.';
        rowsEl.appendChild(empty);
    }

    // ---------- three setup ----------
    const canvas = root.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x0e1726);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    // ---------- the captured photo ----------
    const {w: fw, h: fh} = sourceSize(frame);
    const fa = fw / fh;
    const PW = fa >= 1 ? PHOTO : PHOTO * fa;
    const PH = PW / fa;
    const photoMat = new THREE.MeshBasicMaterial({map: textureFrom(frame), transparent: true});
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), photoMat);
    photo.position.y = PY;
    scene.add(photo);

    // crop region (pixels) -> world
    const crop = cropRect(quad, fw, fh);
    const cropW = (crop.w / fw) * PW;
    const cropH = (crop.h / fh) * PH;
    const cropC = new THREE.Vector3(((crop.x + crop.w / 2) / fw - 0.5) * PW, (0.5 - (crop.y + crop.h / 2) / fh) * PH + PY, 0,);

    // detection box (thick frame)
    const boxMat = new THREE.MeshBasicMaterial({color: 0xff4d4d, transparent: true, opacity: 0});
    const box = new THREE.Mesh(new THREE.ShapeGeometry(frameShape(cropW, cropH, 0.05)), boxMat);
    box.position.copy(cropC);
    box.position.z = 0.02;
    scene.add(box);

    function textSprite(text, color, w) {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 96;
        const x = c.getContext('2d');
        x.font = '700 44px "Atkinson Hyperlegible",system-ui,sans-serif';
        x.fillStyle = color;
        x.textBaseline = 'middle';
        x.fillText(text, 8, 48, 496);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false,
        }));
        s.scale.set(w, (w * 96) / 512, 1);
        s.center.set(0, 0.5);
        scene.add(s);
        return s;
    }

    // ---------- channel planes (B,G,R) sampled from the crop ----------
    const dotC = document.createElement('canvas');
    dotC.width = 32;
    dotC.height = 32;
    {
        const x = dotC.getContext('2d');
        const rg = x.createRadialGradient(16, 16, 0, 16, 16, 16);
        rg.addColorStop(0, '#fff');
        rg.addColorStop(0.6, 'rgba(255,255,255,.8)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = rg;
        x.fillRect(0, 0, 32, 32);
    }
    const dotTex = new THREE.CanvasTexture(dotC);

    const ca = crop.w / crop.h;
    const NX = Math.round(clamp(GRID * Math.sqrt(ca), 8, 64));
    const NY = Math.round(clamp(GRID / Math.sqrt(ca), 8, 64));
    const SX = (PLANE / 2) * (ca >= 1 ? 1 : ca);
    const SZ = (PLANE / 2) * (ca >= 1 ? 1 / ca : 1);
    const planeStart = cropW / (2 * SX); // scale that lays the planes exactly over the crop

    // downsample the crop straight onto an NX x NY canvas and read the pixels back
    const sample = document.createElement('canvas');
    sample.width = NX;
    sample.height = NY;
    const sctx = sample.getContext('2d', {willReadFrequently: true});
    sctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, NX, NY);
    const pixels = sctx.getImageData(0, 0, NX, NY).data;

    const vals = [[], [], []];
    const planes = [];
    for (let k = 0; k < 3; k += 1) {
        const pos = new Float32Array(NX * NY * 3);
        const col = new Float32Array(NX * NY * 3);
        for (let j = 0; j < NY; j += 1) {
            for (let i = 0; i < NX; i += 1) {
                const idx = j * NX + i;
                vals[k][idx] = pixels[idx * 4 + [2, 1, 0][k]] / 255; // BGR
                pos[idx * 3] = -SX + ((i + 0.5) / NX) * 2 * SX;
                pos[idx * 3 + 2] = -SZ + ((j + 0.5) / NY) * 2 * SZ;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.09,
            map: dotTex,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0,
        });
        const grp = new THREE.Group();
        grp.add(new THREE.Points(geo, mat));
        scene.add(grp);
        planes.push({grp, geo, mat});
    }

    function updatePlanes(hk, desat, drop, op) {
        planes.forEach(({geo, mat}, k) => {
            const pos = geo.attributes.position.array;
            const col = geo.attributes.color.array;
            const c = CHAN[k];
            for (let j = 0; j < NY; j += 1) {
                for (let i = 0; i < NX; i += 1) {
                    const idx = j * NX + i;
                    const v = vals[k][idx];
                    const keep = (i % 2 === 0 && j % 2 === 0) ? 1 : 1 - drop;
                    pos[idx * 3 + 1] = v * 0.5 * hk;
                    const grey = v * 0.42;
                    col[idx * 3] = lerp(c[0] * v, grey * 0.9, desat) * keep;
                    col[idx * 3 + 1] = lerp(c[1] * v, grey, desat) * keep;
                    col[idx * 3 + 2] = lerp(c[2] * v, grey * 1.15, desat) * keep;
                }
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            mat.opacity = op;
        });
    }

    // ---------- sieve tower ----------
    const tower = new THREE.Group();
    tower.rotation.set(0.28, 0.6, 0);
    scene.add(tower);
    const edgeMat = new THREE.LineBasicMaterial({color: 0x9aabc4, transparent: true, opacity: 0});
    tower.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(TW, TH, TW)), edgeMat));

    function sieveTex(L) {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const x = c.getContext('2d');
        x.strokeStyle = 'rgba(200,215,240,.25)';
        x.lineWidth = 1;
        for (let p = 0; p <= 256; p += 16) {
            x.beginPath();
            x.moveTo(p, 0);
            x.lineTo(p, 256);
            x.moveTo(0, p);
            x.lineTo(256, p);
            x.stroke();
        }
        x.strokeStyle = LCOL[L];
        x.lineWidth = 5;
        x.lineCap = 'round';
        for (let a = 0; a < 4; a += 1) {
            for (let b = 0; b < 4; b += 1) {
                const cx = 32 + a * 64;
                const cy = 32 + b * 64;
                const r = rnd() * Math.PI;
                x.beginPath();
                if (L === 0) {
                    x.moveTo(cx - 18 * Math.cos(r), cy - 18 * Math.sin(r));
                    x.lineTo(cx + 18 * Math.cos(r), cy + 18 * Math.sin(r));
                } else if (L === 1) {
                    x.arc(cx, cy, 16, r, r + Math.PI * 1.1);
                } else if (L === 2) {
                    if ((a + b) % 2) {
                        x.arc(cx, cy, 16, 0, Math.PI * 2);
                    } else {
                        x.moveTo(cx, cy - 18);
                        x.lineTo(cx + 17, cy + 14);
                        x.lineTo(cx - 17, cy + 14);
                        x.closePath();
                    }
                } else if ((a + b) % 2) {
                    x.ellipse(cx, cy, 8, 18, r, 0, Math.PI * 2);
                } else {
                    x.arc(cx, cy, 14, 0, Math.PI * 2);
                    x.moveTo(cx + 5, cy);
                    x.arc(cx, cy, 5, 0, Math.PI * 2);
                }
                x.stroke();
            }
        }
        return new THREE.CanvasTexture(c);
    }

    const sieves = SY.map((y, L) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(TW, TW), new THREE.MeshBasicMaterial({
            map: sieveTex(L),
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        tower.add(m);
        const lab = textSprite(`Layer ${L + 1}: ${LNAME[L]}`, LCOL[L], 2.2);
        return {m, lab};
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 20), new THREE.MeshBasicMaterial({
        color: 0xffd45a,
        transparent: true,
        opacity: 0
    }),);
    orb.position.y = YBOT - 0.35;
    tower.add(orb);

    // particles falling through the sieves
    const parts = [];
    const ppos = new Float32Array(PARTICLES * 3);
    const pcol = new Float32Array(PARTICLES * 3);
    for (let i = 0; i < PARTICLES; i += 1) {
        let kl = 0;
        while (kl < 4 && rnd() < KEEP) kl += 1;
        parts.push({x: (rnd() - 0.5) * 1.4, z: (rnd() - 0.5) * 1.4, d: rnd() * 2.2, kl, g: 0.35 + rnd() * 0.4});
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
    const pmat = new THREE.PointsMaterial({
        size: 0.1,
        map: dotTex,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
    });
    tower.add(new THREE.Points(pgeo, pmat));
    const LC = LCOL.map((h) => new THREE.Color(h));

    function updateParticles(t) {
        const tl = t - PT0;
        parts.forEach((p, i) => {
            const y = Y0 - SPEED * Math.max(0, tl - p.d);
            let a = 1;
            if (p.kl < 4 && y < SY[p.kl]) a = 1 - clamp((SY[p.kl] - y) / 0.35);
            if (y < YBOT) a *= 1 - clamp((YBOT - y) / 0.5);
            let passed = 0;
            for (let L = 0; L < 4; L += 1) if (y < SY[L] && L < p.kl) passed = L + 1;
            const f = lerp(1, 0.15, clamp((Y0 - y) / (Y0 - YBOT)));
            const out = (p.kl < 4 && y < SY[p.kl]) ? 1 + (SY[p.kl] - y) * 2 : 1;
            ppos[i * 3] = p.x * f * out;
            ppos[i * 3 + 1] = Math.max(y, YBOT - 0.4);
            ppos[i * 3 + 2] = p.z * f * out;
            const c = passed ? LC[passed - 1] : {r: p.g, g: p.g, b: p.g * 1.1};
            pcol[i * 3] = c.r * a;
            pcol[i * 3 + 1] = c.g * a;
            pcol[i * 3 + 2] = c.b * a;
        });
        pgeo.attributes.position.needsUpdate = true;
        pgeo.attributes.color.needsUpdate = true;
    }

    // ---------- the normalised image that comes out of the model ----------
    const {w: nw, h: nh} = sourceSize(normalised);
    const na = nw / nh;
    const cardW = na >= 1 ? CARD : CARD * na;
    const cardH = cardW / na;
    const cardMat = new THREE.MeshBasicMaterial({
        map: textureFrom(normalised), transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(cardW, cardH), cardMat);
    scene.add(card);
    const cardBoxMat = new THREE.MeshBasicMaterial({color: 0xff4d4d, transparent: true, opacity: 0});
    const cardBox = new THREE.Mesh(new THREE.ShapeGeometry(frameShape(cardW, cardH, 0.05)), cardBoxMat);
    scene.add(cardBox);
    const resultLabel = textSprite(label, '#ff4d4d', 2.6);

    // ---------- layout ----------
    let aspect = 1;

    function resize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        aspect = w / h;
        camera.aspect = aspect;
        camera.position.set(0, 0, Math.max(10, 2.7 / (0.4142 * aspect)));
        camera.updateProjectionMatrix();
        // eslint-disable-next-line no-nested-ternary
        tower.position.set(aspect > 1.3 ? -2.2 : aspect > 0.9 ? -1.3 : 0, -0.3, 0);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    // ---------- render at time t ----------
    const tmp = new THREE.Vector3();
    const topW = new THREE.Vector3();
    const orbW = new THREE.Vector3();
    const cardEnd = new THREE.Vector3();
    const mid = new THREE.Vector3(0, 0.2, 0);
    let lastStep = -1;

    function render(t) {
        // flash
        // eslint-disable-next-line no-nested-ternary
        flashEl.style.opacity = t < 0.8 ? (t < 0.2 ? t / 0.2 : clamp(1 - (t - 0.2) / 0.6)) : 0;
        // photo + box: they hand over to the channel planes and don't come back
        photoMat.opacity = t < 5 ? seg(t, 0, 0.6) : 1 - seg(t, 5, 5.8);
        photo.visible = photoMat.opacity > 0.001;
        boxMat.opacity = seg(t, 2.5, 3.2) * (1 - seg(t, 5, 5.8));
        box.visible = boxMat.opacity > 0.001;
        const bs = lerp(1.5, 1, seg(t, 2.5, 3.4));
        box.scale.set(bs, bs, 1);

        // planes
        tower.updateMatrixWorld();
        topW.copy(tower.localToWorld(tmp.set(0, Y0 - 0.1, 0)));
        const split = seg(t, 5.8, 7.6);
        const norm = seg(t, 9, 11.5);
        const move = seg(t, 11, 12.8);
        const pOp = seg(t, 5, 5.8) * (1 - seg(t, 13, 14));
        planes.forEach(({grp}, k) => {
            grp.visible = pOp > 0.001;
            grp.rotation.x = lerp(lerp(Math.PI / 2, 0.5, split), 0.28, move);
            grp.rotation.y = lerp(lerp(0, Math.PI / 4, split), 0.6, move);
            grp.position.copy(cropC).lerp(mid, split).lerp(topW, move);
            grp.position.y += (k - 1) * 1.25 * split * lerp(1, 0.22, norm);
            const s = lerp(planeStart, 1, split) * lerp(1, 0.6, norm);
            grp.scale.set(s, s, s);
        });
        if (pOp > 0.001) updatePlanes(split * lerp(1, 0.7, norm), norm, norm, pOp);

        // tower + particles
        const tA = seg(t, 12.3, 13.2) * (1 - seg(t, 24.5, 25.3));
        tower.visible = tA > 0.001;
        edgeMat.opacity = tA * 0.55;
        sieves.forEach(({m, lab}, L) => {
            const st = PT0 + (Y0 - SY[L]) / SPEED;
            const bump = clamp(Math.min((t - st) / 0.3, (st + 2.6 - t) / 0.6));
            m.material.opacity = tA * (0.22 + 0.7 * bump);
            lab.material.opacity = tA * (0.45 + 0.55 * bump);
            lab.visible = lab.material.opacity > 0.001;
            lab.position.copy(tower.localToWorld(tmp.set(0, SY[L], 0)));
            lab.position.x += aspect > 0.9 ? 1.6 : 1.1;
            const ls = aspect > 0.9 ? 2.2 : 1.5;
            lab.scale.set(ls, (ls * 96) / 512, 1);
        });
        pmat.opacity = tA;
        if (tA > 0.001) updateParticles(t);
        orb.material.opacity = tA * seg(t, 16.5, 19);

        // the normalised image rises out of the orb and settles where the tower was
        orbW.copy(tower.localToWorld(tmp.set(0, YBOT - 0.35, 0)));
        cardEnd.set(tower.position.x, PY, 0.1);
        const out = seg(t, 24.6, 26.2);
        cardMat.opacity = seg(t, 24.6, 25.2);
        card.visible = cardMat.opacity > 0.001;
        card.position.copy(orbW).lerp(cardEnd, out);
        const cs = lerp(0.08, 1, out);
        card.scale.set(cs, cs, 1);
        card.rotation.y = lerp(Math.PI * 2, 0, out);
        cardBoxMat.opacity = seg(t, 25.8, 26.4);
        cardBox.visible = cardBoxMat.opacity > 0.001;
        cardBox.position.set(cardEnd.x, cardEnd.y, cardEnd.z + 0.02);
        resultLabel.material.opacity = seg(t, 26, 26.6);
        resultLabel.visible = resultLabel.material.opacity > 0.001;
        resultLabel.position.set(cardEnd.x - cardW / 2, cardEnd.y + cardH / 2 + 0.3, cardEnd.z + 0.05);

        // bars
        barsEl.style.opacity = seg(t, 20, 20.6);
        const bk = seg(t, 20.6, 22.6);
        top.forEach(({confidence}, i) => {
            const v = clamp(confidence) * bk * 100;
            fills[i][0].style.width = `${v}%`;
            fills[i][1].textContent = `${Math.round(v)}%`;
        });

        // caption
        let s = 0;
        STEPS.forEach((st, i) => {
            if (t >= st[0]) s = i;
        });
        if (s !== lastStep) {
            lastStep = s;
            titleEl.textContent = `${s + 1}. ${STEPS[s][1]}`;
            textEl.textContent = STEPS[s][2];
            [...stepsEl.children].forEach((e, i) => e.classList.toggle('on', i <= s));
        }
        renderer.render(scene, camera);
    }

    // ---------- playback ----------
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = reduce ? END : 0;
    let playing = !reduce;
    let prev = performance.now();
    let frameId = 0;

    root.querySelector('[data-act="skip"]').onclick = () => {
        t = END;
        playing = false;
    };
    root.querySelector('[data-act="replay"]').onclick = () => {
        t = 0;
        playing = true;
    };
    root.querySelector('[data-act="close"]').onclick = () => onClose?.();
    const infoBtn = root.querySelector('[data-act="info"]');
    const infoEl = root.querySelector('.cap-info');
    infoEl.textContent = info ? JSON.stringify(info, null, 2) : `No dex data for dexId ${dexId}`;
    infoBtn.onclick = () => {
        infoEl.hidden = !infoEl.hidden;
    };
    const onKey = (e) => {
        if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);

    function loop(now) {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (playing) {
            t += dt;
            if (t >= END) {
                t = END;
                playing = false;
            }
        }
        skipBtn.style.visibility = playing ? 'visible' : 'hidden';
        infoBtn.style.visibility = t >= END ? 'visible' : 'hidden';
        render(t);
        frameId = requestAnimationFrame(loop);
    }

    frameId = requestAnimationFrame(loop);

    return function dispose() {
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        window.removeEventListener('keydown', onKey);
        scene.traverse((obj) => {
            obj.geometry?.dispose();
            if (obj.material) {
                obj.material.map?.dispose();
                obj.material.dispose();
            }
        });
        dotTex.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        root.remove();
    };
}
