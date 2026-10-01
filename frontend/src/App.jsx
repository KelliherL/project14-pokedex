import './App.css';
import { useState, useEffect, useRef } from 'react';

const STREAM_URL = 'http://localhost:8000/stream';
const WS_URL = 'ws://localhost:8000/ws';
const RECONNECT_DELAY_MS = 1000;

/*
 * Detection feed. Quad arrives normalised 0-1 so it can be dropped straight
 * into an SVG viewBox of "0 0 1 1" with no coordinate maths.
 */
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

/// Function that takes the backend quad coords and writes it over the image
/// does this with an svg
function QuadOverlay({ quad }) {
  if (!quad) return null;

  const points = quad.map(([x, y]) => `${x},${y}`).join(' ');

  // TODO this has an issue where the overlay is not normalised to the image underneath it but instead the div
    // that covers the whole thing BUG
  return (
      <svg
          viewBox="0 0 1 1"
          // none was default, meet set and the aspect ratio is perfect, but alignment with the image is off
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <polygon
            points={points}
            fill="none"
            stroke="#7CFF4F"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
        />
      </svg>
  );
}

/// canvas for the image from the camera to go on
function CameraCanvas({ detection }) {
    const [dimensions, setDimensions] = useState({height: 0, width: 0});
      const handleImageLoad = (e) => {
          const { naturalHeight, naturalWidth } = e.target;
          setDimensions({ height: naturalHeight, width: naturalWidth });
  }
    return (
      <div className="relative aspect-video w-full bg-black overflow-hidden">
        <img
            src={STREAM_URL}
            alt="camera feed"
            onLoad={handleImageLoad}
            className="w-full h-full object-contain"
        />
        {/*SVG quad to overlay, if there is one*/}
        <QuadOverlay quad={detection?.quad} />
      </div>
  );
}

function ConfidencePanel({ detection }) {
  // confidence not displayed till data returned
  const sigma = detection?.sigma ?? 0;
  const percent = Math.min(100, Math.max(0, (sigma / 6) * 100));

  return (
      <div className="border w-full h-full p-4">
        <h1 className="text-center font-bold">Confidence</h1>
        <div className="mt-4 h-4 w-full bg-black/30 rounded overflow-hidden">
          <div
              className="h-full bg-green-400 transition-[width] duration-100"
              style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-center text-sm">
          {detection ? `sigma ${sigma}` : 'waiting for backend'}
        </p>
      </div>
  );
}

function App() {
  const detection = useDetection(WS_URL);

  function capturePokemon() {
    // TODO write this to trigger the animation
  }

  // TODO this canvas should be hidden/shown at certain points for animation
  // TODO this pointer events thing needs to be dynamically set later on for the btn to work
  const overlayCanvas = 'bg-blue-600 opacity-0 p-10 absolute z-10 h-screen w-screen pointer-events-none';

  return (
      <div className="relative">
        <canvas id="overlay-canvas" className={overlayCanvas} />
        <div id="main-div" className="h-screen grid grid-cols-3 p-10">
          <div className="bg-green-600 col-span-2 grid place-items-center p-10">
            <CameraCanvas detection={detection} />
            <button onClick={capturePokemon} type="button" className="pl-4 pr-4 pb-2 pt-2 rounded-md bg-red-800 text-white hover:bg-red-950 hover:cursor-pointer">Capture Pokemon</button>
          </div>
          <div className="bg-blue-600 col-span-1 grid place-items-center p-10">
            <ConfidencePanel detection={detection} />
          </div>
        </div>
      </div>
  );
}

export default App;