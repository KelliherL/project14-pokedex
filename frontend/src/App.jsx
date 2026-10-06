import './App.css';
import {useEffect, useRef, useState} from 'react';

const STREAM_URL = 'http://localhost:8000/stream';
const NORMALISED_IMG_URL = 'http://localhost:8000/normalised'
const DEX_INFO_URL = 'http://localhost:8000/pokemon/'
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
                     stroke="#7CFF4F"
                     strokeWidth="3"
                     vectorEffect="non-scaling-stroke"/>
        </svg>);
}

/*
* Handles compositing the svg and image from the backend
* */
function CameraCanvas({detection}, ref) {
    const [dimensions, setDimensions] = useState({height: 0, width: 0});
    const handleImageLoad = (e) => {
        const {naturalHeight, naturalWidth} = e.target;
        setDimensions({height: naturalHeight, width: naturalWidth});
    }

    return (<div className="relative aspect-video w-full bg-black overflow-hidden">
            <img
                ref={ref}
                src={STREAM_URL}
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

    return (<div className="border w-full h-full p-4">
            <h1 className="text-center font-bold">Confidence</h1>
            <div className="mt-4 h-4 w-full bg-black/30 rounded overflow-hidden">
                <div
                    className="h-full bg-green-400 transition-[width] duration-100"
                    style={{width: `${percent}%`}}
                />
            </div>
            <p className="mt-2 text-center text-sm">
                {detection ? `sigma ${sigma}` : 'waiting for backend'}
            </p>
        </div>);
}

function capturePokemon(imageRef) {
    const imgElement = imageRef.current;
    if (!imgElement) return;

    // Create a hidden canvas to capture the current frame
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.clientWidth;
    canvas.height = imgElement.naturalHeight || imgElement.clientHeight;

    const ctx = canvas.getContext('2d');

    // Draw the current state of the stream image onto the canvas
    try {
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
        console.log("Captured image success")
    } catch (error) {
        console.error("Failed to capture frame. If streaming from another domain, ensure CORS is configured.", error);
        return;
    }

    // Convert the canvas snapshot to a static image URL
    const capturedDataUrl = canvas.toDataURL('image/png');

    // Create frozen snapshot image element for the animation
    const capturedImg = new Image();
    capturedImg.src = capturedDataUrl;

    // Handle normalized image request and fallback logic
    const normalisedImg = new Image();
    normalisedImg.src = NORMALISED_IMG_URL;

    normalisedImg.onload = () => {
        if (normalisedImg.height < 1) {
            // Fallback: If normalized image fails or is empty, use the captured screenshot
            normalisedImg.src = capturedDataUrl;
        }

        //  Initiate the animation here now that images are ready
    };

    // Handle case where normalisedImg fails to load entirely
    normalisedImg.onerror = () => {
        normalisedImg.src = capturedDataUrl;
    };
}


function App() {
    const detection = useDetection(WS_URL);

    const camImgRef = useRef(null);

    // TODO this canvas should be hidden/shown at certain points for animation
    // TODO this pointer events thing needs to be dynamically set later on for the btn to work
    const overlayCanvas = 'bg-blue-600 opacity-0 p-10 absolute z-10 h-screen w-screen pointer-events-none';


    return (<div className="relative">
            <canvas id="overlay-canvas" className={overlayCanvas}/>
            <div id="main-div" className="h-screen grid grid-cols-3 p-10">
                <div className="bg-green-600 col-span-2 grid place-items-center p-10">
                    <CameraCanvas ref={camImgRef} detection={detection}/>
                    <button onClick={capturePokemon} type="button"
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