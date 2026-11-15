# ARES submission description

ARES is an interactive Moon mission and settlement intelligence prototype. It combines a whole-planet 3D globe, four regional terrain scenes, a 2D explorer, landing and base comparison, a radiation explorer, and a simulated rover route. The visualized terrain comes from a bundled NASA PDS LOLA elevation grid. Viking surface imagery is requested from NASA Moon Trek on demand with attribution and an explicit fallback.

The radiation screen includes a compact, quality-filtered excerpt of actual Curiosity RAD Level 2 Detector E observations from two windows at Gale Crater, with UTC times and source product metadata. Animated particles and flow bands are labeled as illustrative. Coarse LOLA slope and relief feed a transparent safety proxy; other planning factors remain assumptions. ARES is for education and comparison, not certified landing decisions, rover control or NASA recommendations.

Demo: `npm install && npm run dev`. Source, tests, bundled data and a static production build are included. No API key is needed.
