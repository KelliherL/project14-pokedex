# Frontend
This folder contains all the frontend react code in JS.

Recommended install if using pnpm:
```
cd frontend
pnpm install
pnpm dev
```
Then visit `localhost:5173`

Swap to `npm` if not using pnpm, although it is recommended.

## Decisions
Below are the decisions made at this time.

For a 2026 React frontend built with Vite that streams webcam frames to a local FastAPI backend and receives live recognition updates, these are the current recommended libraries:

- Camera capture: react-webcam
- WebSockets: native WebSocket API or react-use-websocket
- REST/data fetching: @tanstack/react-query
- Animations: framer-motion
- Styling: tailwindcss, or a component lib like chakra-ui / MUI if you want a more opinionated UI

### Recommendations

- Vite + React + TypeScript
- react-webcam for camera access
- native WebSocket for live frame streaming and recognition updates
- @tanstack/react-query for normal GET/POST requests like Pokémon details
- motion (or framer-motion) for UI animation
- Tailwind CSS for custom design and layout
- Zod for validating backend payloads

### Important architectural points
- Do not use normal POST requests for every webcam frame.
- Use a WebSocket for continuous camera frames and live recognition updates.
- Use REST for things like:
    - GET /health
    - GET /api/pokemon/:id
    - POST /api/reset
    - POST /api/speak

### Frontend stack:
- react-webcam
- react-use-websocket (optional, but useful)
- @tanstack/react-query
- motion
- tailwindcss

Example setup:
- Browser gets webcam permission
- Browser resizes frames and sends JPEGs over WebSocket
- FastAPI backend runs recognition
- Backend returns a JSON identification result
- React updates the UI with the matched Pokémon name, artwork, captions, confidence, and explanation panel

Core idea:
- WebSocket = live recognition loop
- REST = static or occasional data
- React state = UI state transitions
- Motion = polish and animations

The exact stack I’d choose for your case:
- Vite + React + TS
- react-webcam
- native WebSocket
- @tanstack/react-query
- motion
- tailwindcss
- zod

This gives you a clean setup for:
- live camera capture
- continuous backend communication
- fun animated UI
- clean Pokémon info display
- no overcomplicated frontend architecture