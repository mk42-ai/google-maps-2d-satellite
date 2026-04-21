const express = require('express');
const app = express();
app.use(express.json());

const TILE_BASE = 'https://tile.googleapis.com/v1';

// POST /create-session — create a 2D satellite session token.
// Required before any tile request. Tokens last ~2 weeks.
async function createSession(apiKey) {
  const response = await fetch(`${TILE_BASE}/createSession?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' })
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`createSession ${response.status}: ${text.slice(0, 500)}`);
    err.status = response.status;
    throw err;
  }
  return JSON.parse(text);
}

// GET /session — expose a fresh session token for downstream renderers.
app.get('/session', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
    const data = await createSession(apiKey);
    res.json({
      session: data.session,
      expiry: data.expiry,
      tileWidth: data.tileWidth,
      tileHeight: data.tileHeight,
      imageFormat: data.imageFormat,
      note: 'Pass session token to /tile endpoint along with z/x/y.'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Session create failed', details: err.message });
  }
});

// GET /tile?z=&x=&y=&session= — fetch a single 2D satellite PNG tile as base64.
app.get('/tile', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
    const { z, x, y } = req.query;
    let { session } = req.query;
    if (z === undefined || x === undefined || y === undefined) {
      return res.status(400).json({ error: 'z, x, y query params required (tile coordinates)' });
    }
    if (!session) {
      const s = await createSession(apiKey);
      session = s.session;
    }
    const url = `${TILE_BASE}/2dtiles/${z}/${x}/${y}?session=${session}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({
        error: `Upstream ${response.status}`,
        body: body.slice(0, 500),
        hint: response.status === 403 ? 'Enable Map Tiles API on your GCP project.' : undefined
      });
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    res.json({
      contentType,
      session,
      z: Number(z), x: Number(x), y: Number(y),
      sizeBytes: buf.length,
      base64: buf.toString('base64'),
      dataUrl: `data:${contentType};base64,${buf.toString('base64').slice(0, 100)}...`
    });
  } catch (err) {
    res.status(500).json({ error: 'Tile fetch failed', details: err.message });
  }
});

// GET /overview?lat=&lng=&zoom= — convenience endpoint: return a single satellite
// tile covering the given lat/lng at a given zoom level. Useful for "satellite
// overview" pages in a report without needing to do tile math on the caller side.
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y, z: zoom };
}

app.get('/overview', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const zoom = parseInt(req.query.zoom || '15', 10);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    const { x, y, z } = latLngToTile(lat, lng, zoom);
    const s = await createSession(apiKey);
    const url = `${TILE_BASE}/2dtiles/${z}/${x}/${y}?session=${s.session}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `Upstream ${response.status}`, body: body.slice(0, 500) });
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    res.json({
      lat, lng, zoom, tile: { z, x, y },
      session: s.session,
      contentType,
      sizeBytes: buf.length,
      base64: buf.toString('base64')
    });
  } catch (err) {
    res.status(500).json({ error: 'Overview failed', details: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'google-maps-2d-satellite' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Google Maps 2D Satellite proxy on port ${PORT}`);
});
