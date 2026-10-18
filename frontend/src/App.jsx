import './App.css';
import {useEffect, useRef, useState} from 'react';
import CaptureAnimation from './capture/CaptureAnimation.jsx';
import {fetchNormalised, getPokemonInfo, grabFrame} from './capture/captureFrame';

const STREAM_URL = 'http://localhost:8000/stream';
const NORMALISED_IMG_URL = 'http://localhost:8000/normalised'
const DEX_INFO_URL = 'http://localhost:8000/Pokemon/'
const WS_URL = 'ws://localhost:8000/ws';
const RECONNECT_DELAY_MS = 1000;

// Settings
// Controls lights of the UI and explanation text (probably needs updating)
const LOCKED_SIGMA = 4;
const UNSURE_BELOW = 0.5;
// Alternate idle screen
const SHOW_PANEL_WHEN_IDLE = true;   
// How often to refresh the rectified view while a card is detected
const RECTIFIED_REFRESH_MS = 1000;

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
  const sigma = detection?.sigma ?? 0;
  const percent = Math.min(100, Math.max(0, (sigma / 6) * 100));
  const topFive = detection?.top5 ?? [];

  return (<div className={`card ${className}`}>
    <h2>Confidence</h2>
    <div className="track sigma">
      <div className="fill" style={{width: `${percent}%`, background: 'var(--accent)'}}/>
    </div>

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

// Result screen
function ResultView({outcome, onBack}) {
  const {info, dexId, scores, sigma, normalised} = outcome;
  const name = info?.name ?? scores[0]?.name ?? 'Unknown';

  // Speak button function
  const speak = () => {

  };

  return (<div className="view result">

    <div className="art">
      {dexId != null && <img src={ART_URL(dexId)} alt={name}/>}
    </div>

    <div className="card">
      <h1>{name}</h1>
      <p className="small">{info?.genus}</p>

      <div className="pills">
        {(info?.types ?? []).map((t) => (
          <span key={t} className="pill" style={{background: TYPE_COLORS[t]}}>{t}</span>
        ))}
      </div>

      <p>{info?.flavor}</p>

      <div className="buttons">
        <button type="button" className="btn" onClick={speak}>Hear it</button>
        <button type="button" className="btn" onClick={onBack}>Scan again</button>
      </div>
    </div>

    <ConfidencePanel
      className="wide"
      detection={{sigma, top5: scores}}
      rectified={<FrozenRectified source={normalised}/>}
    />

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

// Pokedex body and screen picker
function Pokedex(props) {
  const {camImgRef, onScan, onBack, detection, outcome} = props;

  const unsure = outcome && (outcome.dexId == null || (outcome.scores[0]?.confidence ?? 0) < UNSURE_BELOW);

  // idle = red light, scanning = yellow light, locked = green light
  let status = 'idle';
  if (outcome) status = unsure ? 'scanning' : 'locked';
  else if (detection) status = (detection.sigma ?? 0) >= LOCKED_SIGMA ? 'locked' : 'scanning';

  return (<div className="dex">
    <div className="shell">

      <div className="top">
        <div className="lens" data-on={status !== 'idle'}/>
        <div className="lights">
          <b className="light r" data-on={status === 'idle'}/>
          <b className="light y" data-on={status === 'scanning'}/>
          <b className="light g" data-on={status === 'locked'}/>
        </div>
      </div>

      <div className="bezel">
        <div className="screen">
          {/* Choose the screen to display */}
          {!outcome && <CameraView detection={detection} camImgRef={camImgRef}/>}
          {outcome && unsure && <UnsureView onBack={onBack}/>}
          {outcome && !unsure && <ResultView outcome={outcome} onBack={onBack}/>}
          {props.animation}
          <div className="crt"/>
        </div>
      </div>

      <div className="foot">
        <div className="grille"><i/><i/><i/></div>
        <span className="slot"/>
        <button type="button" className="slot blue" onClick={onBack} aria-label="Back"/>
        <button type="button" className="big" onClick={onScan} aria-label="Scan"/>
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

  // dex entry for whatever the backend locked onto. Not awaited: the database can be slow, and the
  // animation only needs it at the very end
  const dexId = normalised?.dexId ?? detection?.dexId ?? null;
  const info = dexId != null ? getPokemonInfo(DEX_INFO_URL, dexId) : null;

  return {
    dexId, info, frame, normalised: normalised?.image ?? frame, quad: detection?.quad ?? null,
    scores: detection?.top5 ?? [],
    sigma: detection?.sigma ?? 0,
  };
}


function App() {
  const detection = useDetection(WS_URL);
  const [capture, setCapture] = useState(null);
  const [outcome, setOutcome] = useState(null);

  const camImgRef = useRef(null);

  const handleCapture = async () => {
    const result = await capturePokemon(camImgRef, detection);
    if (result) setCapture(result);
  };

  return (<div className="relative">
    <Pokedex
      animation={<CaptureAnimation capture={capture} onClose={() => {
        // info is still a promise: show the result now and fill the info in when it arrives
        setOutcome({...capture, info: null});
        Promise.resolve(capture.info).then((info) => setOutcome((o) => (o?.frame === capture.frame ? {...o, info} : o)));
        setCapture(null);
      }}/>}
      detection={detection}
      camImgRef={camImgRef}
      outcome={outcome}
      onScan={outcome ? () => setOutcome(null) : handleCapture}
      onBack={() => setOutcome(null)}
    />
  </div>);
}

export default App;