/*
* "How the Pokédex recognises a Pokémon" animation, ported from the standalone HTML explainer.
* Plays over the whole screen using the captured camera frame as the photo, and finishes on the
* normalised crop from the backend.
*
* The model step is told as a conveyor belt: the picture rides past little workers who each
* mark one kind of pattern on it (edges, curves, shapes), then at the last station each worker
* stands for one of the top guesses and marks the parts that point to it, and the foreman counts
* those up. It's a teaching picture of a generic convolutional classifier, not of the Pokédex's
* own recognisers.
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
const bump = (t, a, len) => clamp(1 - Math.abs((t - a) / len - 0.5) * 2); // 0 -> 1 -> 0 over [a, a+len]

// debug overlay: time/frame counter drawn over everything, plus Space to pause and
// Left/Right to step one frame (Shift for one second) so a moment can be screenshotted
const DEBUG = true;
const DEBUG_FPS = 60; // playback is time-based; the frame number is just t at this nominal rate

// ---------- timeline ----------
// Every phase is either a transformation (the data visibly changes) or a gap (waiting, or the
// camera moving). The base durations below are scaled by these two, so pacing is tuned here.
const XF_SCALE = 1.4;
const GAP_SCALE = 0.75;
const xf = (s) => s * XF_SCALE;
const gap = (s) => s * GAP_SCALE;

const CAM_IN = [0, xf(0.4)]; // the instant camera pops in
const SHUTTER = CAM_IN[1] + xf(0.15);
const EJECT = [SHUTTER + xf(0.3), SHUTTER + xf(1.3)]; // the photo slides out of the slot, face down
const FLIP = [EJECT[1], EJECT[1] + xf(1.2)]; // camera fades, photo flips over into place
const CROP = [FLIP[1] + gap(1.9), FLIP[1] + gap(1.9) + xf(0.9)];
const CHAN_T = CROP[1] + gap(1.6); // photo hands over to the channel planes
const SPLIT = [CHAN_T + xf(0.8), CHAN_T + xf(2.6)];
const NORM = [SPLIT[1] + gap(1.4), SPLIT[1] + gap(1.4) + xf(2.5)];
const MERGE = [NORM[1], NORM[1] + xf(1.4)]; // the three planes slide back into one picture
const DROP = [MERGE[1], MERGE[1] + gap(2)]; // camera and picture drop down to the belt
const LAND = DROP[1];

// The belt never stops: it crawls past each station while the workers mark the sheet, and
// rushes between stations.
const TRAVEL = gap(2); // raising this slows down the jump between steps
const WORK = xf(1.4);
const CRAWL = 0.35; // how far the sheet creeps while a station works on it
const STATION_X = [-4.8, -1.6, 1.6, 4.8];
const STOPS = STATION_X.map((x, i) => {
    const arrive = LAND + TRAVEL + i * (TRAVEL + WORK);
    return {x, arrive, leave: arrive + WORK};
});
const DESK_T = STOPS[3].leave + TRAVEL; // sheet reaches the foreman
const COUNT = [DESK_T + 0.3, DESK_T + 0.3 + xf(1.8)]; // votes fly into the clipboard
const VOTE_END = COUNT[1] + 2; // time to read the foreman's last line
const RETURN = [VOTE_END, VOTE_END + gap(1.4)]; // camera rises back to the front view
const SCORES_T = RETURN[1] - gap(0.3);
const RESULT_T = SCORES_T + xf(0.6) + xf(2) + gap(1.4);
const END = RESULT_T + xf(1.6) + 1.5;

const STEPS = [
    [0, 'Capture', 'The camera grabs a single frame.'],
    [CROP[0], 'Locate and crop', 'A detector finds the Pokémon and crops to it. This box does not come from the classifier.'],
    [CHAN_T, 'Split into channels', 'Every pixel is three numbers from 0 to 255. OpenCV stores them as blue, green, red. Taller means brighter.'],
    [NORM[0], 'Resize and normalize', "Shrink to the model's input size and scale 0–255 down to 0.0–1.0. Still an ordered grid, nothing is scrambled."],
    [MERGE[0], 'The model', 'The picture rides past workers who each spot one small pattern and mark it wherever it appears. Nobody programmed them: they learned by practising on thousands of labelled photos.'],
    [STOPS[1].arrive, 'Building on the marks', 'Each station only sees the marks made before it. Edges join into curves, curves into shapes. We named the stations; the model has no names for them.'],
    [STOPS[3].arrive, 'Parts point to answers', 'At the last station each worker stands for one possible answer and marks the parts that point to it. The more they find, the higher that answer scores.'],
    [DESK_T, 'The vote', 'The marks are counted up as votes for each Pokémon.'],
    [SCORES_T, 'Scores', 'The last layer gives one score per Pokémon. The highest wins.'],
    [RESULT_T - xf(0.4), 'Result', 'Out comes the normalised image the classifier worked on, with the name it gave.'],
];
const MAX_SCORE_ROWS = 4;

// ---------- scene constants ----------
const PHOTO = 4.4; // longest side of the photo plane, world units
const PY = 0.3;
const PLANE = 2.25; // longest side of the channel planes once lifted off the photo
const GRID = 40; // channel grid resolution along a square crop
const CHAN = [[0, 0, 1], [0, 1, 0], [1, 0, 0]]; // B, G, R (OpenCV order)
const LCOL = ['#5ad1ff', '#7dff9b', '#ffd45a', '#ff7ad9'];
const LNAME = ['edges', 'curves', 'shapes', 'parts'];
// one per top guess, winner first; the score bars use the same colours
const GUESS_COL = ['#ff5a5a', '#ff9f1c', '#b78cff', '#3fe0c5'];
const PART_MARKS = 8; // parts shared out between the guesses by score
const CARD = 3.4; // longest side of the final normalised image

// the instant camera at the start
const CAMW = 2.6;
const CAMH = 1.95;
const CAM_Y = PY + 1;
const EJECT_W = CAMW * 0.6; // photo width while it comes out of the slot

// the conveyor stage sits well below the photo, and the camera drops down to it
const FLOOR = -9;
const BELT_H = 0.7;
const BELT_TOP = FLOOR + BELT_H;
const BELT_W = 1.7;
const BELT_X0 = -9;
const BELT_X1 = 9.2;
const START_X = -7.6;
const DESK_X = 7.6;
const STRIPE = 0.35; // spacing of the belt's slats
const SHEET_SCALES = [0.62, 0.56, 0.5, 0.44]; // the sheet shrinks at each station, like a network's maps
const STROKE_W = [5, 6, 8, 10]; // marks get bolder as they get fewer
// belt camera: looking down ~35 degrees, turned so the belt comes towards us from the top left,
// through a narrow lens so it reads as near-orthographic
const CAM_EL = 0.6;
const CAM_YAW = 0.75;
const CAM_FOV = 12;

// ---------- worker look ----------
const WORKER_SCALE = 1.9;
const SKIN = ['#e3b08a', '#c98f62', '#8f5d3e', '#f2cfae'];
const SHIRT = ['#ffb03b', '#f4d03f', '#ff8a5c'];
const OVERALLS = ['#3e6ad6', '#2b9a8c', '#6a5acd'];
const HAT = '#ffd23f';

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

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return new THREE.CanvasTexture(c);
}

/*
* Flat cut-out for the 2.5D workers: depth-tested like a cardboard standee, with
* alpha-to-coverage so the edges stay smooth without needing back-to-front sorting.
* */
function cutout(w, h, draw, px = 128) {
    const map = canvasTexture(px, Math.round((px * h) / w), draw);
    const mat = new THREE.MeshBasicMaterial({map, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide});
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function disc(x, cx, cy, r, color) {
    x.fillStyle = color;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
}

// a simple line-drawn instant camera, after the reference but with less going on
function drawInstantCamera(x, w, h) {
    x.lineWidth = 10;
    x.lineJoin = 'round';
    x.strokeStyle = '#2b2b2b';
    x.fillStyle = '#c0392b';
    x.fillRect(w - 130, 14, 56, 30); // shutter button
    x.strokeRect(w - 130, 14, 56, 30);
    x.fillStyle = '#f4f1ea';
    x.beginPath();
    x.roundRect(16, 40, w - 32, h - 56, 36);
    x.fill();
    x.stroke();
    x.beginPath();
    x.moveTo(16, 118);
    x.lineTo(w - 16, 118);
    x.stroke();
    x.fillStyle = '#2b2b2b';
    x.fillRect(56, 64, 84, 40); // viewfinder
    x.fillStyle = '#fff';
    x.fillRect(w - 156, 62, 96, 44); // flash
    x.strokeRect(w - 156, 62, 96, 44);
    disc(x, w / 2, h * 0.56, 104, '#2b2b2b');
    disc(x, w / 2, h * 0.56, 82, '#f4f1ea');
    disc(x, w / 2, h * 0.56, 64, '#2b2b2b');
    disc(x, w / 2, h * 0.56, 30, '#4a5d82');
    disc(x, w / 2 - 12, h * 0.56 - 12, 9, '#fff');
    x.fillStyle = '#2b2b2b';
    x.fillRect(w * 0.18, h - 44, w * 0.64, 12); // slot
}

/*
* One little construction worker: a body and a head as two separate circles, floating hands
* and feet, after the sketch. Parts are separate meshes in a group so they can move on their own.
* pencil: colour of the pencil in the drawing hand, or null for none.
* */
function makeWorker(n, {pencil = null, clipboard = false, hat = HAT} = {}) {
    const skin = SKIN[n % SKIN.length];
    const shirt = SHIRT[n % SHIRT.length];
    const overalls = OVERALLS[(n + 1) % OVERALLS.length];
    const group = new THREE.Group();

    const body = cutout(0.46, 0.5, (x, w, h) => {
        x.save();
        x.beginPath();
        x.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
        x.clip();
        x.fillStyle = shirt;
        x.fillRect(0, 0, w, h);
        x.fillStyle = overalls;
        x.fillRect(0, h * 0.5, w, h);
        x.fillRect(w * 0.3, h * 0.36, w * 0.4, h * 0.2); // bib
        x.fillRect(w * 0.24, h * 0.08, w * 0.09, h * 0.45); // straps
        x.fillRect(w * 0.67, h * 0.08, w * 0.09, h * 0.45);
        x.fillStyle = 'rgba(0,0,0,.18)';
        x.fillRect(w * 0.4, h * 0.42, w * 0.2, h * 0.09); // pocket
        x.restore();
    });
    body.userData.base = [0, 0.3, 0.002];

    const head = cutout(0.34, 0.34, (x, w, h) => {
        disc(x, w / 2, h * 0.58, w * 0.34, skin);
        x.fillStyle = hat;
        x.beginPath();
        x.arc(w / 2, h * 0.48, w * 0.36, Math.PI, 0);
        x.fill();
        x.fillRect(w * 0.06, h * 0.44, w * 0.88, h * 0.08); // brim
        x.fillStyle = 'rgba(255,255,255,.35)';
        x.fillRect(w * 0.46, h * 0.14, w * 0.08, h * 0.3); // ridge
    });
    head.userData.base = [0, 0.64, 0.004];

    const hand = (dx) => {
        const m = cutout(0.12, 0.12, (x, w) => disc(x, w / 2, w / 2, w / 2 - 2, skin), 32);
        m.userData.base = [dx, 0.3, 0.006];
        return m;
    };
    const foot = (dx) => {
        const m = cutout(0.13, 0.07, (x, w, h) => {
            x.fillStyle = '#1d2433';
            x.fillRect(0, 0, w, h);
        }, 32);
        m.userData.base = [dx, 0.035, 0];
        return m;
    };
    const feet = [foot(-0.08), foot(0.08)];
    const freeHand = hand(-0.27);
    const parts = [body, head, freeHand, ...feet];

    // the drawing hand lives outside the group so it can reach across the belt
    let drawHand = null;
    if (pencil) {
        drawHand = cutout(0.32, 0.32, (x) => {
            x.save();
            x.translate(16, 112);
            x.rotate(-Math.PI / 4);
            x.fillStyle = '#2b2b2b';
            x.beginPath();
            x.moveTo(0, 0);
            x.lineTo(9, -4);
            x.lineTo(9, 4);
            x.fill(); // lead
            x.fillStyle = '#f0d2a0';
            x.beginPath();
            x.moveTo(9, -4);
            x.lineTo(24, -8);
            x.lineTo(24, 8);
            x.lineTo(9, 4);
            x.fill(); // wood
            x.fillStyle = pencil;
            x.fillRect(24, -8, 70, 16);
            x.fillStyle = '#ff9eb5';
            x.fillRect(94, -8, 12, 16); // rubber
            x.restore();
            disc(x, 86, 42, 20, skin);
        });
        // put the pencil tip at the mesh origin so positioning the hand positions the tip
        drawHand.geometry.translate(0.12, 0.12, 0);
    } else {
        parts.push(hand(0.27));
    }
    if (clipboard) {
        const board = cutout(0.22, 0.28, (x, w, h) => {
            x.fillStyle = '#9a6a3f';
            x.fillRect(0, 0, w, h);
            x.fillStyle = '#f4f1e8';
            x.fillRect(w * 0.12, h * 0.14, w * 0.76, h * 0.8);
            x.fillStyle = '#b8c0cc';
            for (let k = 0; k < 4; k += 1) x.fillRect(w * 0.2, h * (0.3 + k * 0.15), w * 0.6, 3);
            x.fillStyle = '#c9ced6';
            x.fillRect(w * 0.35, 0, w * 0.3, h * 0.12);
        });
        board.userData.base = [-0.3, 0.36, 0.005];
        parts.push(board);
        group.userData.board = board;
    }
    parts.forEach((m) => {
        m.position.set(...m.userData.base);
        group.add(m);
    });
    return {group, body, head, feet, drawHand};
}

// ---------- marks the workers draw, worked out from the real picture ----------
function polyline(pts) {
    const cum = [0];
    for (let k = 1; k < pts.length; k += 1) {
        cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    }
    return {pts, cum, len: cum[cum.length - 1] || 1};
}

function pointAt(line, p) {
    const d = clamp(p) * line.len;
    let k = 1;
    while (k < line.pts.length - 1 && line.cum[k] < d) k += 1;
    const a = line.pts[k - 1];
    const b = line.pts[k];
    const u = clamp((d - line.cum[k - 1]) / ((line.cum[k] - line.cum[k - 1]) || 1));
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
}

// greedy pick of the strongest candidates that aren't crowded together
function spread(cands, n, minDist) {
    const out = [];
    cands.forEach((c) => {
        if (out.length < n && out.every((o) => Math.hypot(o.i - c.i, o.j - c.j) >= minDist)) out.push(c);
    });
    return out;
}

// split `total` marks between the guesses in proportion to their scores, at least one each
function shareOut(weights, total) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const w = sum > 0 ? weights : weights.map(() => 1);
    const raw = w.map((v) => (v / (sum > 0 ? sum : w.length)) * total);
    const counts = raw.map((r) => Math.max(1, Math.floor(r)));
    let left = total - counts.reduce((a, b) => a + b, 0);
    [...raw.keys()].sort((a, b) => (raw[b] % 1) - (raw[a] % 1)).forEach((i) => {
        if (left > 0) {
            counts[i] += 1;
            left -= 1;
        }
    });
    return counts;
}

/*
* Strokes for each station, in sheet-canvas pixels. Edges come from the image gradient, curves
* bend around the strongest edges, shapes ring the busiest regions. Parts are boxes shared out
* between the guesses by score (partCounts), the busiest regions going to the winner. It's a
* stand-in for what real layers respond to, but it lands on the visitor's own picture.
* */
function makeStrokes(pixels, NX, NY, SHW, SHH, partCounts) {
    const lum = new Float32Array(NX * NY);
    for (let k = 0; k < NX * NY; k += 1) {
        lum[k] = (0.299 * pixels[k * 4] + 0.587 * pixels[k * 4 + 1] + 0.114 * pixels[k * 4 + 2]) / 255;
    }
    const L = (i, j) => lum[j * NX + i];
    const mag = new Float32Array(NX * NY);
    const grads = [];
    for (let j = 1; j < NY - 1; j += 1) {
        for (let i = 1; i < NX - 1; i += 1) {
            const gx = L(i + 1, j - 1) + 2 * L(i + 1, j) + L(i + 1, j + 1)
                - L(i - 1, j - 1) - 2 * L(i - 1, j) - L(i - 1, j + 1);
            const gy = L(i - 1, j + 1) + 2 * L(i, j + 1) + L(i + 1, j + 1)
                - L(i - 1, j - 1) - 2 * L(i, j - 1) - L(i + 1, j - 1);
            const m = Math.hypot(gx, gy);
            mag[j * NX + i] = m;
            grads.push({i, j, gx, gy, m});
        }
    }
    grads.sort((a, b) => b.m - a.m);

    const cell = SHW / NX;
    const px = (i, j) => [((i + 0.5) / NX) * SHW, ((j + 0.5) / NY) * SHH];
    const ring = (cx, cy, rx, ry) => Array.from({length: 33}, (_, k) => {
        const a = (k / 32) * Math.PI * 2 - Math.PI / 2;
        return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
    const blocks = (size, step) => {
        const out = [];
        for (let by = 0; by + size <= NY; by += step) {
            for (let bx = 0; bx + size <= NX; bx += step) {
                let e = 0;
                let si = 0;
                let sj = 0;
                for (let j = by; j < by + size; j += 1) {
                    for (let i = bx; i < bx + size; i += 1) {
                        const m = mag[j * NX + i];
                        e += m;
                        si += m * i;
                        sj += m * j;
                    }
                }
                out.push(e ? {i: si / e, j: sj / e, e} : {i: bx + size / 2, j: by + size / 2, e});
            }
        }
        return out.sort((a, b) => b.e - a.e);
    };

    const edges = spread(grads, 16, 3.5).map(({i, j, gx, gy, m}) => {
        const [cx, cy] = px(i, j);
        const half = cell * 1.5;
        const tx = -gy / (m || 1);
        const ty = gx / (m || 1);
        return [[cx - tx * half, cy - ty * half], [cx + tx * half, cy + ty * half]];
    });
    const curves = spread(grads, 9, 6).map(({i, j, gx, gy, m}) => {
        const [cx, cy] = px(i, j);
        const r = cell * 2.6;
        const ox = cx + (gx / (m || 1)) * r;
        const oy = cy + (gy / (m || 1)) * r;
        const base = Math.atan2(cy - oy, cx - ox);
        return Array.from({length: 13}, (_, k) => {
            const a = base + lerp(-0.95, 0.95, k / 12);
            return [ox + r * Math.cos(a), oy + r * Math.sin(a)];
        });
    });
    const bs = Math.max(3, Math.round(Math.min(NX, NY) / 4));
    const shapes = spread(blocks(bs, Math.max(1, Math.round(bs / 2))), 4, bs * 1.4).map(({i, j}, k) => {
        const [cx, cy] = px(i, j);
        const r = bs * 0.55 * cell;
        return ring(cx, cy, r, k % 2 ? r * 0.75 : r);
    });

    const total = partCounts.reduce((a, b) => a + b, 0);
    const bp = Math.max(3, Math.round(Math.min(NX, NY) / 3.2));
    const regions = spread(blocks(bp, Math.max(1, Math.round(bp / 3))), total, bp * 0.75);
    const owners = partCounts.flatMap((c, g) => Array(c).fill(g));
    const parts = owners.map((g, k) => {
        // a busy picture gives enough regions; a flat one repeats them, nudged so they don't stack
        const reg = regions[k % Math.max(1, regions.length)] ?? {i: NX / 2, j: NY / 2};
        const nudge = Math.floor(k / Math.max(1, regions.length)) * cell;
        const half = bp * 0.5 * cell;
        const [x, y] = px(reg.i, reg.j);
        const cx = clamp(x + nudge, half + 6, SHW - half - 6);
        const cy = clamp(y + nudge, half + 6, SHH - half - 6);
        const pts = [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]];
        return {pts, guess: g};
    });

    return [edges, curves, shapes, parts].map((list) => list.map((item) => {
        const pts = item.pts ?? item;
        const line = polyline(pts);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        line.centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        line.side = line.centre[1] < SHH / 2 ? -1 : 1; // far half goes to the workers behind the belt
        line.guess = item.guess;
        return line;
    }));
}

/*
* frame:      canvas/image of the captured still
* normalised: canvas/image shown at the end (the /normalised crop)
* quad:       normalised detection quad from the ws, optional
* scores:     top5 from the ws, [{name, confidence}], optional
* info:       dex entry, or a promise of one, shown under "Show data" at the end
* onClose:    called when the user closes the overlay
* */
export function playCaptureAnimation(container, {
    frame, normalised, quad = null, scores = [], dexId = null, info = null, onClose,
}) {
    // the animation was written against three r128, which had no colour management
    THREE.ColorManagement.enabled = false;
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
        <pre class="cap-info" hidden></pre>
        ${DEBUG ? '<div class="cap-debug"></div>' : ''}`;
    container.appendChild(root);
    const debugEl = root.querySelector('.cap-debug');
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
        fill.style.background = GUESS_COL[i]; // same colour as that guess's worker on the belt
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

    // ---------- the instant camera, and the photo it spits out ----------
    const instantMat = new THREE.MeshBasicMaterial({
        map: canvasTexture(512, 384, drawInstantCamera), transparent: true, depthWrite: false, opacity: 0,
    });
    const instant = new THREE.Mesh(new THREE.PlaneGeometry(CAMW, CAMH), instantMat);
    instant.position.set(0, CAM_Y, 0.1);
    scene.add(instant);

    const {w: fw, h: fh} = sourceSize(frame);
    const fa = fw / fh;
    const PW = fa >= 1 ? PHOTO : PHOTO * fa;
    const PH = PW / fa;
    // the photo has a back, so it can come out face down and flip over
    const photoRig = new THREE.Group();
    scene.add(photoRig);
    const photoMat = new THREE.MeshBasicMaterial({map: textureFrom(frame), transparent: true});
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), photoMat);
    photoRig.add(photo);
    const backMat = new THREE.MeshBasicMaterial({
        map: canvasTexture(256, Math.round(256 / fa), (x, w, h) => {
            x.fillStyle = '#e9e4d8';
            x.fillRect(0, 0, w, h);
            x.strokeStyle = '#cfc8b8';
            x.lineWidth = 6;
            x.strokeRect(10, 10, w - 20, h - 20);
        }),
        transparent: true,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), backMat);
    back.rotation.y = Math.PI;
    photoRig.add(back);
    const ejectScale = EJECT_W / PW;
    const camBottom = CAM_Y - CAMH * (0.958 - 0.5); // bottom edge of the camera body
    const ejectFrom = new THREE.Vector3(0, camBottom + (PH * ejectScale) / 2, 0);
    const ejectTo = new THREE.Vector3(0, camBottom - (PH * ejectScale) / 2 + 0.06, 0);
    const photoHome = new THREE.Vector3(0, PY, 0);

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

    // ---------- conveyor stage ----------
    const stage = new THREE.Group();
    scene.add(stage);

    const floorTex = canvasTexture(64, 64, (x) => {
        x.strokeStyle = 'rgba(154,171,196,.09)';
        x.lineWidth = 2;
        x.strokeRect(0, 0, 64, 64);
    });
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(50 / 0.8, 24 / 0.8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 24), new THREE.MeshBasicMaterial({
        map: floorTex, transparent: true, depthWrite: false,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR;
    stage.add(floor);

    // flat colours per face fake the lighting, so the belt reads as raised without shading
    const beltLen = BELT_X1 - BELT_X0;
    const slatTex = canvasTexture(64, 16, (x) => {
        x.fillStyle = '#3a4a63';
        x.fillRect(0, 0, 64, 16);
        x.fillStyle = '#2f3d54';
        x.fillRect(0, 0, 10, 16);
    });
    slatTex.wrapS = THREE.RepeatWrapping;
    slatTex.repeat.set(beltLen / STRIPE, 1);
    const endMat = new THREE.MeshBasicMaterial({color: 0x2a374d});
    const frontMat = new THREE.MeshBasicMaterial({color: 0x1d2738});
    const belt = new THREE.Mesh(new THREE.BoxGeometry(beltLen, BELT_H, BELT_W), [
        endMat, endMat, new THREE.MeshBasicMaterial({map: slatTex}), frontMat, frontMat, frontMat,
    ]);
    belt.position.set((BELT_X0 + BELT_X1) / 2, FLOOR + BELT_H / 2, 0);
    stage.add(belt);
    const railMat = new THREE.MeshBasicMaterial({color: 0x56688a});
    [-1, 1].forEach((s) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(beltLen, 0.07, 0.07), railMat);
        rail.position.set(belt.position.x, BELT_TOP + 0.035, s * (BELT_W / 2 - 0.035));
        stage.add(rail);
    });

    const shadowTex = canvasTexture(64, 32, (x) => {
        const g = x.createRadialGradient(32, 16, 0, 32, 16, 30);
        g.addColorStop(0, 'rgba(0,0,0,.45)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.scale(1, 0.5);
        x.fillRect(0, 0, 64, 64);
    });
    const shadowGeo = new THREE.PlaneGeometry(0.55, 0.26);
    const shadowMat = new THREE.MeshBasicMaterial({map: shadowTex, transparent: true, depthWrite: false});

    // the sheet: the dot matrix the workers draw on, redrawn from t every frame so scrubbing works
    const SHW = ca >= 1 ? 512 : Math.round(512 * ca);
    const SHH = ca >= 1 ? Math.round(512 / ca) : 512;
    const sheetC = document.createElement('canvas');
    sheetC.width = SHW;
    sheetC.height = SHH;
    const shx = sheetC.getContext('2d');
    const sheetTex = new THREE.CanvasTexture(sheetC);
    const sheetMat = new THREE.MeshBasicMaterial({map: sheetTex, transparent: true, opacity: 0});
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2 * SX, 2 * SZ), sheetMat);
    sheet.rotation.x = -Math.PI / 2;
    stage.add(sheet);

    // one parts worker per top guess; with no scores, three anonymous ones
    const guessCount = top.length || 3;
    const partCounts = shareOut(top.length ? top.map((g) => clamp(g.confidence)) : [1, 1, 1], PART_MARKS);
    const strokes = makeStrokes(pixels, NX, NY, SHW, SHH, partCounts);
    const strokeCol = (L, line) => (L === 3 ? GUESS_COL[line.guess] : LCOL[L]);

    // where each worker stands at a station: [side of the belt, offset along it]
    const SPOTS = {
        3: [[-1, -0.6], [-1, 0.6], [1, 0]],
        4: [[-1, -0.6], [-1, 0.6], [1, -0.6], [1, 0.6]],
    };
    let wn = 0;
    const workers = [];
    function addWorker(opts, place) {
        const wk = makeWorker(wn, opts);
        // all roughly the same height, but not identical
        const scale = WORKER_SCALE * (0.92 + 0.16 * ((wn * 0.618) % 1));
        wn += 1;
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.scale.set(scale, scale, 1);
        stage.add(wk.group, shadow);
        if (wk.drawHand) stage.add(wk.drawHand);
        const w = {...wk, ...place, scale, shadow, phase: wn * 1.7};
        workers.push(w);
        return w;
    }
    // share a station's work window out between one worker's strokes
    function schedule(list, st) {
        const slot = (WORK - 0.2) / Math.max(1, list.length);
        list.forEach((line, k) => {
            const t0 = st.arrive + 0.1 + k * slot + slot * 0.25;
            Object.assign(line, {t0, t1: t0 + slot * 0.75});
        });
        return list;
    }
    STOPS.forEach((st, L) => {
        if (L === 3) {
            // the parts station: each worker is one guess and draws that guess's parts
            const spots = SPOTS[guessCount] ?? SPOTS[4].slice(0, guessCount);
            spots.forEach(([s, dx], g) => {
                const list = schedule(strokes[3].filter((line) => line.guess === g), st);
                addWorker({pencil: GUESS_COL[g]}, {x: st.x + dx, side: s, arrive: st.arrive, leave: st.leave, list});
            });
            return;
        }
        SPOTS[3].forEach(([s, dx]) => {
            // far-side workers split the sheet into left and right halves; the near one takes its whole half
            const list = schedule(strokes[L].filter((line) => line.side === s
                && (s === 1 || (line.centre[0] < SHW / 2) === (dx < 0))), st);
            addWorker({pencil: LCOL[L]}, {x: st.x + dx, side: s, arrive: st.arrive, leave: st.leave, list});
        });
    });
    const foreman = addWorker({clipboard: true, hat: '#f4f1e8'}, {
        x: DESK_X, side: -1, arrive: DESK_T, leave: VOTE_END, list: [],
    });

    const signs = [...LNAME.map((n, L) => [`${L + 1}. ${n}`, LCOL[L], STOPS[L].x]), ['the vote', '#e9eef7', DESK_X]]
        .map(([text, color, x]) => {
            const sign = textSprite(text, color, 1.4);
            sign.position.set(x - 0.5, BELT_TOP + 2.1, -BELT_W / 2 - 1.1);
            stage.add(sign);
            return sign;
        });

    // the parts fly off the sheet into the foreman's clipboard as votes, in their guess's colour
    const voteTex = GUESS_COL.map((col) => canvasTexture(64, 64, (x) => {
        x.globalAlpha = 0.3;
        x.fillStyle = col;
        x.fillRect(6, 6, 52, 52);
        x.globalAlpha = 1;
        x.strokeStyle = col;
        x.lineWidth = 6;
        x.strokeRect(6, 6, 52, 52);
    }));
    const FLY = xf(0.55);
    const voteGap = (COUNT[1] - COUNT[0] - FLY) / Math.max(1, strokes[3].length - 1);
    const votes = strokes[3].map((line, i) => {
        const v = new THREE.Sprite(new THREE.SpriteMaterial({map: voteTex[line.guess], transparent: true, depthWrite: false}));
        v.userData = {line, t0: COUNT[0] + i * voteGap};
        stage.add(v);
        return v;
    });

    // the foreman counts out loud; a little something for the Pokémon fans
    const lines = [
        [DESK_T - 0.2, 'Right, from number one…'],
        ...votes.map((v, i) => [v.userData.t0 + FLY, `${i + 1}…`]),
        [COUNT[1] + 0.2, '…149, 150, 151!'],
        [COUNT[1] + 1.1, "Gotta count 'em all!"],
    ];
    const bubbleC = document.createElement('canvas');
    bubbleC.width = 512;
    bubbleC.height = 220;
    const bubbleTex = new THREE.CanvasTexture(bubbleC);
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bubbleTex, transparent: true, depthTest: false, depthWrite: false,
    }));
    bubble.center.set(0.1, 0); // the tail's tip
    bubble.scale.set(1.9, (1.9 * 220) / 512, 1);
    bubble.renderOrder = 10;
    stage.add(bubble);
    let bubbleText = null;
    function drawBubble(text) {
        const x = bubbleC.getContext('2d');
        x.clearRect(0, 0, 512, 220);
        x.fillStyle = '#fff';
        x.strokeStyle = '#2b2b2b';
        x.lineWidth = 6;
        x.beginPath();
        x.roundRect(8, 8, 496, 160, 40);
        x.moveTo(40, 160);
        x.lineTo(51, 214);
        x.lineTo(100, 160);
        x.fill();
        x.stroke();
        x.fillRect(44, 150, 52, 14); // hide the outline where the tail joins
        x.fillStyle = '#2b2b2b';
        x.font = '700 44px "Atkinson Hyperlegible",system-ui,sans-serif';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(text, 256, 88, 460);
        bubbleTex.needsUpdate = true;
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
    let frontDist = 10;
    let stageX = 0;

    function resize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        aspect = w / h;
        camera.aspect = aspect;
        frontDist = Math.max(10, 2.7 / (0.4142 * aspect));
        // eslint-disable-next-line no-nested-ternary
        stageX = aspect > 1.3 ? -2.2 : aspect > 0.9 ? -1.3 : 0;
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    // ---------- belt state at time t ----------
    function sheetAt(t) {
        let x0 = START_X;
        let s0 = SHEET_SCALES[0];
        let t0 = LAND;
        for (let i = 0; i < STOPS.length; i += 1) {
            const st = STOPS[i];
            if (t < st.arrive) {
                const k = ease((t - t0) / TRAVEL);
                return {x: lerp(x0, st.x - CRAWL, k), s: lerp(s0, SHEET_SCALES[i], k)};
            }
            if (t < st.leave) return {x: lerp(st.x - CRAWL, st.x + CRAWL, (t - st.arrive) / WORK), s: SHEET_SCALES[i]};
            x0 = st.x + CRAWL;
            s0 = SHEET_SCALES[i];
            t0 = st.leave;
        }
        return {x: lerp(x0, DESK_X, ease((t - t0) / TRAVEL)), s: s0};
    }

    function sheetToWorld([px, py], sh, out) {
        return out.set(sh.x + (px / SHW - 0.5) * 2 * SX * sh.s, BELT_TOP + 0.012, (py / SHH - 0.5) * 2 * SZ * sh.s);
    }

    // where a worker's pencil is, in sheet pixels: drawing a stroke, or moving to the next one
    function tipAt(list, t) {
        for (let k = 0; k < list.length; k += 1) {
            const line = list[k];
            if (t < line.t0) {
                if (!k) return line.pts[0];
                const prev = list[k - 1];
                const a = pointAt(prev, 1);
                const u = ease((t - prev.t1) / (line.t0 - prev.t1));
                return [lerp(a[0], line.pts[0][0], u), lerp(a[1], line.pts[0][1], u)];
            }
            if (t <= line.t1) return pointAt(line, (t - line.t0) / (line.t1 - line.t0));
        }
        return pointAt(list[list.length - 1], 1);
    }

    // marks fade as the next station builds on them, the same way the dots fade under the marks
    const faded = (L, t) => (L + 1 < STOPS.length ? seg(t, STOPS[L + 1].leave, STOPS[L + 1].leave + 0.6) : 0);
    function drawSheet(t) {
        const x = shx;
        x.globalAlpha = 1;
        x.shadowBlur = 0;
        x.fillStyle = '#0a1220';
        x.fillRect(0, 0, SHW, SHH);
        x.strokeStyle = '#2a3b58';
        x.lineWidth = 8;
        x.strokeRect(4, 4, SHW - 8, SHH - 8);

        const da = 1 - 0.65 * seg(t, STOPS[0].leave, STOPS[0].leave + 0.6)
            - 0.25 * seg(t, STOPS[1].leave, STOPS[1].leave + 0.6)
            - 0.1 * seg(t, STOPS[2].leave, STOPS[2].leave + 0.6);
        if (da > 0.01) {
            // only the cells the resize step kept
            const r = (SHW / NX) * 0.85;
            for (let j = 0; j < NY; j += 2) {
                for (let i = 0; i < NX; i += 2) {
                    const p = (j * NX + i) * 4;
                    x.fillStyle = `rgba(${pixels[p]},${pixels[p + 1]},${pixels[p + 2]},${da})`;
                    x.beginPath();
                    x.arc(((i + 0.5) / NX) * SHW, ((j + 0.5) / NY) * SHH, r, 0, Math.PI * 2);
                    x.fill();
                }
            }
        }

        x.lineCap = 'round';
        x.lineJoin = 'round';
        strokes.forEach((list, L) => {
            const fade = L === 3 ? 0.75 * seg(t, COUNT[0], COUNT[1]) : 0.6 * faded(L, t);
            x.globalAlpha = 1 - fade;
            x.shadowBlur = 10;
            x.lineWidth = STROKE_W[L] * (SHW / 512);
            list.forEach((line) => {
                const p = clamp((t - line.t0) / (line.t1 - line.t0));
                if (!(p > 0)) return;
                x.strokeStyle = strokeCol(L, line);
                x.shadowColor = x.strokeStyle;
                const d = p * line.len;
                x.beginPath();
                x.moveTo(...line.pts[0]);
                for (let k = 1; k < line.pts.length; k += 1) {
                    if (line.cum[k] <= d) {
                        x.lineTo(...line.pts[k]);
                    } else {
                        x.lineTo(...pointAt(line, p));
                        break;
                    }
                }
                x.stroke();
            });
        });
        sheetTex.needsUpdate = true;
    }

    // ---------- camera: front view for the photo, dropping to the belt for the model ----------
    const camTarget = new THREE.Vector3();
    const beltTarget = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    function placeCamera(t, sheetX) {
        const k = seg(t, DROP[0], DROP[1]) * (1 - seg(t, RETURN[0], RETURN[1]));
        const frontH = 2 * frontDist * Math.tan(THREE.MathUtils.degToRad(22.5));
        const h = lerp(frontH, Math.max(4.8, 6.6 / aspect), k);
        const fov = lerp(45, CAM_FOV, k);
        const el = lerp(0, CAM_EL, k);
        const yaw = lerp(0, CAM_YAW, k);
        beltTarget.set(clamp(sheetX, START_X + 1, DESK_X), BELT_TOP + 0.6, 0);
        camTarget.set(0, 0, 0).lerp(beltTarget, k);
        // keep the framed height fixed while the lens narrows, so the zoom reads as a move
        const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
        camDir.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
        camera.position.copy(camTarget).addScaledVector(camDir, dist);
        camera.lookAt(camTarget);
        camera.fov = fov;
        camera.near = Math.max(0.1, dist - 30);
        camera.far = dist + 30;
        camera.updateProjectionMatrix();
        return {yaw, stretch: 1 / Math.cos(el)};
    }

    // ---------- render at time t ----------
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const sheetStart = new THREE.Vector3(START_X, BELT_TOP + 0.01, 0);
    const cardEnd = new THREE.Vector3();
    const cardFrom = new THREE.Vector3();
    const mid = new THREE.Vector3(0, 0.2, 0);
    let lastStep = -1;

    function placeWorker(w, t, view, sh) {
        const a = seg(t, w.arrive - 0.5, w.arrive) * (1 - seg(t, w.leave, w.leave + 0.6));
        const z = w.side * lerp(BELT_W / 2 + 0.8, BELT_W / 2 + 0.35, a);
        // three steps in, three steps out; the feet are down whenever a is 0 or 1
        const step = Math.sin(a * Math.PI * 6);
        const bob = 0.008 * Math.sin(t * 3 + w.phase) + 0.02 * Math.abs(step) + (w.extraBob ?? 0);
        w.group.position.set(w.x, FLOOR, z);
        w.group.rotation.y = view.yaw;
        w.group.scale.set(w.scale, w.scale * view.stretch, w.scale);
        w.group.children.forEach((m) => {
            const [bx, by, bz] = m.userData.base;
            m.position.set(bx, by + (by > 0.1 ? bob : 0), bz);
        });
        w.feet[0].position.y += Math.max(0, step) * 0.05;
        w.feet[1].position.y += Math.max(0, -step) * 0.05;
        w.shadow.position.set(w.x, FLOOR + 0.004, z);

        if (!w.drawHand) return;
        w.group.updateMatrixWorld();
        const rest = w.group.localToWorld(tmp.set(0.1, 0.19 + bob, 0.008));
        const reach = w.list.length
            ? seg(t, w.arrive - 0.15, w.arrive + 0.15) * (1 - seg(t, w.leave - 0.15, w.leave + 0.15)) : 0;
        if (reach > 0) rest.lerp(sheetToWorld(tipAt(w.list, t), sh, tmp2), reach);
        w.drawHand.position.copy(rest);
        w.drawHand.rotation.y = view.yaw;
        w.drawHand.scale.set(w.scale, w.scale * view.stretch, w.scale);
    }

    function render(t) {
        const sh = sheetAt(t);
        const view = placeCamera(t, sh.x);

        // the instant camera pops in, flashes, spits the photo out face down, then fades as the
        // photo flips over into place
        const kick = 1 + 0.06 * bump(t, SHUTTER, xf(0.3));
        const camIn = seg(t, CAM_IN[0], CAM_IN[1]);
        instantMat.opacity = camIn * (1 - seg(t, FLIP[0], FLIP[0] + xf(0.6)));
        instant.visible = instantMat.opacity > 0.001;
        instant.scale.setScalar(lerp(0.7, 1, camIn) * kick);
        instant.position.y = CAM_Y + 0.4 * seg(t, FLIP[0], FLIP[1]);
        flashEl.style.opacity = 0.75 * bump(t, SHUTTER, xf(0.3));

        const eject = seg(t, EJECT[0], EJECT[1]);
        const flip = seg(t, FLIP[0], FLIP[1]);
        photoRig.visible = t >= EJECT[0];
        photoRig.position.copy(ejectFrom).lerp(ejectTo, eject).lerp(photoHome, flip);
        photoRig.position.z = lerp(-0.05, 0, flip); // tucked behind the camera until it's out
        photoRig.rotation.y = lerp(Math.PI, 0, flip);
        photoRig.scale.setScalar(lerp(ejectScale, 1, flip));

        // photo + box: they hand over to the channel planes and don't come back
        photoMat.opacity = 1 - seg(t, CHAN_T, CHAN_T + xf(0.8));
        backMat.opacity = photoMat.opacity;
        photo.visible = photoMat.opacity > 0.001;
        boxMat.opacity = seg(t, CROP[0], CROP[0] + xf(0.7)) * (1 - seg(t, CHAN_T, CHAN_T + xf(0.8)));
        box.visible = boxMat.opacity > 0.001;
        const bs = lerp(1.5, 1, seg(t, CROP[0], CROP[1]));
        box.scale.set(bs, bs, 1);

        // planes: split apart, slide back into one picture, then drop onto the belt as the sheet
        const split = seg(t, SPLIT[0], SPLIT[1]);
        const norm = seg(t, NORM[0], NORM[1]);
        const merge = seg(t, MERGE[0], MERGE[1]);
        const drop = seg(t, DROP[0], DROP[1]);
        const pOp = seg(t, CHAN_T, CHAN_T + xf(0.8)) * (1 - seg(t, LAND - 0.2, LAND + 0.3));
        planes.forEach(({grp}, k) => {
            grp.visible = pOp > 0.001;
            grp.rotation.x = lerp(lerp(lerp(Math.PI / 2, 0.5, split), Math.PI / 2, merge), 0, drop);
            grp.rotation.y = lerp(0, Math.PI / 4, split) * (1 - merge);
            grp.position.copy(cropC).lerp(mid, split).lerp(sheetStart, drop);
            grp.position.y += (k - 1) * 1.25 * split * lerp(1, 0.22, norm) * (1 - merge);
            const s = lerp(lerp(planeStart, 1, split) * lerp(1, 0.6, norm), SHEET_SCALES[0], drop);
            grp.scale.set(s, s, s);
        });
        if (pOp > 0.001) updatePlanes(split * lerp(1, 0.7, norm) * (1 - merge), norm * (1 - merge), norm, pOp);

        // conveyor
        stage.visible = t > DROP[0] - 0.2 && t < RETURN[1] + 0.2;
        if (stage.visible) {
            slatTex.offset.x = -sh.x / STRIPE;
            sheetMat.opacity = seg(t, LAND - 0.3, LAND + 0.2);
            sheet.visible = sheetMat.opacity > 0.001;
            sheet.position.set(sh.x, BELT_TOP + 0.01, 0);
            sheet.scale.set(sh.s, sh.s, 1);
            if (sheet.visible) drawSheet(t);
            signs.forEach((sign) => {
                sign.material.opacity = 1;
            });

            foreman.extraBob = 0;
            votes.forEach((v) => {
                const k = (t - v.userData.t0) / FLY;
                foreman.extraBob += 0.05 * clamp(1 - Math.abs(k - 1) / 0.3);
            });
            workers.forEach((w) => placeWorker(w, t, view, sh));

            foreman.group.updateMatrixWorld();
            const boardW = foreman.group.userData.board.getWorldPosition(tmp2);
            votes.forEach((v) => {
                const k = clamp((t - v.userData.t0) / FLY);
                v.visible = k > 0 && k < 1;
                if (!v.visible) return;
                sheetToWorld(v.userData.line.centre, sh, v.position).lerp(boardW, ease(k));
                v.position.y += Math.sin(Math.PI * k) * 0.8;
                const vs = lerp(0.4, 0.15, k);
                v.scale.set(vs, vs, 1);
            });

            const said = lines.filter(([at]) => t >= at).pop();
            bubble.visible = Boolean(said) && t < VOTE_END;
            if (bubble.visible) {
                if (said[1] !== bubbleText) {
                    bubbleText = said[1];
                    drawBubble(bubbleText);
                }
                foreman.head.getWorldPosition(bubble.position);
                bubble.position.y += 0.35 * foreman.scale;
            }
        }

        // the normalised image rises up from the belt below and settles on the left
        cardEnd.set(stageX, PY, 0.1);
        cardFrom.set(stageX, PY - 6, 0.1);
        const out = seg(t, RESULT_T - xf(0.4), RESULT_T + xf(1.2));
        cardMat.opacity = seg(t, RESULT_T - xf(0.4), RESULT_T + xf(0.2));
        card.visible = cardMat.opacity > 0.001;
        card.position.copy(cardFrom).lerp(cardEnd, out);
        const cs = lerp(0.08, 1, out);
        card.scale.set(cs, cs, 1);
        card.rotation.y = lerp(Math.PI * 2, 0, out);
        cardBoxMat.opacity = seg(t, RESULT_T + xf(0.8), RESULT_T + xf(1.4));
        cardBox.visible = cardBoxMat.opacity > 0.001;
        cardBox.position.set(cardEnd.x, cardEnd.y, cardEnd.z + 0.02);
        resultLabel.material.opacity = seg(t, RESULT_T + xf(1), RESULT_T + xf(1.6));
        resultLabel.visible = resultLabel.material.opacity > 0.001;
        resultLabel.position.set(cardEnd.x - cardW / 2, cardEnd.y + cardH / 2 + 0.3, cardEnd.z + 0.05);

        // bars
        barsEl.style.opacity = seg(t, SCORES_T, SCORES_T + xf(0.6));
        const bk = seg(t, SCORES_T + xf(0.6), SCORES_T + xf(0.6) + xf(2));
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
    // info can still be on its way (a promise) when the animation starts
    let disposed = false;
    infoEl.textContent = 'Loading dex data…';
    Promise.resolve(info).then((data) => {
        if (disposed) return;
        infoEl.textContent = data ? JSON.stringify(data, null, 2) : `No dex data for dexId ${dexId}`;
    });
    infoBtn.onclick = () => {
        infoEl.hidden = !infoEl.hidden;
    };
    const onKey = (e) => {
        if (e.key === 'Escape') onClose?.();
        if (!DEBUG) return;
        if (e.key === ' ') {
            e.preventDefault();
            if (t >= END) t = 0;
            playing = !playing;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const step = e.shiftKey ? 1 : 1 / DEBUG_FPS;
            t = clamp(t + (e.key === 'ArrowRight' ? step : -step), 0, END);
            playing = false;
        }
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
        if (debugEl) {
            const frameNo = Math.round(t * DEBUG_FPS);
            debugEl.textContent = `frame ${frameNo}  t ${t.toFixed(2)}s  step ${lastStep + 1}${playing ? '' : '  paused'}`;
        }
        frameId = requestAnimationFrame(loop);
    }

    frameId = requestAnimationFrame(loop);

    return function dispose() {
        disposed = true;
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        window.removeEventListener('keydown', onKey);
        scene.traverse((obj) => {
            obj.geometry?.dispose();
            [obj.material].flat().forEach((m) => {
                if (!m) return;
                m.map?.dispose();
                m.dispose();
            });
        });
        dotTex.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        root.remove();
    };
}
