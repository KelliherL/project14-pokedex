import './App.css';

function capturePokemon() {
  // TODO write this to trigger the animation
}

/*
* This document contains 2 divs for the main home screen.
* Overlay Canvas - this is the canvas this is going to be used for three.js animations
* main-div - this is the div that holds all the other functional content
* cameraCanvas - this is the canvas for inputting images from the backend
* */

function App() {
  // TODO this canvas should be hidden/shown at certain points for animation
  // TODO this pointer events thing needs to be dynamically set later on for the btn to work
  const overlayCanvas = 'bg-blue-600 opacity-0 p-10 absolute z-10 h-screen w-screen pointer-events-none';

  return (
    <div className="relative">
      <canvas id="overlay-canvas" className={overlayCanvas} />
      <div id="main-div" className="h-screen grid grid-cols-3 p-10">
        <div className="bg-green-600 col-span-2 grid place-items-center p-10">
          <canvas id="cameraCanvas" className="bg-orange-300 aspect-video w-full" />
          <button onClick={capturePokemon} type="button" className="pl-4 pr-4 pb-2 pt-2 rounded-md bg-red-800 text-white hover:bg-red-950 hover:cursor-pointer">Capture Pokemon</button>
        </div>
        <div className="bg-blue-600 col-span-1 grid place-items-center p-10">
          <div className="border w-full h-full">
            <h1 className="text-center font-bold">Confidence</h1>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
