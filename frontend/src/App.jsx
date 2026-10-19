import './App.css';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import CaptureAnimation from './capture/CaptureAnimation.jsx';
import {ZOOM_SECONDS} from './capture/recognitionAnimation';
import {fetchNormalised, getPokemonInfo, grabFrame} from './capture/captureFrame';

const STREAM_URL = 'http://localhost:8000/stream';
const NORMALISED_IMG_URL = 'http://localhost:8000/normalised'
const DEX_INFO_URL = 'http://localhost:8000/Pokemon/'
const WS_URL = 'ws://localhost:8000/ws';
const RECONNECT_DELAY_MS = 1000;

// Settings
// Controls lights of the UI and explanation text (probably needs updating)
const LOCKED_SIGMA = 4;
const UNSURE_BELOW = 0.4;
// Alternate idle screen
const SHOW_PANEL_WHEN_IDLE = true;   
// How often to refresh the rectified view while a card is detected
const RECTIFIED_REFRESH_MS = 1000;
// The capture animation is laid out at this width (and 16:9 height), then scaled to fit its box on
// the screen, so its text and panels keep the proportions they have full screen. Smaller = bigger
// text and panels in the animation
const ANIM_LAYOUT_WIDTH = 1280;

// Wording for the small explanation line under the bars
const explain = (d) => {
  if (!d) return 'Waiting for a card...';
  if ((d.sigma ?? 0) >= LOCKED_SIGMA) return `Locked on. Best match: ${d.top5?.[0]?.name ?? '?'}.`;
  return 'Looking... hold the card steady.';
};

// Type colours (idk if these are needed)
const TYPE_COLORS = {
  Bug: '#8c9a1c', Dark: '#4a3a32', Dragon: '#5a54d6',
  Electric: '#f0a000', Fairy: '#d98ad9', Fighting: '#7a3418',
  Fire: '#e0481a', Flying: '#7f95e8', Ghost: '#4a4a9c',
  Grass: '#3a9a28', Ground: '#b89a4a', Ice: '#58c8e8',
  Normal: '#9a9a8a', Poison: '#8a3a9a', Psychic: '#e8386a',
  Rock: '#a08a3a', Steel: '#8a8a9a', Water: '#2878e0',
};

const ART_URL = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

// Rectified card, normalised live while a card is detected
function LiveRectified({active}) {
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), RECTIFIED_REFRESH_MS);
    return () => clearInterval(id);
  }, [active]);

  const showing = active && loaded;
  return (<div className="rect">
    {active && (<img
      src={`${NORMALISED_IMG_URL}?t=${tick}`}
      alt="rectified card"
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(false)}
      style={{display: showing ? 'block' : 'none'}}
    />)}
    {!showing && <span className="small">Rectified view</span>}
  </div>);
}

// Rectified card, as an image when the scan was captured
function FrozenRectified({source}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
  }, [source]);

  return <div className="rect"><canvas ref={canvasRef}/></div>;
}

// Confidence panel
// Shows the rectified card, the top 5 matches, and a confidence bar for each
function ConfidencePanel({detection, rectified, className = ''}) {
  const topFive = detection?.top5 ?? [];

  return (<div className={`card ${className}`}>
    <h2>My guess</h2>

    <div className="conf-body">
      {rectified}
      <div className="rows">
        {/* Top 5 */}
        {Array.from({length: 5}, (_, i) => topFive[i]).map((s, i) => (
          <div key={i} className={`row ${i === 0 && s ? 'win' : ''}`}>
            <span>{s?.name ?? '---'}</span>
            <div className="track">
              <div className="fill" style={{width: `${(s?.confidence ?? 0) * 100}%`}}/>
            </div>
            <span>{((s?.confidence ?? 0) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>

    <p className="small explain">{explain(detection)}</p>
  </div>);
}

// Camera screen
function CameraView({detection, camImgRef}) {
  const showPanel = detection || SHOW_PANEL_WHEN_IDLE;

  return (<div className={`view ${showPanel ? '' : 'solo'}`}>

    <div className="feed">
      <CameraCanvas ref={camImgRef} detection={detection}/>

      {!detection && (<div className="overlay">
        {/* Camera icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="6" width="20" height="14" rx="2"/>
          <circle cx="12" cy="13" r="4"/>
          <path d="M8 6l1.5-2h5L16 6"/>
        </svg>
        <h2>Live Camera View</h2>
        <p>Place a Pokémon card or figurine in front of the camera</p>
      </div>)}
    </div>

    {showPanel && (<div className="min-h-0">
      <ConfidencePanel detection={detection} rectified={<LiveRectified active={!!detection}/>}/>
      <p className="small" style={{marginTop: '1.2cqw'}}>Hold steady, then press the big black button to scan.</p>
    </div>)}

  </div>);
}

// The database lost its accented and curly characters on import: they're stored as the "unknown
// character" symbol (�), so the right letter can't be recovered here. Patch the ones seen so
// far (the é in Pokémon, and apostrophes) until the data is re-imported with the right encoding
const fixText = (s) => s?.replace(/Pok�mon/g, 'Pokémon').replace(/�/g, '\'');

// one labelled row of the dex entry, like the rows on a trainer card
function Line({label, className = '', children}) {
  return (<div className={`line ${className}`}>
    <span className="label">{label}</span>
    <span className="value">{children}</span>
  </div>);
}

// Result screen
function ResultView({outcome, onBack}) {
  const {dexId, scores} = outcome;

  // dex entry for the Pokémon the backend locked onto, looked up from the database here
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (dexId == null) return undefined;
    let current = true; // ignore a late answer if the result has moved on
    getPokemonInfo(DEX_INFO_URL, dexId).then((data) => {
      if (current) setInfo(data);
    });
    return () => {
      current = false;
    };
  }, [dexId]);

  // field names as the database sends them (enName, typings, classification, ...)
  const name = fixText(info?.enName) ?? scores[0]?.name ?? 'Unknown';
  // typings come lowercase ("electric"); TYPE_COLORS and the pills use "Electric"
  const types = (info?.typings ?? []).map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  const num = (v, unit) => (v == null ? '?' : `${+Number(v).toFixed(1)} ${unit}`); // 0.30000001 -> 0.3
  const genderless = info && !info.percentMale && !info.percentFemale;
  const description = fixText(info?.description?.replace(/^"|"$/g, '')); // stored with quotes around it

  return (<div className="view result">

    <div className="art">
      {dexId != null && <img src={ART_URL(dexId)} alt={name}/>}
    </div>

    <div className="card entry">
      {/* name, type and classification, then generation and size */}
      <section className="lines">
        <Line label="Name">{name}</Line>
        <Line label="Type" className="types">
          {types.map((t) => (
            <span key={t} className="pill" style={{background: TYPE_COLORS[t]}}>{t}</span>
          ))}
        </Line>
        <Line label="Class">{fixText(info?.classification)}</Line>
        <Line label="Generation">{info?.generation}</Line>
        <Line label="Height">{num(info?.heightM, 'm')}</Line>
        <Line label="Weight">{num(info?.weightKG, 'kg')}</Line>
      </section>

      {/* base stats two to a row, then gender split and description */}
      <section>
        <div className="lines stats">
          <Line label="HP">{info?.hp}</Line>
          <Line label="Speed">{info?.speed}</Line>
          <Line label="Attack">{info?.attack}</Line>
          <Line label="Sp. Atk">{info?.spAttack}</Line>
          <Line label="Defense">{info?.defense}</Line>
          <Line label="Sp. Def">{info?.spDefense}</Line>
        </div>

        <div className="lines">
          <Line label="Male/Female">
            {genderless ? 'Genderless' : `${info?.percentMale ?? '?'} / ${info?.percentFemale ?? '?'} %`}
          </Line>
          <Line label="Description" className="tall">{description}</Line>
        </div>
      </section>

      <div className="buttons">
        <button type="button" className="btn" onClick={onBack}>Scan again</button>
      </div>
    </div>

  </div>);
}

// Unsure screen
function UnsureView({onBack}) {
  return (<div className="view solo">
    <div className="card unsure">
      <div className="q">?</div>
      <h1>Unsure</h1>
      <p>Tip: improve the lighting and fill more of the frame.</p>
      <button type="button" className="btn" onClick={onBack}>Try again</button>
    </div>
  </div>);
}

// For the capture animation: finds a 16:9 box centred where the camera feed is (the animation plays
// in it, the confidence panel stays beside it), and zooms the Pokédex in until that box covers the
// whole window, then back out. The shell is moved and scaled with a CSS transform, so everything on
// the screen, scanlines included, scales together. Page measurements are divided by the current
// zoom, so it can all be redone on a window resize while zoomed in.
function useScreenZoom(zoomed, shellRef, screenRef) {
  const [transform, setTransform] = useState('none');
  const [slot, setSlot] = useState(null); // where the animation goes, in the screen's layout pixels

  useLayoutEffect(() => {
    if (!zoomed) {
      setTransform('none');
      return undefined;
    }
    const fit = () => {
      const shell = shellRef.current;
      const screen = screenRef.current;
      if (!shell || !screen) return;
      const sr = screen.getBoundingClientRect();
      const z = sr.width / screen.offsetWidth || 1;
      // the camera feed's inside, or the whole screen if the feed isn't showing
      const feed = screen.querySelector('.feed') ?? screen;
      const fr = feed.getBoundingClientRect();
      const inner = feed === screen ? 0 : 1;
      const fx = (fr.left - sr.left) / z - screen.clientLeft + inner * feed.clientLeft;
      const fy = (fr.top - sr.top) / z - screen.clientTop + inner * feed.clientTop;
      const w = Math.min(feed.clientWidth, (feed.clientHeight * 16) / 9);
      const h = (w * 9) / 16;
      const box = {left: fx + (feed.clientWidth - w) / 2, top: fy + (feed.clientHeight - h) / 2, width: w, height: h};
      setSlot(box);

      const parent = shell.offsetParent?.getBoundingClientRect() ?? {left: 0, top: 0};
      // multiplied the height and width by 1.1x here to make the viewport a little bigger
      const scale = Math.max(window.innerWidth / (w*1.1), window.innerHeight / (h*1.1));
      // middle of the box, from the shell's top left corner (the transform's origin)
      const cx = shell.clientLeft + screen.offsetLeft + screen.clientLeft + box.left + w / 2;
      const cy = shell.clientTop + screen.offsetTop + screen.clientTop + box.top + h / 2;
      const tx = window.innerWidth / 2 - (parent.left + shell.offsetLeft) - scale * cx;
      const ty = window.innerHeight / 2 - (parent.top + shell.offsetTop) - scale * cy;
      setTransform(`translate(${tx}px, ${ty}px) scale(${scale})`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [zoomed, shellRef, screenRef]);

  return {transform, slot};
}

// Pokedex body and screen picker
function Pokedex(props) {
  const {camImgRef, onScan, onBack, detection, outcome, zoomed, busy} = props;
  const shellRef = useRef(null);
  const screenRef = useRef(null);
  const {transform, slot} = useScreenZoom(zoomed, shellRef, screenRef);

  const unsure = outcome && (outcome.dexId == null || (outcome.scores[0]?.confidence ?? 0) < UNSURE_BELOW);

  // idle = red light, scanning = yellow light, locked = green light
  let status = 'idle';
  if (outcome) status = unsure ? 'scanning' : 'locked';
  else if (detection) status = (detection.sigma ?? 0) >= LOCKED_SIGMA ? 'locked' : 'scanning';

  return (<div className={`dex ${busy ? 'zooming' : ''}`} style={{'--zoom-time': `${ZOOM_SECONDS}s`}}>
    <div className="shell" ref={shellRef} style={{transform}}>

      <div className="top">
        <div className="lens" data-on={status !== 'idle'}/>
        <div className="lights">
          <b className="light r" data-on={status === 'idle'}/>
          <b className="light y" data-on={status === 'scanning'}/>
          <b className="light g" data-on={status === 'locked'}/>
        </div>
      </div>

      <div className="bezel">
        <div className="screen" ref={screenRef}>
          {/* Choose the screen to display; nothing on it reacts while a capture is playing */}
          <div className="views" inert={busy}>
            {!outcome && <CameraView detection={detection} camImgRef={camImgRef}/>}
            {outcome && unsure && <UnsureView onBack={onBack}/>}
            {outcome && !unsure && <ResultView outcome={outcome} onBack={onBack}/>}
          </div>
          {/* the capture animation, over the camera feed; outside .views so its own buttons still work */}
          <div className="anim-slot" style={slot ? {
            ...slot,
            '--anim-w': `${ANIM_LAYOUT_WIDTH}px`,
            '--anim-fit': slot.width / ANIM_LAYOUT_WIDTH,
          } : undefined}>{props.animation}</div>
          <div className="crt"/>
        </div>
      </div>

      <div className="foot">
        <div className="grille"><i/><i/><i/></div>
        <span className="slot" data-label="FAQ"/>
        <button type="button" className="slot blue" onClick={onBack} disabled={busy} aria-label="Back" data-label="History"/>
        <button type="button" className="big" onClick={onScan} disabled={busy} aria-label="Scan" data-label="Capture"/>
      </div>

    </div>
  </div>);
}

/*
* This function handles ws connections via a url
* */
function useDetection(url) {

  const [detection, setDetection] = useState(null);
  const socketRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let closed = false;

    // connect to the ws and listen for json data being passed along
    function connect() {
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.addEventListener('message', (event) => {
        setDetection(JSON.parse(event.data));
      });

      // on disconnection, try again in reconnect delay ms
      socket.addEventListener('close', () => {
        if (closed) return;
        setDetection(null);
        retryRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    // try to connect upon load
    connect();

    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [url]);

  return detection;
}

/*
* QuadOverlay takes in a normalised quad, image width and height, and returns an svg ready to be overlaid
* */
function QuadOverlay({quad, width, height}) {
  if (!quad || !width) return null;
  const points = quad.map(([x, y]) => `${x * width},${y * height}`).join(' ');
  return (<svg viewBox={`0 0 ${width} ${height}`}
               preserveAspectRatio="xMidYMid meet"
               className="absolute inset-0 w-full h-full pointer-events-none">
    <polygon points={points}
             fill="none"
             stroke="#15A3C7"
             strokeWidth="3"
             vectorEffect="non-scaling-stroke"/>
  </svg>);
}

/*
* Handles compositing the svg and image from the backend
* */
function CameraCanvas({detection, ref}) {
  const [dimensions, setDimensions] = useState({height: 0, width: 0});
  const handleImageLoad = (e) => {
    const {naturalHeight, naturalWidth} = e.target;
    setDimensions({height: naturalHeight, width: naturalWidth});
  }

  return (<div className="relative aspect-video w-full bg-black overflow-hidden">
    <img
      ref={ref}
      src={STREAM_URL}
      // needed so the frame can be read back off a canvas when capturing
      crossOrigin="anonymous"
      alt="camera feed"
      onLoad={handleImageLoad}
      className="w-full h-full object-contain"
    />
    {/*SVG quad to overlay, dimensions are only grabbed on first load, so if change mid-stream: issue*/}
    <QuadOverlay quad={detection?.quad} width={dimensions.width} height={dimensions.height}/>
  </div>);
}

/*
* Freezes the current stream frame and fetches the normalised crop, ready for the animation.
* The detection is snapshotted too so the quad and scores match the moment of capture.
* */
async function capturePokemon(imageRef, detection) {
  // request the normalised crop first thing, the backend only keeps it around briefly
  const normalisedRequest = fetchNormalised(NORMALISED_IMG_URL);

  const frame = grabFrame(imageRef.current);
  if (!frame) return null;

  // Fallback: if there is no normalised image (no lock yet / request failed), use the captured frame
  const normalised = await normalisedRequest;

  // whatever the backend locked onto; the result screen looks its dex entry up from this
  const dexId = normalised?.dexId ?? detection?.dexId ?? null;

  return {
    dexId, frame, normalised: normalised?.image ?? frame, quad: detection?.quad ?? null,
    scores: detection?.top5 ?? [],
    sigma: detection?.sigma ?? 0,
  };
}


function App() {
  const detection = useDetection(WS_URL);
  const [capture, setCapture] = useState(null);
  const [outcome, setOutcome] = useState(null);
  // from pressing capture until the zoom back out has finished; the Pokédex's buttons are
  // disabled meanwhile so nothing can interrupt the animation
  const [busy, setBusy] = useState(false);

  const camImgRef = useRef(null);

  const handleCapture = async () => {
    if (busy) return;
    setBusy(true);
    const result = await capturePokemon(camImgRef, detection);
    if (result) setCapture(result);
    else setBusy(false);
  };

  return (<div className="relative">
    <Pokedex
      animation={<CaptureAnimation capture={capture} onClose={() => {
        setOutcome(capture);
        setCapture(null);
        setTimeout(() => setBusy(false), ZOOM_SECONDS * 1000); // once the zoom back out is done
      }}/>}
      zoomed={capture != null}
      busy={busy}
      detection={detection}
      camImgRef={camImgRef}
      outcome={outcome}
      onScan={outcome ? () => setOutcome(null) : handleCapture}
      onBack={() => setOutcome(null)}
    />
  </div>);
}

export default App;