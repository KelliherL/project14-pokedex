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
// How long each moving part and each pause takes, in seconds. Each one starts where the one
// before it ends, so changing any value shifts everything after it along.
const TIMING = {
    // the photo
    cameraIn: 0.28, // instant camera pops in
    beforeFlash: 0.2, // wait before the flash goes off
    flash: 0.61, // the flash itself
    eject: 3, // photo slides out of the slot, face down
    cameraFade: 0.35, // camera fades away
    flip: 2, // photo flips over into place
    // locate and crop
    beforeCrop: 0.95,
    crop: 0.84, // detection box zooms in and settles
    // split into channels
    beforeChannels: 1.2,
    photoToDots: 1.12, // photo fades into the three channel planes
    split: 2.52, // the planes lift apart
    // resize and normalize
    beforeNormalise: 1.05,
    normalise: 3.5,
    // the model
    merge: 2.35, // the channels slide back into one picture
    drop: 5.78, // camera and picture drop down to the belt; the dots become the sheet on the way
    travel: 2, // the belt rushing from one station to the next
    station: 4.9, // workers drawing at each station
    // the vote
    voteCamera: 2, // camera comes down to face the foreman, overlapping the end of the belt
    beforeVotes: 0.4,
    votes: 5.04, // all the votes flying into the clipboard
    voteFlight: 1.54, // one vote's flight
    countLine: 2, // how long "…149, 150, 151!" stays up
    jokeLine: 3, // how long "Gotta count 'em all!" stays up
    // scores
    cameraReturn: 4, // camera rises back to the front view
    barsIn: 1.26,
    barsFill: 4.2,
    // result
    resultAfterBars: 1, // the image starts rising this long after the bars start filling
    resultRise: 3.36, // normalised image rises up and settles
    resultLabels: 1.26, // red box and name appear
    resultHold: 1.5,
};
const T = TIMING;
const span = (start, len) => [start, start + len];

const CAM_IN = [0, T.cameraIn];
const SHUTTER = CAM_IN[1] + T.beforeFlash;
const EJECT = span(SHUTTER + T.flash, T.eject);
const CAM_FADE = span(EJECT[1], T.cameraFade); // camera gone before the flip so they never cross
const FLIP = span(CAM_FADE[1], T.flip);
const CROP = span(FLIP[1] + T.beforeCrop, T.crop);
const CHAN_T = CROP[1] + T.beforeChannels; // photo hands over to the channel planes
const SPLIT = span(CHAN_T + T.photoToDots, T.split);
const NORM = span(SPLIT[1] + T.beforeNormalise, T.normalise);
const MERGE = span(NORM[1], T.merge);
const DROP = span(MERGE[1], T.drop);
const LAND = DROP[1];

// The belt never stops: it crawls past each station while the workers mark the sheet, and
// rushes between stations.
const TRAVEL = T.travel;
const WORK = T.station;
const CRAWL = 0.35; // how far the sheet creeps while a station works on it
// about five floor squares of empty belt between one station's workers and the next
const STATION_X = [-9.15, -3.05, 3.05, 9.15];
const STOPS = STATION_X.map((x, i) => {
    const arrive = LAND + TRAVEL + i * (TRAVEL + WORK);
    return {x, arrive, leave: arrive + WORK};
});
const DESK_T = STOPS[3].leave + TRAVEL; // sheet reaches the foreman
const VOTE_CAM = span(DESK_T - T.voteCamera / 2, T.voteCamera);
// votes only start flying once the camera has settled on the foreman
const COUNT = span(Math.max(DESK_T, VOTE_CAM[1]) + T.beforeVotes, T.votes);
const FLY = T.voteFlight;
const VOTE_END = COUNT[1] + T.countLine + T.jokeLine;
const RETURN = span(VOTE_END, T.cameraReturn); // camera rises back to the front view
const SCORES_T = RETURN[1] - 0.2; // bars start fading in just before the camera settles
const BARS = span(SCORES_T + T.barsIn, T.barsFill);
const RESULT = span(BARS[0] + T.resultAfterBars, T.resultRise); // overlaps the bars filling
const END = Math.max(RESULT[1] + T.resultLabels, BARS[1]) + T.resultHold;
// the Pokédex zooms into its screen over the camera part of the animation (pop in, flash, photo
// out, camera fades), and back out over the same time when the animation is closed
export const ZOOM_SECONDS = CAM_FADE[1];

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
    [RESULT[0], 'Result', 'Out comes the normalised image the classifier worked on, with the name it gave.'],
];
const MAX_SCORE_ROWS = 4;

// ---------- look ----------
// Everything is drawn from this 32-colour palette (DawnBringer 32). The 3D scene is rendered at
// low resolution and every pixel is snapped to the nearest palette colour, so blends, glows and
// the photo itself all come out in it, like a GBA screen.
const PAL = {
    black: '#000000', night: '#222034', plum: '#45283c', umber: '#663931', rust: '#8f563b',
    orange: '#df7126', tan: '#d9a066', peach: '#eec39a', yellow: '#fbf236', lime: '#99e550',
    green: '#6abe30', teal: '#37946e', moss: '#4b692f', olive: '#524b24', slate: '#323c39',
    indigo: '#3f3f74', sea: '#306082', royal: '#5b6ee1', sky: '#639bff', ice: '#5fcde4',
    mist: '#cbdbfc', white: '#ffffff', steel: '#9badb7', mauve: '#847e87', iron: '#696a6a',
    stone: '#595652', violet: '#76428a', red: '#ac3232', rose: '#d95763', pink: '#d77bba',
    khaki: '#8f974a', bronze: '#8a6f30',
};
// ADJUSTED: not in the original palette. Darkened shades of PAL colours (named after the colour they
// come from) for the factory floor only, so the floor sits back and the workers and belt stand out.
// The palette lock snaps to these too.
const ADJUSTED = {
    seaDark: '#1d3a4e', mossDark: '#2d3f1c', oliveDark: '#312d16', plumDark: '#2d1a27',
    umberDark: '#3d221d', indigoDark: '#2c2a4a', iceDark: '#2f6672', limeDark: '#4c7228',
    yellowDark: '#7d791b', pinkDark: '#6b3d5d', mistDark: '#656d7e',
};
const PIXEL = 2; // size of one rendered pixel, in screen pixels; 1 turns the pixel look off
const PALETTE_LOCK = true; // snap the 3D scene to PAL; false shows the raw colours
const DITHER = 0.05; // strength of the ordered dither used when snapping; 0 = flat bands
const FONT = 'Silkscreen, "Atkinson Hyperlegible", system-ui, sans-serif'; // pixel font for text drawn in the scene

// ---------- scene constants ----------
const PHOTO = 6.6; // longest side of the photo plane, world units
const PY = 0.3;
const PLANE = 3.6; // longest side of the channel planes once lifted off the photo
const GROW = PLANE / 2.25; // how much bigger the planes are than the original explainer's
const GRID = 40; // channel grid resolution along a square crop
// B, G, R (OpenCV order), tinted towards the palette's blue, green and red
const CHAN = [[0.39, 0.61, 1], [0.6, 0.9, 0.31], [0.85, 0.34, 0.39]];
// one per station, after the type badges: ice, grass, electric, psychic
const LCOL = [PAL.ice, PAL.lime, PAL.yellow, PAL.pink];
// one per top guess, winner first; the score bars use the same colours
const GUESS_COL = [PAL.rose, PAL.orange, PAL.sky, PAL.teal];
const PART_MARKS = 8; // parts shared out between the guesses by score
const CARD = 3.4; // longest side of the final normalised image
const PLATE_GAP = 0.48; // from the top of the result card to the middle of its name plate

// the instant camera at the start
const CAMW = 5.2;
const CAMH = 3.9;
const CAM_Y = PY + 1;
const EJECT_W = CAMW * 0.6; // photo width while it comes out of the slot

// the conveyor stage sits well below the photo, and the camera drops down to it
const FLOOR = -9;
const BELT_H = 0.7;
const BELT_TOP = FLOOR + BELT_H;
const BELT_W = 1.7;
const BELT_X0 = -14;
const BELT_X1 = 16;
const START_X = -12.8;
const DESK_X = 14.4;
const STRIPE = 0.35; // spacing of the belt's slats
// the sheet shrinks at each station, like a network's maps (divided by GROW so the sheet on the
// belt stays the same size however big the front-view planes are)
const SHEET_SCALES = [0.62, 0.56, 0.5, 0.44].map((s) => s / GROW);
const STROKE_W = [10, 6, 8, 10]; // line width per station; edges are doubled so they read at a distance
// belt camera: looking down ~35 degrees, turned so the belt comes towards us from the top left,
// through a narrow lens so it reads as near-orthographic
const CAM_EL = 0.6;
const CAM_YAW = 0.75;
const CAM_FOV = 12;
const CAM_VOTE_EL = 0.42; // a little flatter while the foreman counts, so we look at him rather than down on him
const VOTE_FRAME = 3; // how much height the vote shot frames, in world units; smaller = tighter
// the painted floor fades out in an oval around the belt so tape and floor don't run off to the
// horizon: [radius along the belt, radius across it], and how soft the edge is. Equal radii = circle
const FLOOR_FADE = [23, 10];
const FLOOR_FADE_SOFT = 4;
const SECTION_NAMES = ['EDGES', 'CURVES', 'SHAPES', 'PARTS', 'THE VOTE']; // painted on the floor as type badges
// each section's floor, a dark shade of its badge colour
const SECTION_FLOOR = [ADJUSTED.seaDark, ADJUSTED.mossDark, ADJUSTED.oliveDark, ADJUSTED.plumDark, ADJUSTED.umberDark];
// the floor's badge colours, darker than the station colours the workers draw in (LCOL)
const SECTION_BADGE = [ADJUSTED.iceDark, ADJUSTED.limeDark, ADJUSTED.yellowDark, ADJUSTED.pinkDark, ADJUSTED.mistDark];
const FLOOR_GRID = ADJUSTED.indigoDark;
const TAPE_COL = ADJUSTED.yellowDark; // the hazard tape's yellow
const LAMP_H = 3.4; // how high the overhead lamps hang above the belt
const TAPE = 0.25; // width of the hazard tape between sections

// ---------- worker look ----------
const WORKER_SCALE = 1.9;
const SKIN = [PAL.peach, PAL.tan, PAL.rust, PAL.umber];
// [shirt, overalls], picked as pairs so the combinations stay workwear-like. Five of them, against
// four skin tones, so the same skin and outfit don't always come together
const OUTFITS = [
    [PAL.rose, PAL.sea],
    [PAL.mist, PAL.indigo],
    [PAL.orange, PAL.stone],
    [PAL.khaki, PAL.umber],
    [PAL.steel, PAL.violet],
];
// hard hats painted like balls: [top, spots]. Workers get Poké Balls, the foreman a Master Ball
const HAT = [PAL.red, null];
const FOREMAN_HAT = [PAL.violet, PAL.pink];
const INK = PAL.black; // outlines
// how the overhead lamps light the workers: brightness right under a lamp at hat height (`top`),
// at their feet (`feet`), and well away from any lamp (`away`); 1 = the colours as drawn.
// `reach` is how far from under a lamp the light stays full, in world units (it fades out over the
// next unit); the workers at a station stand about 1.3 from their lamp
const WORKER_LIGHT = {top: 1.1, feet: 0.75, away: 0.55, reach: 1.5}; // top above ~1.1 shifts browns towards red

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

// seeded random numbers, so every replay of the same capture looks the same
function makeRnd(start) {
    let seed = start;
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return new THREE.CanvasTexture(c);
}

// canvas text needs the pixel font: draw straight away with whatever is loaded, then again once it is
function textTexture(w, h, draw) {
    const tex = canvasTexture(w, h, draw);
    document.fonts?.load(`700 40px ${FONT}`).then(() => {
        const x = tex.image.getContext('2d');
        x.globalCompositeOperation = 'source-over';
        x.globalAlpha = 1;
        x.clearRect(0, 0, w, h);
        draw(x, w, h);
        tex.needsUpdate = true;
    }, () => {});
    return tex;
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

// a simple line-drawn instant camera, painted like a Poké Ball: red top, black band, white bottom,
// and the lens where the ball's button would be
function drawInstantCamera(x, w, h) {
    x.lineWidth = 12;
    x.lineJoin = 'round';
    x.strokeStyle = INK;
    x.fillStyle = PAL.yellow;
    x.fillRect(w - 130, 14, 56, 30); // shutter button
    x.strokeRect(w - 130, 14, 56, 30);
    x.save();
    x.beginPath();
    x.roundRect(16, 40, w - 32, h - 56, 36);
    x.clip();
    x.fillStyle = PAL.white;
    x.fillRect(0, 0, w, h);
    x.fillStyle = PAL.mist;
    x.fillRect(0, h - 70, w, 70); // shade along the bottom
    x.fillStyle = PAL.red;
    x.fillRect(0, 0, w, 118);
    x.fillStyle = PAL.rose;
    x.fillRect(0, 40, w, 14); // highlight along the top
    x.restore();
    x.beginPath();
    x.roundRect(16, 40, w - 32, h - 56, 36);
    x.stroke();
    x.fillStyle = INK;
    x.fillRect(16, 112, w - 32, 16); // the band
    x.fillStyle = PAL.night;
    x.fillRect(56, 64, 84, 40); // viewfinder
    x.strokeRect(56, 64, 84, 40);
    x.fillStyle = PAL.white;
    x.fillRect(w - 156, 62, 96, 44); // flash
    x.strokeRect(w - 156, 62, 96, 44);
    disc(x, w / 2, h * 0.56, 104, INK);
    disc(x, w / 2, h * 0.56, 82, PAL.white);
    disc(x, w / 2, h * 0.56, 64, INK);
    disc(x, w / 2, h * 0.56, 46, PAL.sea);
    disc(x, w / 2, h * 0.56, 30, PAL.sky);
    x.fillStyle = PAL.white;
    x.fillRect(w / 2 - 22, h * 0.56 - 22, 14, 14); // glint
    x.fillStyle = INK;
    x.fillRect(w * 0.18, h - 44, w * 0.64, 12); // slot
}

/*
* One little construction worker: a body and a head as two separate circles, floating hands
* and feet, after the sketch. Parts are separate meshes in a group so they can move on their own.
* pencil: colour of the pencil in the drawing hand, or null for none.
* */
function makeWorker(n, {pencil = null, clipboard = false, hat = HAT} = {}) {
    const skin = SKIN[n % SKIN.length];
    const [shirt, overalls] = OUTFITS[n % OUTFITS.length];
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
        x.fillStyle = INK;
        x.fillRect(w * 0.4, h * 0.42, w * 0.2, h * 0.09); // pocket
        x.restore();
        x.strokeStyle = INK;
        x.lineWidth = 7;
        x.beginPath();
        x.ellipse(w / 2, h / 2, w / 2 - 5, h / 2 - 5, 0, 0, Math.PI * 2);
        x.stroke();
    });
    body.userData.base = [0, 0.3, 0.002];

    const [hatTop, hatSpots] = hat;
    const head = cutout(0.34, 0.34, (x, w, h) => {
        disc(x, w / 2, h * 0.58, w * 0.34 + 4, INK);
        disc(x, w / 2, h * 0.58, w * 0.34 - 2, skin);
        // the hard hat: a ball's top half for the dome, its black band and white half as the brim
        x.fillStyle = INK;
        x.beginPath();
        x.arc(w / 2, h * 0.48, w * 0.36 + 5, Math.PI, 0);
        x.fill();
        x.fillRect(w * 0.06 - 5, h * 0.42, w * 0.88 + 10, h * 0.12);
        x.fillStyle = hatTop;
        x.beginPath();
        x.arc(w / 2, h * 0.48, w * 0.36, Math.PI, 0);
        x.fill();
        if (hatSpots) {
            disc(x, w * 0.3, h * 0.36, w * 0.07, hatSpots);
            disc(x, w * 0.7, h * 0.36, w * 0.07, hatSpots);
        }
        x.fillStyle = PAL.white;
        x.fillRect(w * 0.06, h * 0.47, w * 0.88, h * 0.05); // brim
        disc(x, w / 2, h * 0.43, w * 0.09, INK); // the ball's button
        disc(x, w / 2, h * 0.43, w * 0.05, PAL.white);
        x.fillRect(w * 0.34, h * 0.18, w * 0.08, h * 0.08); // shine
    });
    head.userData.base = [0, 0.64, 0.004];

    const hand = (dx) => {
        const m = cutout(0.12, 0.12, (x, w) => {
            disc(x, w / 2, w / 2, w / 2 - 2, INK);
            disc(x, w / 2, w / 2, w / 2 - 6, skin);
        }, 32);
        m.userData.base = [dx, 0.3, 0.006];
        return m;
    };
    const foot = (dx) => {
        const m = cutout(0.13, 0.07, (x, w, h) => {
            x.fillStyle = INK;
            x.fillRect(0, 0, w, h);
            x.fillStyle = PAL.umber; // work boots
            x.fillRect(3, 3, w - 6, h - 6);
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
            x.fillStyle = INK;
            x.beginPath();
            x.moveTo(0, 0);
            x.lineTo(9, -4);
            x.lineTo(9, 4);
            x.fill(); // lead
            x.fillStyle = PAL.peach;
            x.beginPath();
            x.moveTo(9, -4);
            x.lineTo(24, -8);
            x.lineTo(24, 8);
            x.lineTo(9, 4);
            x.fill(); // wood
            x.fillStyle = pencil;
            x.fillRect(24, -8, 70, 16);
            x.fillStyle = PAL.pink;
            x.fillRect(94, -8, 12, 16); // rubber
            x.strokeStyle = INK;
            x.lineWidth = 3;
            x.strokeRect(24, -8, 82, 16);
            x.restore();
            disc(x, 86, 42, 22, INK);
            disc(x, 86, 42, 18, skin);
        });
        // put the pencil tip at the mesh origin so positioning the hand positions the tip
        drawHand.geometry.translate(0.12, 0.12, 0);
    } else {
        parts.push(hand(0.27));
    }
    if (clipboard) {
        const board = cutout(0.22, 0.28, (x, w, h) => {
            x.fillStyle = INK;
            x.fillRect(0, 0, w, h);
            x.fillStyle = PAL.rust;
            x.fillRect(4, 4, w - 8, h - 8);
            x.fillStyle = PAL.white;
            x.fillRect(w * 0.12, h * 0.14, w * 0.76, h * 0.8);
            x.fillStyle = PAL.steel;
            for (let k = 0; k < 4; k += 1) x.fillRect(w * 0.2, h * (0.3 + k * 0.15), w * 0.6, 4);
            x.fillStyle = PAL.mauve;
            x.fillRect(w * 0.35, 0, w * 0.3, h * 0.12);
        });
        // in the hand on the side away from the belt, so it can't poke into it
        board.userData.base = [0.3, 0.36, 0.005];
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
    // The very strongest gradients are usually the object's outline, so curves taken from them
    // all hug the border. Draw from a shuffled pool of the busier 60% instead, and vary each
    // curve's size, turn and length. Seeded, so a replay draws the same curves.
    const rnd = makeRnd(7);
    const pool = grads.slice(0, Math.max(20, Math.floor(grads.length * 0.6)));
    for (let k = pool.length - 1; k > 0; k -= 1) {
        const r = Math.floor(rnd() * (k + 1));
        [pool[k], pool[r]] = [pool[r], pool[k]];
    }
    const curves = spread(pool, 9, 6).map(({i, j, gx, gy}) => {
        const [cx, cy] = px(i, j);
        const r = cell * lerp(1.8, 3.2, rnd());
        const toCentre = Math.atan2(gy, gx) + (rnd() - 0.5) * 1.6;
        const ox = cx + Math.cos(toCentre) * r;
        const oy = cy + Math.sin(toCentre) * r;
        const base = toCentre + Math.PI;
        const span = lerp(0.6, 1.2, rnd());
        return Array.from({length: 13}, (_, k) => {
            const a = base + lerp(-span, span, k / 12);
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
        ${DEBUG ? '<div class="cap-debug"></div>' : ''}
        ${DEBUG && PALETTE_LOCK ? `<label class="cap-dither">dither
            <input type="range" min="0" max="0.4" step="0.01" value="${DITHER}"><output></output></label>` : ''}`;
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
    // with the pixel look on, the canvas is drawn at a fraction of the screen's resolution and
    // stretched back up without smoothing (see .cap-stage canvas in the CSS)
    const pixelated = PIXEL > 1;
    const renderer = new THREE.WebGLRenderer({canvas, antialias: !pixelated});
    renderer.setPixelRatio(pixelated ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(PAL.night);
    renderer.localClippingEnabled = true; // lets the photo come out of the camera's slot
    canvas.classList.toggle('pixelated', pixelated);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    // palette lock: the scene is drawn into a texture, then each pixel is swapped for the nearest
    // palette colour, nudged by a 4x4 ordered dither so soft blends turn into patterns, not bands
    const sceneTarget = PALETTE_LOCK ? new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    }) : null;
    const snapTo = [...Object.values(PAL), ...Object.values(ADJUSTED)];
    const palPass = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: {
            tScene: {value: sceneTarget?.texture ?? null},
            uPalette: {value: snapTo.map((c) => new THREE.Vector3(...new THREE.Color(c).toArray()))},
            uDither: {value: DITHER},
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }`,
        fragmentShader: `
            uniform sampler2D tScene;
            uniform vec3 uPalette[${snapTo.length}];
            uniform float uDither;
            varying vec2 vUv;
            const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
            void main() {
                ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
                float d = (BAYER[p.x + p.y * 4] + 0.5) / 16.0 - 0.5;
                vec3 c = texture2D(tScene, vUv).rgb + d * uDither;
                vec3 best = uPalette[0];
                float bestD = 1e9;
                for (int i = 0; i < ${snapTo.length}; i++) {
                    // "redmean" distance: closer to how different two colours look than plain RGB
                    vec3 e = uPalette[i] - c;
                    float r = (uPalette[i].r + c.r) * 0.5;
                    float dist = (2.0 + r) * e.r * e.r + 4.0 * e.g * e.g + (3.0 - r) * e.b * e.b;
                    if (dist < bestD) {
                        bestD = dist;
                        best = uPalette[i];
                    }
                }
                gl_FragColor = vec4(best, 1.0);
            }`,
        depthTest: false,
        depthWrite: false,
    }));
    palPass.frustumCulled = false;
    // debug slider for the dither strength; copy the value you like into DITHER
    const ditherInput = root.querySelector('.cap-dither input');
    if (ditherInput) {
        const ditherOut = root.querySelector('.cap-dither output');
        ditherOut.textContent = DITHER.toFixed(2);
        ditherInput.oninput = () => {
            palPass.material.uniforms.uDither.value = Number(ditherInput.value);
            ditherOut.textContent = Number(ditherInput.value).toFixed(2);
        };
    }
    const palScene = new THREE.Scene();
    palScene.add(palPass);
    const palCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

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
    // the photo has a back, so it can come out face down and flip over. While it's coming out it
    // sits in front of the camera and everything above the slot is clipped off, so it appears
    // to slide out of the slot itself
    const slotClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    const photoRig = new THREE.Group();
    scene.add(photoRig);
    const photoMat = new THREE.MeshBasicMaterial({map: textureFrom(frame), transparent: true, clippingPlanes: [slotClip]});
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), photoMat);
    photoRig.add(photo);
    const backMat = new THREE.MeshBasicMaterial({
        // the back of a trading card: blue, with a Poké Ball in the middle
        map: canvasTexture(256, Math.round(256 / fa), (x, w, h) => {
            x.fillStyle = PAL.indigo;
            x.fillRect(0, 0, w, h);
            x.fillStyle = PAL.sea;
            x.fillRect(14, 14, w - 28, h - 28);
            x.strokeStyle = PAL.royal;
            x.lineWidth = 4;
            x.strokeRect(14, 14, w - 28, h - 28);
            const r = Math.min(w, h) * 0.24;
            disc(x, w / 2, h / 2, r + 5, INK);
            disc(x, w / 2, h / 2, r, PAL.white);
            x.fillStyle = PAL.red;
            x.beginPath();
            x.arc(w / 2, h / 2, r, Math.PI, 0);
            x.fill();
            x.fillStyle = INK;
            x.fillRect(w / 2 - r, h / 2 - 4, 2 * r, 8);
            disc(x, w / 2, h / 2, r * 0.32, INK);
            disc(x, w / 2, h / 2, r * 0.2, PAL.white);
        }),
        transparent: true,
        clippingPlanes: [slotClip],
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), backMat);
    back.rotation.y = Math.PI;
    photoRig.add(back);
    const ejectScale = EJECT_W / PW;
    const SLOT = 0.401; // slot line, as a fraction of the camera's height below its centre
    const slotY = CAM_Y - CAMH * SLOT;
    const ejectFrom = new THREE.Vector3(0, slotY + (PH * ejectScale) / 2, 0.15);
    const ejectTo = new THREE.Vector3(0, slotY - (PH * ejectScale) / 2, 0.15);
    const photoHome = new THREE.Vector3(0, PY, 0);

    // crop region (pixels) -> world
    const crop = cropRect(quad, fw, fh);
    const cropW = (crop.w / fw) * PW;
    const cropH = (crop.h / fh) * PH;
    const cropC = new THREE.Vector3(((crop.x + crop.w / 2) / fw - 0.5) * PW, (0.5 - (crop.y + crop.h / 2) / fh) * PH + PY, 0,);

    // detection box (thick frame)
    const boxMat = new THREE.MeshBasicMaterial({color: PAL.rose, transparent: true, opacity: 0});
    const box = new THREE.Mesh(new THREE.ShapeGeometry(frameShape(cropW, cropH, 0.05)), boxMat);
    box.position.copy(cropC);
    box.position.z = 0.02;
    scene.add(box);

    // a name plate: white text in a dark box with a border in the given colour, big enough to
    // stay readable once the scene is pixelated
    function textSprite(text, color, w) {
        const map = textTexture(512, 112, (x, cw, ch) => {
            // Silkscreen's % is hard to read, so that sign alone is drawn in the body font
            const parts = text.split(/(%)/).filter(Boolean)
                .map((p) => ({p, font: `700 52px ${p === '%' ? '"Atkinson Hyperlegible", system-ui, sans-serif' : FONT}`}));
            parts.forEach((part) => {
                x.font = part.font;
                Object.assign(part, {w: x.measureText(part.p).width});
            });
            const textW = parts.reduce((a, part) => a + part.w, 0);
            const pw = Math.min(cw - 8, textW + 64);
            const px = (cw - pw) / 2; // centred, so the plate sits centred over the card
            x.fillStyle = INK;
            x.beginPath();
            x.roundRect(px, 4, pw, ch - 8, 16);
            x.fill();
            x.fillStyle = color;
            x.beginPath();
            x.roundRect(px + 8, 12, pw - 16, ch - 24, 10);
            x.fill();
            x.fillStyle = PAL.night;
            x.beginPath();
            x.roundRect(px + 16, 20, pw - 32, ch - 40, 6);
            x.fill();
            x.textBaseline = 'middle';
            x.fillStyle = PAL.white;
            const squeeze = Math.min(1, (pw - 64) / textW); // very long names are squashed to fit
            let tx = (cw - textW * squeeze) / 2;
            parts.forEach((part) => {
                x.font = part.font;
                x.fillText(part.p, tx, ch / 2 + 2, part.w * squeeze);
                tx += part.w * squeeze;
            });
        });
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
            map, transparent: true, opacity: 0, depthWrite: false,
        }));
        s.scale.set(w, (w * 112) / 512, 1);
        scene.add(s);
        return s;
    }

    // ---------- channel planes (B,G,R) sampled from the crop ----------
    const dotC = document.createElement('canvas');
    dotC.width = 32;
    dotC.height = 32;
    {
        // square, hard-edged dots: each one is a pixel
        const x = dotC.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(5, 5, 22, 22);
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

    function updatePlanes(hk, desat, drop, op, size) {
        planes.forEach(({geo, mat}, k) => {
            mat.size = size; // dots keep their size relative to the grid as the planes scale
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
        x.strokeStyle = FLOOR_GRID;
        x.lineWidth = 4;
        x.strokeRect(0, 0, 64, 64);
    });
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    // big enough to fill the view for most of the drop, as a reference for the camera move
    floorTex.repeat.set(160 / 0.8, 100 / 0.8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 100), new THREE.MeshBasicMaterial({
        map: floorTex, transparent: true, depthWrite: false,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR;
    stage.add(floor);

    // flat colours per face fake the lighting, so the belt reads as raised without shading
    const beltLen = BELT_X1 - BELT_X0;
    const slatTex = canvasTexture(64, 16, (x) => {
        x.fillStyle = PAL.iron;
        x.fillRect(0, 0, 64, 16);
        x.fillStyle = PAL.stone;
        x.fillRect(0, 0, 12, 16);
    });
    slatTex.wrapS = THREE.RepeatWrapping;
    slatTex.repeat.set(beltLen / STRIPE, 1);
    const endMat = new THREE.MeshBasicMaterial({color: PAL.stone});
    const frontMat = new THREE.MeshBasicMaterial({color: PAL.slate});
    const belt = new THREE.Mesh(new THREE.BoxGeometry(beltLen, BELT_H, BELT_W), [
        endMat, endMat, new THREE.MeshBasicMaterial({map: slatTex}), frontMat, frontMat, frontMat,
    ]);
    belt.position.set((BELT_X0 + BELT_X1) / 2, FLOOR + BELT_H / 2, 0);
    stage.add(belt);
    // ---------- sections: floor colour, hazard tape, a seam in the belt, and the name on the floor ----------
    // Everything here fades in with the floor during the drop, so it's kept in one list.
    const fading = []; // [material, full opacity]
    const fade = (mat, full = 1) => {
        fading.push([mat, full]);
        return mat;
    };
    // Floor-level paint also fades out in an oval around the belt (FLOOR_FADE), worked out per pixel
    // from its world position, so the tape and floor colours stop instead of running to the horizon.
    const ovalFade = {
        uFadeCentre: {value: new THREE.Vector2((BELT_X0 + BELT_X1) / 2, 0)},
        uFadeRadius: {value: new THREE.Vector2(...FLOOR_FADE)},
        uFadeSoft: {value: FLOOR_FADE_SOFT},
    };
    const oval = (mat) => {
        Object.assign(mat, {
            onBeforeCompile: (shader) => {
                Object.assign(shader.uniforms, ovalFade);
                Object.assign(shader, {
                    vertexShader: shader.vertexShader
                        .replace('#include <common>', '#include <common>\nvarying vec2 vFadeXZ;')
                        .replace('#include <project_vertex>',
                            '#include <project_vertex>\nvFadeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;'),
                    fragmentShader: shader.fragmentShader
                        .replace('#include <common>', `#include <common>
                            varying vec2 vFadeXZ;
                            uniform vec2 uFadeCentre;
                            uniform vec2 uFadeRadius;
                            uniform float uFadeSoft;`)
                        .replace('#include <opaque_fragment>', `
                            // distance outside the oval, in world units (roughly)
                            float fadeOut = (length((vFadeXZ - uFadeCentre) / uFadeRadius) - 1.0) * min(uFadeRadius.x, uFadeRadius.y);
                            diffuseColor.a *= 1.0 - smoothstep(-uFadeSoft, 0.0, fadeOut);
                            #include <opaque_fragment>`),
                });
            },
        });
        return mat;
    };
    oval(fade(floor.material));
    // section edges: before the first station, halfway between stations, and before the desk
    const edges = [
        STATION_X[0] - (STATION_X[1] - STATION_X[0]) / 2,
        ...STATION_X.slice(1).map((x, i) => (x + STATION_X[i]) / 2),
        (STATION_X[3] + DESK_X) / 2,
        BELT_X1 + 8,
    ];

    // the rails along the belt's edges are split at each seam too, so the belt reads as separate sections
    const railMat = new THREE.MeshBasicMaterial({color: PAL.steel});
    const railBreaks = [BELT_X0, ...edges.slice(0, 5), BELT_X1];
    railBreaks.slice(1).forEach((x1, i) => {
        const x0 = railBreaks[i];
        const len = x1 - x0 - (i ? 0.05 : 0) - (i < railBreaks.length - 2 ? 0.05 : 0);
        const mid = (x0 + x1) / 2 + ((i ? 0.025 : 0) - (i < railBreaks.length - 2 ? 0.025 : 0));
        [-1, 1].forEach((s) => {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), railMat);
            rail.position.set(mid, BELT_TOP + 0.035, s * (BELT_W / 2 - 0.035));
            stage.add(rail);
        });
    });
    SECTION_NAMES.forEach((name, i) => {
        const [x0, x1] = [edges[i], edges[i + 1]];
        const patch = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 100), oval(fade(new THREE.MeshBasicMaterial({
            color: SECTION_FLOOR[i], transparent: true, depthWrite: false,
        }))));
        patch.rotation.x = -Math.PI / 2;
        patch.position.set((x0 + x1) / 2, FLOOR - 0.002, 0);
        // The floor layers lie almost on top of each other and don't write depth, so left to sorting
        // the grid could draw over the tape and badges. Their order is fixed instead: section colour
        // -1, grid 0, tape 1, badge 2, worker shadows 3, lamp light 5
        patch.renderOrder = -1;
        stage.add(patch);

        // the name, painted on the floor just past the tape and right up against the front of the
        // belt, where the workers don't stand on it; it reads along the tape like a road marking.
        // Painted like a type badge: a pill in the section's colour, spaced-out letters with an outline
        const paint = textTexture(1024, 256, (x, w, h) => {
            const pill = (inset, color) => {
                x.fillStyle = color;
                x.beginPath();
                x.roundRect(inset, 24 + inset, w - 2 * inset, h - 48 - 2 * inset, (h - 48) / 2 - inset);
                x.fill();
            };
            pill(4, INK);
            pill(16, ADJUSTED.mistDark);
            pill(26, SECTION_BADGE[i]);
            x.font = `700 120px ${FONT}`;
            x.letterSpacing = '24px';
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            x.lineJoin = 'round';
            x.lineWidth = 22;
            x.strokeStyle = INK;
            x.strokeText(name, w / 2 + 12, h / 2 + 6, w - 160);
            x.fillStyle = PAL.steel; // greyed so it doesn't compete with the workers
            x.fillText(name, w / 2 + 12, h / 2 + 6, w - 160);
            // worn paint
            const rnd = makeRnd(31 + i);
            x.globalCompositeOperation = 'destination-out';
            for (let k = 0; k < 160; k += 1) {
                x.globalAlpha = 0.3 + rnd() * 0.7;
                x.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 7, 2 + rnd() * 5);
            }
        });
        const [lw, lh] = [2.6, 0.65];
        const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), fade(new THREE.MeshBasicMaterial({
            map: paint, transparent: true, depthWrite: false,
        }), 0.85));
        // lie flat, baseline running across the belt and the tops of the letters pointing back up the line
        label.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
        label.position.set(x0 + TAPE / 2 + 0.3 + lh / 2, FLOOR + 0.003, BELT_W / 2 + 0.25 + lw / 2);
        label.renderOrder = 2; // over the grid and the tape
        stage.add(label);
    });

    // yellow and black hazard tape at each section edge: across the floor, up both sides of the
    // belt, and a seam across the belt itself.
    // The texture is twice the tape's width and only the left half is used, so the stripes only
    // have to repeat seamlessly along the tape: diagonal bands about 50 degrees to its length, each
    // band three quarters of the tape's width, like the real thing.
    const TAPE_PX = 32; // tape width in texture pixels
    const BAND = 24; // one band's length along the tape, in pixels
    const SLANT = 0.8; // how far a stripe moves along the tape per pixel across it
    const tapeMat = (length, color) => {
        const map = canvasTexture(TAPE_PX * 2, BAND * 2, (x, w, h) => {
            x.fillStyle = color;
            x.fillRect(0, 0, w, h);
            x.fillStyle = INK;
            for (let k = -1; k <= 3; k += 1) {
                x.beginPath();
                x.moveTo(0, k * h);
                x.lineTo(0, k * h + BAND);
                x.lineTo(w, k * h + BAND - w * SLANT);
                x.lineTo(w, k * h - w * SLANT);
                x.fill();
            }
            // a little wear
            const rnd = makeRnd(5);
            x.fillStyle = 'rgba(255,255,255,.12)';
            for (let k = 0; k < 40; k += 1) x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
        });
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(0.5, length / (TAPE * (BAND * 2) / TAPE_PX));
        return fade(new THREE.MeshBasicMaterial({map, transparent: true, depthWrite: false}));
    };
    const floorTape = oval(tapeMat(100, TAPE_COL)); // dimmed with the rest of the floor
    const sideTape = tapeMat(BELT_H, PAL.yellow); // full yellow on the belt, which stays bright
    const seamMat = fade(new THREE.MeshBasicMaterial({color: INK, transparent: true}));
    edges.slice(0, 5).forEach((x) => {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(TAPE, 100), floorTape);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(x, FLOOR + 0.002, 0);
        strip.renderOrder = 1; // over the grid
        stage.add(strip);
        [-1, 1].forEach((s) => {
            const side = new THREE.Mesh(new THREE.PlaneGeometry(TAPE, BELT_H), sideTape);
            side.rotation.y = s > 0 ? 0 : Math.PI;
            side.position.set(x, FLOOR + BELT_H / 2, s * (BELT_W / 2 + 0.004));
            stage.add(side);
        });
        const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.07, BELT_W), seamMat);
        seam.rotation.x = -Math.PI / 2;
        seam.position.set(x, BELT_TOP + 0.003, 0);
        stage.add(seam);
    });

    // ---------- overhead lamps: a warm cone of light over each station and the desk ----------
    // Additive and drawn late, so the light spills over the workers and the belt beneath.
    const beamTex = canvasTexture(8, 128, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(238,195,154,.9)'); // PAL.peach
        g.addColorStop(0.6, 'rgba(238,195,154,.25)');
        g.addColorStop(1, 'rgba(238,195,154,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
    });
    const poolTex = canvasTexture(128, 128, (x, w) => {
        const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(238,195,154,.8)');
        g.addColorStop(1, 'rgba(238,195,154,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, w, w);
    });
    const lit = (map, full) => fade(new THREE.MeshBasicMaterial({
        map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }), full);
    const beamMat = lit(beamTex, 0.22);
    const poolMat = lit(poolTex, 0.3);
    const floorPoolMat = lit(poolTex, 0.14); // dimmer on the floor, so the light lands on the belt
    const shadeMat = fade(new THREE.MeshBasicMaterial({color: PAL.slate, transparent: true, side: THREE.DoubleSide}));
    const bulbMat = fade(new THREE.MeshBasicMaterial({color: PAL.yellow, transparent: true}));
    const lampY = BELT_TOP + LAMP_H;
    const lampXZ = []; // where each lamp hangs, for lighting the workers
    [...STATION_X, DESK_X].forEach((x, i) => {
        const z = i < STATION_X.length ? 0 : -(BELT_W / 2 + 0.35); // the desk lamp hangs over the foreman
        lampXZ.push(new THREE.Vector2(x, z));
        // long enough to run off the top of the screen from every belt-view angle
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 30), shadeMat);
        cable.position.set(x, lampY + 15, z);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.32, 24, 1, true), shadeMat);
        shade.position.set(x, lampY, z);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), bulbMat);
        bulb.position.set(x, lampY - 0.1, z);
        const drop = lampY - FLOOR;
        const beam = new THREE.Mesh(new THREE.ConeGeometry(2.3, drop, 32, 1, true), beamMat);
        beam.position.set(x, lampY - drop / 2, z);
        const floorPool = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), floorPoolMat);
        floorPool.rotation.x = -Math.PI / 2;
        floorPool.position.set(x, FLOOR + 0.004, z);
        const beltPool = new THREE.Mesh(new THREE.PlaneGeometry(4, BELT_W), poolMat);
        beltPool.rotation.x = -Math.PI / 2;
        beltPool.position.set(x, BELT_TOP + 0.004, 0);
        [beam, floorPool, beltPool].forEach((m) => {
            m.renderOrder = 5; // after the workers and the sheet, so it lights them
        });
        stage.add(cable, shade, bulb, beam, floorPool, beltPool);
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
    // The workers are lit by the lamps above them, worked out per pixel from where it is in the
    // world: brightest near a lamp and towards the top (hats and heads), darker towards the feet
    // and away from the lamps. The palette lock turns the gradient into dithered shading.
    const lampLight = {
        uLamps: {value: lampXZ},
        uFloorY: {value: FLOOR},
        uLight: {value: new THREE.Vector4(WORKER_LIGHT.top, WORKER_LIGHT.feet, WORKER_LIGHT.away, WORKER_LIGHT.reach)},
    };
    const lampLit = (mat) => {
        Object.assign(mat, {
            onBeforeCompile: (shader) => {
                Object.assign(shader.uniforms, lampLight);
                Object.assign(shader, {
                    vertexShader: shader.vertexShader
                        .replace('#include <common>', '#include <common>\nvarying vec3 vLampWorld;')
                        .replace('#include <project_vertex>',
                            '#include <project_vertex>\nvLampWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'),
                    fragmentShader: shader.fragmentShader
                        .replace('#include <common>', `#include <common>
                            varying vec3 vLampWorld;
                            uniform vec2 uLamps[${lampXZ.length}];
                            uniform float uFloorY;
                            uniform vec4 uLight; // top, feet, away, reach`)
                        .replace('#include <opaque_fragment>', `
                            float under = 0.0; // 1 right under a lamp, 0 out of its reach
                            for (int i = 0; i < ${lampXZ.length}; i++) {
                                under = max(under, 1.0 - smoothstep(uLight.w, uLight.w + 1.0, length(vLampWorld.xz - uLamps[i])));
                            }
                            float up = clamp((vLampWorld.y - uFloorY) / 1.5, 0.0, 1.0); // 0 at the feet, 1 at the hat
                            outgoingLight *= mix(uLight.z, mix(uLight.y, uLight.x, up), under);
                            #include <opaque_fragment>`),
                });
            },
        });
        return mat;
    };

    let wn = 0;
    const workers = [];
    function addWorker(opts, place) {
        const wk = makeWorker(wn, opts);
        wk.group.children.forEach((m) => lampLit(m.material));
        if (wk.drawHand) lampLit(wk.drawHand.material);
        // all roughly the same height, but not identical
        const scale = WORKER_SCALE * (0.92 + 0.16 * ((wn * 0.618) % 1));
        wn += 1;
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.scale.set(scale, scale, 1);
        shadow.renderOrder = 3; // over the floor paint
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
        SPOTS[4].forEach(([s, dx]) => {
            // each worker takes the quarter of the sheet nearest them: their side, their end
            const list = schedule(strokes[L].filter((line) => line.side === s
                && (line.centre[0] < SHW / 2) === (dx < 0)), st);
            addWorker({pencil: LCOL[L]}, {x: st.x + dx, side: s, arrive: st.arrive, leave: st.leave, list});
        });
    });
    const foreman = addWorker({clipboard: true, hat: FOREMAN_HAT}, {
        x: DESK_X, side: -1, arrive: DESK_T, leave: VOTE_END, list: [],
    });

    // the parts fly off the sheet into the foreman's clipboard as votes, in their guess's colour
    const voteTex = GUESS_COL.map((col) => canvasTexture(64, 64, (x) => {
        x.globalAlpha = 0.3;
        x.fillStyle = col;
        x.fillRect(6, 6, 52, 52);
        x.globalAlpha = 1;
        x.strokeStyle = INK;
        x.lineWidth = 10;
        x.strokeRect(6, 6, 52, 52);
        x.strokeStyle = col;
        x.lineWidth = 5;
        x.strokeRect(6, 6, 52, 52);
    }));
    const voteGap = (COUNT[1] - COUNT[0] - FLY) / Math.max(1, strokes[3].length - 1);
    const votes = strokes[3].map((line, i) => {
        const v = new THREE.Sprite(new THREE.SpriteMaterial({
            map: voteTex[line.guess], transparent: true, depthTest: false, depthWrite: false,
        }));
        v.renderOrder = 9; // in flight they draw over everything, so nothing can cut through them
        v.userData = {line, t0: COUNT[0] + i * voteGap};
        stage.add(v);
        return v;
    });

    // the foreman counts out loud; a little something for the Pokémon fans
    const lines = [
        [DESK_T - 0.2, 'Right!'],
        // he counts the first few as they reach the clipboard, then skips ahead as the last one lands
        ...votes.slice(0, 6).map((v, i) => [v.userData.t0 + 0.85 * FLY, `${i + 1}…`]),
        [COUNT[1], '…149, 150, 151!'],
        [COUNT[1] + T.countLine, "Gotta count 'em all!"],
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
        // one outline around the box and tail together, so there's no seam where they meet
        const [l, tp, r, b, rad] = [12, 12, 500, 164, 28];
        x.beginPath();
        x.moveTo(l + rad, tp);
        x.arcTo(r, tp, r, b, rad);
        x.arcTo(r, b, l, b, rad);
        x.lineTo(104, b);
        x.lineTo(51, 208); // the tail's tip
        x.lineTo(66, b);
        x.arcTo(l, b, l, tp, rad);
        x.arcTo(l, tp, r, tp, rad);
        x.closePath();
        // a game dialog box: white, with a black, blue, black border
        x.lineJoin = 'round';
        x.fillStyle = PAL.white;
        x.fill();
        x.strokeStyle = INK;
        x.lineWidth = 18;
        x.stroke();
        x.strokeStyle = PAL.sky;
        x.lineWidth = 8;
        x.stroke();
        x.font = `700 46px ${FONT}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = PAL.steel; // the drop shadow game text has
        x.fillText(text, 260, 92, 440);
        x.fillStyle = PAL.stone;
        x.fillText(text, 256, 88, 440);
        bubbleTex.needsUpdate = true;
    }
    // redraw once the pixel font has loaded, in case the first line went out before it
    document.fonts?.load(`700 46px ${FONT}`).then(() => {
        if (bubbleText) drawBubble(bubbleText);
    }, () => {});

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
    const cardBoxMat = new THREE.MeshBasicMaterial({color: PAL.rose, transparent: true, opacity: 0});
    const cardBox = new THREE.Mesh(new THREE.ShapeGeometry(frameShape(cardW, cardH, 0.05)), cardBoxMat);
    scene.add(cardBox);
    const resultLabel = textSprite(label, PAL.rose, 3.4);

    // ---------- layout ----------
    let aspect = 1;
    let frontDist = 10;
    let stageX = 0;
    let stageY = PY;
    const captionEl = root.querySelector('.cap-caption');
    const controlsEl = root.querySelector('.cap-controls');

    // The result card and its name plate sit as one group, centred in the free space: left of the
    // scores panel (or the whole width when the panel is along the bottom on narrow screens), and
    // between the caption and the buttons. Measured from the page, so it follows the CSS.
    function layoutResult() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        const box = root.getBoundingClientRect();
        // page measurements include the Pokédex's zoom; divide it back out to get layout pixels
        const zoom = box.width / root.offsetWidth || 1;
        const rel = (el) => {
            const r = el.getBoundingClientRect();
            return {left: (r.left - box.left) / zoom, top: (r.top - box.top) / zoom, bottom: (r.bottom - box.top) / zoom};
        };
        const bars = rel(barsEl);
        const halfH = frontDist * Math.tan(THREE.MathUtils.degToRad(22.5));
        const side = bars.left > w * 0.45;
        stageX = side ? (bars.left / w - 1) * halfH * aspect : 0;
        const free = (rel(captionEl).bottom + (side ? rel(controlsEl).top : bars.top)) / 2;
        const above = PLATE_GAP + resultLabel.scale.y / 2; // how far the plate reaches above the card
        stageY = (1 - (free / h) * 2) * halfH - above / 2;
    }

    function resize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        const [rw, rh] = [Math.ceil(w / PIXEL), Math.ceil(h / PIXEL)];
        renderer.setSize(rw, rh, false);
        const pr = renderer.getPixelRatio();
        sceneTarget?.setSize(Math.round(rw * pr), Math.round(rh * pr));
        aspect = w / h;
        camera.aspect = aspect;
        frontDist = Math.max(10, 3.6 / (0.4142 * aspect)); // keeps the bigger photo on narrow screens
        layoutResult();
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
        x.fillStyle = INK;
        x.fillRect(0, 0, SHW, SHH);
        x.strokeStyle = PAL.indigo;
        x.lineWidth = 8;
        x.strokeRect(4, 4, SHW - 8, SHH - 8);

        const da = 1 - 0.65 * seg(t, STOPS[0].leave, STOPS[0].leave + 0.6)
            - 0.25 * seg(t, STOPS[1].leave, STOPS[1].leave + 0.6)
            - 0.1 * seg(t, STOPS[2].leave, STOPS[2].leave + 0.6);
        if (da > 0.01) {
            // only the cells the resize step kept
            // square, like the dots on the planes
            const r = (SHW / NX) * 0.8;
            for (let j = 0; j < NY; j += 2) {
                for (let i = 0; i < NX; i += 2) {
                    const p = (j * NX + i) * 4;
                    x.fillStyle = `rgba(${pixels[p]},${pixels[p + 1]},${pixels[p + 2]},${da})`;
                    x.fillRect(((i + 0.5) / NX) * SHW - r, ((j + 0.5) / NY) * SHH - r, 2 * r, 2 * r);
                }
            }
        }

        x.lineCap = 'round';
        x.lineJoin = 'round';
        strokes.forEach((list, L) => {
            const fade = L === 3 ? 0.75 * seg(t, COUNT[0], COUNT[1]) : 0.6 * faded(L, t);
            x.globalAlpha = 1 - fade;
            const lw = STROKE_W[L] * (SHW / 512);
            list.forEach((line) => {
                const p = clamp((t - line.t0) / (line.t1 - line.t0));
                if (!(p > 0)) return;
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
                // a black outline under each mark, the way sprites are drawn
                x.strokeStyle = INK;
                x.lineWidth = lw + 6 * (SHW / 512);
                x.stroke();
                x.strokeStyle = strokeCol(L, line);
                x.lineWidth = lw;
                x.stroke();
            });
        });
        sheetTex.needsUpdate = true;
    }

    // ---------- camera: front view for the photo, dropping to the belt for the model ----------
    const camTarget = new THREE.Vector3();
    const beltTarget = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    // for the vote the camera comes down and tilts up so the foreman and his bubble sit centred;
    // nudged right along the view because the bubble hangs off to the right of his head
    const voteTarget = new THREE.Vector3(DESK_X, FLOOR + 1.4, -(BELT_W / 2 + 0.35))
        .add(new THREE.Vector3(Math.cos(CAM_YAW), 0, -Math.sin(CAM_YAW)).multiplyScalar(0.45));

    function placeCamera(t, sheetX) {
        const k = seg(t, DROP[0], DROP[1]) * (1 - seg(t, RETURN[0], RETURN[1]));
        const v = seg(t, VOTE_CAM[0], VOTE_CAM[1]);
        const frontH = 2 * frontDist * Math.tan(THREE.MathUtils.degToRad(22.5));
        const beltH = lerp(Math.max(4.8, 6.6 / aspect), Math.max(VOTE_FRAME, 4 / aspect), v);
        const h = lerp(frontH, beltH, k);
        const fov = lerp(45, CAM_FOV, k);
        const el = lerp(0, lerp(CAM_EL, CAM_VOTE_EL, v), k);
        const yaw = lerp(0, CAM_YAW, k);
        beltTarget.set(clamp(sheetX, START_X + 1, DESK_X), BELT_TOP + 0.6, 0).lerp(voteTarget, v);
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

        // the instant camera pops in, flashes and spits the photo out of its slot face down, then
        // fades away completely before the photo flips over into place
        const kick = 1 + 0.06 * bump(t, SHUTTER, T.flash);
        const camIn = seg(t, CAM_IN[0], CAM_IN[1]);
        const camOut = seg(t, CAM_FADE[0], CAM_FADE[1]);
        instantMat.opacity = camIn * (1 - camOut);
        instant.visible = instantMat.opacity > 0.001;
        instant.scale.setScalar(lerp(0.7, 1, camIn) * kick);
        instant.position.y = CAM_Y + 0.3 * camOut;
        flashEl.style.opacity = 0.75 * bump(t, SHUTTER, T.flash);

        const eject = seg(t, EJECT[0], EJECT[1]);
        const flip = seg(t, FLIP[0], FLIP[1]);
        photoRig.visible = t >= EJECT[0];
        photoRig.position.copy(ejectFrom).lerp(ejectTo, eject).lerp(photoHome, flip);
        photoRig.rotation.y = lerp(Math.PI, 0, flip);
        photoRig.scale.setScalar(lerp(ejectScale, 1, flip));
        // only the part below the slot shows while it comes out; once it's fully out, no clipping
        slotClip.constant = t < EJECT[1] ? slotY : 1000;

        // photo + box: they hand over to the channel planes and don't come back
        photoMat.opacity = 1 - seg(t, CHAN_T, CHAN_T + T.photoToDots);
        backMat.opacity = photoMat.opacity;
        photo.visible = photoMat.opacity > 0.001;
        boxMat.opacity = seg(t, CROP[0], CROP[0] + 0.78 * T.crop) * (1 - seg(t, CHAN_T, CHAN_T + T.photoToDots));
        box.visible = boxMat.opacity > 0.001;
        const bs = lerp(1.5, 1, seg(t, CROP[0], CROP[1]));
        box.scale.set(bs, bs, 1);

        // planes: split apart, slide back into one picture, then drop onto the belt, turning into
        // the sheet partway down while the camera swings round
        const split = seg(t, SPLIT[0], SPLIT[1]);
        const norm = seg(t, NORM[0], NORM[1]);
        const merge = seg(t, MERGE[0], MERGE[1]);
        const drop = seg(t, DROP[0], DROP[1]);
        const dropLen = DROP[1] - DROP[0];
        const toSheet = seg(t, DROP[0] + 0.35 * dropLen, DROP[0] + 0.75 * dropLen);
        const pOp = seg(t, CHAN_T, CHAN_T + T.photoToDots) * (1 - toSheet);
        const rx = lerp(lerp(lerp(Math.PI / 2, 0.5, split), Math.PI / 2, merge), 0, drop);
        // the resize step shrinks the planes by the same proportion however big the split is
        const ps = lerp(lerp(planeStart, 1, split) * lerp(1, 0.6, norm), SHEET_SCALES[0], drop);
        planes.forEach(({grp}, k) => {
            grp.visible = pOp > 0.001;
            grp.rotation.x = rx;
            grp.rotation.y = lerp(0, Math.PI / 4, split) * (1 - merge);
            grp.position.copy(cropC).lerp(mid, split).lerp(sheetStart, drop);
            grp.position.y += (k - 1) * 1.25 * GROW * split * lerp(1, 0.22, norm) * (1 - merge);
            grp.scale.set(ps, ps, ps);
        });
        if (pOp > 0.001) {
            updatePlanes(split * lerp(1, 0.7, norm) * (1 - merge), norm * (1 - merge), norm, pOp, 0.09 * GROW * ps);
        }

        // conveyor
        stage.visible = t > DROP[0] - 0.2 && t < RETURN[1] + 0.2;
        if (stage.visible) {
            // the floor fades in early in the drop, so there's something to judge the move against,
            // and everything on it (lamp cables included) fades out over the last second of the
            // camera's return instead of vanishing
            const floorIn = seg(t, DROP[0], DROP[0] + 0.3 * dropLen) * (1 - seg(t, RETURN[1] - 0.8, RETURN[1] + 0.2));
            fading.forEach(([mat, full]) => {
                mat.opacity = full * floorIn;
            });
            slatTex.offset.x = -sh.x / STRIPE;
            sheetMat.opacity = toSheet;
            sheet.visible = sheetMat.opacity > 0.001;
            if (t < LAND) {
                // still falling: ride along with the planes it's replacing
                sheet.position.copy(planes[1].grp.position);
                sheet.rotation.x = rx - Math.PI / 2;
                sheet.scale.set(ps, ps, 1);
            } else {
                sheet.position.set(sh.x, BELT_TOP + 0.01, 0);
                sheet.rotation.x = -Math.PI / 2;
                sheet.scale.set(sh.s, sh.s, 1);
            }
            if (sheet.visible) drawSheet(t);

            foreman.extraBob = 0;
            votes.forEach((v) => {
                const k = (t - v.userData.t0) / FLY;
                foreman.extraBob += 0.05 * clamp(1 - Math.abs(k - 1) / 0.3);
            });
            workers.forEach((w) => placeWorker(w, t, view, sh));

            // votes land just in front of the clipboard, shrinking and fading into it rather than
            // passing through it
            foreman.group.updateMatrixWorld();
            const boardW = foreman.group.userData.board.getWorldPosition(tmp2);
            boardW.addScaledVector(tmp.subVectors(camera.position, boardW).normalize(), 0.3);
            votes.forEach((v) => {
                const k = clamp((t - v.userData.t0) / FLY);
                v.visible = k > 0 && k < 1;
                if (!v.visible) return;
                sheetToWorld(v.userData.line.centre, sh, v.position).lerp(boardW, ease(k));
                v.position.y += Math.sin(Math.PI * k) * 0.8;
                const vs = lerp(0.4, 0.12, ease(k));
                v.scale.set(vs, vs, 1);
                v.material.opacity = 1 - clamp((k - 0.92) / 0.08); // only vanishes as it reaches the board
            });

            const said = lines.filter(([at]) => t >= at).pop();
            bubble.visible = Boolean(said) && t < VOTE_END;
            if (bubble.visible) {
                if (said[1] !== bubbleText) {
                    bubbleText = said[1];
                    drawBubble(bubbleText);
                }
                foreman.head.getWorldPosition(bubble.position);
                bubble.position.y += 0.2 * foreman.scale; // tail tip just above his hat
            }
        }

        // the normalised image rises up from the belt below and settles on the left
        cardEnd.set(stageX, stageY, 0.1);
        cardFrom.set(stageX, stageY - 6, 0.1);
        const out = seg(t, RESULT[0], RESULT[1]);
        cardMat.opacity = seg(t, RESULT[0], RESULT[0] + 0.375 * T.resultRise);
        card.visible = cardMat.opacity > 0.001;
        card.position.copy(cardFrom).lerp(cardEnd, out);
        const cs = lerp(0.08, 1, out);
        card.scale.set(cs, cs, 1);
        card.rotation.y = lerp(Math.PI * 2, 0, out);
        cardBoxMat.opacity = seg(t, RESULT[1], RESULT[1] + 0.67 * T.resultLabels);
        cardBox.visible = cardBoxMat.opacity > 0.001;
        cardBox.position.set(cardEnd.x, cardEnd.y, cardEnd.z + 0.02);
        resultLabel.material.opacity = seg(t, RESULT[1] + 0.33 * T.resultLabels, RESULT[1] + T.resultLabels);
        resultLabel.visible = resultLabel.material.opacity > 0.001;
        resultLabel.position.set(cardEnd.x, cardEnd.y + cardH / 2 + PLATE_GAP, cardEnd.z + 0.05);

        // bars
        barsEl.style.opacity = seg(t, SCORES_T, BARS[0]);
        const bk = seg(t, BARS[0], BARS[1]);
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
            layoutResult(); // the caption's height changes with its text
        }
        if (sceneTarget) {
            renderer.setRenderTarget(sceneTarget);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);
            renderer.render(palScene, palCamera);
        } else {
            renderer.render(scene, camera);
        }
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
        if (e.target instanceof HTMLInputElement) return; // arrows move the slider, not the frame
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
        sceneTarget?.dispose();
        palPass.geometry.dispose();
        palPass.material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        root.remove();
    };
}
