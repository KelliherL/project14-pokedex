import './App.css';
import {useEffect, useRef, useState} from 'react';
import CaptureAnimation from './capture/CaptureAnimation.jsx';
import {fetchNormalised, getPokemonInfo, grabFrame} from './capture/captureFrame';

const STREAM_URL = 'http://localhost:8000/stream';
const NORMALISED_IMG_URL = 'http://localhost:8000/normalised'
const DEX_INFO_URL = 'http://localhost:8000/Pokemon/'
const WS_URL = 'ws://localhost:8000/ws';
const RECONNECT_DELAY_MS = 1000;

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
* Mock confidence panel derived from the json ws from the mock backend
* */
function ConfidencePanel({detection}) {
    // confidence not displayed till data returned
    const sigma = detection?.sigma ?? 0;
    const percent = Math.min(100, Math.max(0, (sigma / 6) * 100));
    const detectionOutput = {...detection};
    //TODO Top five should always be present, with results being 0 across all when not available
    const topFive = detection?.top5;

    return (<div className="border w-full h-full p-4">
        <h1 className="text-center font-bold">Confidence</h1>
        <div className="mt-4 h-4 w-full bg-black/30 rounded overflow-hidden">
            <div
                className="h-full bg-green-400 transition-[width] duration-100"
                style={{width: `${percent}%`}}
            />
        </div>
        <div className="mt-4 space-y-1">
            {Array.isArray(topFive) && topFive.map((item, index) => (
                <p k={index} className="test-xs flex justify-between">
                    <span>{item.name}</span>
                    <span className="font-mono">{(item.confidence * 100).toFixed(2)}%</span>
                </p>))}
        </div>
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

    // dex entry for whatever the backend locked onto, dumped at the end of the animation. Not awaited:
    // the database can be slow, and the animation only needs it at the very end
    const dexId = normalised?.dexId ?? detection?.dexId ?? null;
    const info = dexId != null ? getPokemonInfo(DEX_INFO_URL, dexId) : null;

    return {
        dexId,
        info,
        frame,
        normalised: normalised?.image ?? frame,
        quad: detection?.quad ?? null,
        scores: detection?.top5 ?? [],
    };
}


function App() {
    const detection = useDetection(WS_URL);
    const [capture, setCapture] = useState(null);

    const camImgRef = useRef(null);

    const handleCapture = async () => {
        const result = await capturePokemon(camImgRef, detection);
        if (result) setCapture(result);
    };

    return (<div className="relative">
        <CaptureAnimation capture={capture} onClose={() => setCapture(null)}/>
        <div id="main-div" className="h-screen grid grid-cols-3 p-10">
            <div className="bg-green-600 col-span-2 grid place-items-center p-10">
                <CameraCanvas ref={camImgRef} detection={detection}/>
                <button onClick={handleCapture} type="button"
                        className="pl-4 pr-4 pb-2 pt-2 rounded-md bg-red-800 text-white hover:bg-red-950 hover:cursor-pointer">Capture
                    Pokemon
                </button>
            </div>
            <div className="bg-blue-600 col-span-1 grid place-items-center p-10">
                <ConfidencePanel detection={detection}/>
            </div>
        </div>
    </div>);
}

export default App;
