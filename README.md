# google-maps-2d-satellite

Serverless wrapper for Google Maps Platform 2D Satellite Tiles (Essentials SKU, 10k free calls/month).

## Endpoints

- `GET /session` - create a session token (needed before fetching tiles)
- `GET /tile?z=&x=&y=&session=` - fetch a single satellite tile as base64 PNG
- `GET /overview?lat=&lng=&zoom=` - convenience: fetch one tile covering a lat/lng
- `GET /health` - service health

## Env

- `GOOGLE_MAPS_API_KEY` - required
