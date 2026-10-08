/*
* Helpers for grabbing what the animation needs: a still of the stream, and the normalised crop.
* */

/*
* Copies the current frame of the stream <img> onto a canvas. Returns null if the image isn't
* loaded or the canvas is tainted (the <img> needs crossOrigin="anonymous" and the backend CORS).
* */
export function grabFrame(imgElement) {
  if (!imgElement) return null;
  const width = imgElement.naturalWidth || imgElement.clientWidth;
  const height = imgElement.naturalHeight || imgElement.clientHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  try {
    ctx.drawImage(imgElement, 0, 0, width, height);
    // drawImage never throws on a tainted canvas, reading it back does
    ctx.getImageData(0, 0, 1, 1);
  } catch (error) {
    console.error('Failed to capture frame. If streaming from another domain, ensure CORS is configured.', error);
    return null;
  }
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/*
* Fetches the normalised crop. Returns {image, dexId}, or null when there is no lock yet (404)
* or the backend can't be reached.
* */
export async function fetchNormalised(url) {
  try {
    // cache-bust: the crop changes with every lock but the url doesn't
    const response = await fetch(`${url}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const objectUrl = URL.createObjectURL(await response.blob());
    try {
      const image = await loadImage(objectUrl);
      if (image.naturalWidth < 1 || image.naturalHeight < 1) return null;
      return { image, dexId: response.headers.get('X-Dex-Id') };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.error('Failed to fetch normalised image.', error);
    return null;
  }
}

export async function getPokemonInfo(url, dexId) {
  try {
    // strip any trailing slash so we don't request /pokemon//387
    const response = await fetch(`${url.replace(/\/+$/, '')}/${dexId}`);
    if (!response.ok) return null;
    const info = await response.json();
    if (info.pokemon_id === 0) {
      console.log(`Pokemon ID: ${dexId} not found.`);
      // TODO handle this error case means we have a Pokemon that is not in the db
      // maybe they input the data on a seperate screen?
    }
    return info;
  } catch (error) {
    console.error(error);
    return null;
  }
}
