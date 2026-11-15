# TerraTwin × Meridian

One platform, two planets:

| | App | Folder | Address |
|---|---|---|---|
| Earth | **Meridian** — AI geospatial intelligence (Leaflet map, research agent, solar/agriculture siting) | `earth/` (Python) | http://localhost:8001 |
| Moon | **TerraTwin** — 3D Moon terrain intelligence, landing sites, rover routes | this folder (Node/Vite) | http://localhost:5173 |

## Start

Double-click **`start-all.cmd`**. It starts both servers in their own windows and opens the Earth map.

- **Earth → Moon:** the red **Moon 3D** button in Meridian's top bar opens TerraTwin full-screen on top of the
  Earth map. The Earth analysis (chat, results, map position) stays where it was.
- **Moon → Earth:** the blue **Back to Earth** button at the left of TerraTwin's top bar (the browser Back button
  works too). While you are on Earth, TerraTwin stops rendering, so the 3D globe uses no GPU in the background;
  pressing Moon 3D again resumes instantly instead of reloading.
- TerraTwin still works on its own at http://localhost:5173 — there, *Back to Earth* opens Meridian.

Different ports or hosts: set `MOON_URL=` in `earth/backend/.env` (Meridian → TerraTwin) and build TerraTwin with
`VITE_EARTH_URL=` (TerraTwin → Meridian). Defaults: same host, ports 5173 and 8001.

The two servers stay separate (Python and Node) and keep their own API keys and settings: see
`earth/README.md` and `SERVER.md`.

## Performance changes in this merge

TerraTwin 3D viewport (`src/components/MoonViewport3D.tsx`):
- Render on demand: the scene is redrawn only when the camera, a prop or a texture changes (plus a slow idle
  refresh), instead of 60 frames per second all the time. Fully paused while hidden behind the Earth map.
- Hover raycasts: at most one per frame, none while dragging, and the app only re-renders when the hovered
  value changes (previously every mouse move re-rendered the whole app).
- Screen labels are re-projected only after the view changed, and React state is updated only if they moved.
- Regional terrain: the elevation grid copy and min/max scan are done once per patch instead of for every
  marker and route point (overlay rebuilds were O(route points × grid cells)).
- The 144×288 displaced globe geometry is reused across layer/weight changes; imagery textures are no longer
  re-uploaded when landing weights change.
- Pixel ratio capped at 1.5 (was 2) and the high-performance GPU is requested.

Meridian (`earth/backend`):
- Country boundaries are serialised once and served gzip-compressed (much smaller download, faster first map).
- Map tooltip: HTML is rebuilt only when the hovered country changes; moves are batched per frame.
