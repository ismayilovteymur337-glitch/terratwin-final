import { LandingSiteWeights, PlanetaryBodyConfig } from '../core/planet/types';

export const MOON_BODY: PlanetaryBodyConfig = {
  id: 'moon',
  name: 'Moon',
  meanRadiusM: 3_396_000, // LOLA MEGDR reference sphere radius (A_AXIS_RADIUS = 3396.0 km)
  equatorialRadiusM: 3_396_190,
  polarRadiusM: 3_376_200,
  surfaceGravityMps2: 3.72076,
  solarIrradianceWm2: 586.2,
  verticalDatumName: 'LOLA Areoid (PDS MEGT90N000EB v2.0, R = 3,396.0 km)',
  coordinateSystemName: 'IAU 2000 Planetocentric · East-Positive (−180°..+180° / 0°..360°E)',
  longitudeDirection: 'EAST',
};

export const EARTH_BODY_STUB: PlanetaryBodyConfig = {
  id: 'earth',
  name: 'Earth (Future Module)',
  meanRadiusM: 6_371_008.8,
  equatorialRadiusM: 6_378_137.0,
  polarRadiusM: 6_356_752.3,
  surfaceGravityMps2: 9.80665,
  solarIrradianceWm2: 1361.0,
  verticalDatumName: 'EGM2008 Geoid / WGS84',
  coordinateSystemName: 'WGS84 Geodetic',
  longitudeDirection: 'EAST',
};

export const DEFAULT_LANDING_WEIGHTS: LandingSiteWeights = {
  slopeSafety: 0.25,
  roughnessSafety: 0.20,
  craterHazardFree: 0.15,
  elevationConstraint: 0.15,
  latitudeThermal: 0.10,
  scientificValue: 0.10,
  dataConfidence: 0.05,
};

export interface LandingWeightPreset {
  id: string;
  label: string;
  description: string;
  weights: LandingSiteWeights;
}

export const LANDING_WEIGHT_PRESETS: LandingWeightPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced EDL & Science',
    description: 'Golombek et al. (2012) baseline balancing touchdown terrain safety, atmospheric column, and scientific value.',
    weights: DEFAULT_LANDING_WEIGHTS,
  },
  {
    id: 'edl_safety',
    label: 'Conservative EDL Safety',
    description: 'Prioritizes ultra-flat slopes, low TRI roughness, crater rim avoidance, and deep atmospheric deceleration column.',
    weights: {
      slopeSafety: 0.35,
      roughnessSafety: 0.25,
      craterHazardFree: 0.18,
      elevationConstraint: 0.14,
      latitudeThermal: 0.04,
      scientificValue: 0.02,
      dataConfidence: 0.02,
    },
  },
  {
    id: 'science_sample',
    label: 'Astrobiology & Science',
    description: 'Weights geological diversity, fluvial/lacustrine feature proximity, and stereo HiRISE/CTX DTM coverage.',
    weights: {
      slopeSafety: 0.18,
      roughnessSafety: 0.14,
      craterHazardFree: 0.10,
      elevationConstraint: 0.12,
      latitudeThermal: 0.06,
      scientificValue: 0.28,
      dataConfidence: 0.12,
    },
  },
  {
    id: 'solar_lander',
    label: 'Solar Equatorial Lander',
    description: 'Optimizes equatorial solar insolation and thermal regime alongside low-elevation plains.',
    weights: {
      slopeSafety: 0.22,
      roughnessSafety: 0.18,
      craterHazardFree: 0.12,
      elevationConstraint: 0.16,
      latitudeThermal: 0.22,
      scientificValue: 0.05,
      dataConfidence: 0.05,
    },
  },
];

export interface MoonPresetSite {
  id: string;
  name: string;
  lat: number;
  lon: number; // [-180, 180]
  category: 'landed_mission' | 'candidate_site' | 'scientific_region';
  mission?: string;
  geologicalSetting: string;
  keyScienceTargets: string[];
  regional128PpdTile: string;
}

export const MOON_PRESET_SITES: MoonPresetSite[] = [
  {
    id: 'jezero',
    name: 'Jezero Crater (Octavia E. Butler Landing)',
    lat: 18.4447,
    lon: 77.4508,
    category: 'landed_mission',
    mission: 'Moon 2020 Perseverance & Ingenuity (Landed Feb 2021)',
    geologicalSetting: 'Noachian–Hesperian open-basin paleolake (~45 km diameter) with western fan-delta fed by Neretva Vallis.',
    keyScienceTargets: ['Western Fan-Delta Front', 'Carbonate Marginal Unit', 'Mafic Crater Floor (Máaz / Séítah)', 'Neretva Vallis Inlet'],
    regional128PpdTile: 'megt44n000hb',
  },
  {
    id: 'gale',
    name: 'Gale Crater (Bradbury Landing)',
    lat: -4.5895,
    lon: 137.4417,
    category: 'landed_mission',
    mission: 'Moon Science Laboratory Curiosity (Landed Aug 2012)',
    geologicalSetting: '154 km impact basin hosting 5.5 km stratified central mound (Aeolis Mons / Mount Sharp) recording clay-to-sulfate transition.',
    keyScienceTargets: ['Yellowknife Bay Mudstones', 'Vera Rubin Hematite Ridge', 'Glen Torridon Clay Unit', 'Sulfate-Bearing Unit'],
    regional128PpdTile: 'megt00n090hb',
  },
  {
    id: 'ne_syrtis',
    name: 'Northeast Syrtis Major',
    lat: 17.89,
    lon: 76.89,
    category: 'candidate_site',
    mission: 'Moon 2020 Finalist Candidate Site',
    geologicalSetting: 'Exhumed Noachian crust on the western rim of Isidis Basin exposing Fe/Mg smectites, olivines, carbonates, and sulfates.',
    keyScienceTargets: ['Exhumed Noachian Megabreccia', 'Olivine-Carbonate Unit', 'Sulfate-Bearing Layered Mesa'],
    regional128PpdTile: 'megt44n000hb',
  },
  {
    id: 'mawrth',
    name: 'Mawrth Vallis Plateau',
    lat: 23.99,
    lon: -18.96,
    category: 'candidate_site',
    mission: 'MSL & ExoMoon Finalist Candidate Site',
    geologicalSetting: 'Ancient outflow channel margin along the dichotomy boundary with >200 m thick phyllosilicate-rich light-toned stratigraphy.',
    keyScienceTargets: ['Fe/Mg-Smectite Lower Unit', 'Al-Phyllosilicate Upper Horizon', 'Channel Margin Exposures'],
    regional128PpdTile: 'megt44n270hb',
  },
  {
    id: 'elysium',
    name: 'Elysium Planitia (Homestead Hollow)',
    lat: 4.5024,
    lon: 135.6234,
    category: 'landed_mission',
    mission: 'InSight Discovery 12 Lander (Landed Nov 2018)',
    geologicalSetting: 'Smooth Early Hesperian–Amazonian volcanic plains with shallow regolith over fractured basalt flows.',
    keyScienceTargets: ['Homestead Hollow Regolith', 'Subsurface Basalt Flows', 'Tectonic Wrinkle Ridges'],
    regional128PpdTile: 'megt44n090hb',
  },
  {
    id: 'eberswalde',
    name: 'Eberswalde Crater Delta',
    lat: -23.86,
    lon: -33.27,
    category: 'candidate_site',
    mission: 'MSL Finalist Candidate Site',
    geologicalSetting: '65 km crater north of Holden containing a well-preserved inverted meandering river delta (~115 km²).',
    keyScienceTargets: ['Inverted Distributary Channels', 'Lacustrine Mudstone Basin', 'Polygonal Clay-Bearing Strata'],
    regional128PpdTile: 'megt00n270hb',
  },
  {
    id: 'holden',
    name: 'Holden Crater Alluvial Bajada',
    lat: -26.38,
    lon: -34.90,
    category: 'candidate_site',
    mission: 'MSL Finalist Candidate Site',
    geologicalSetting: '154 km crater breached by Uzboi Vallis featuring coalescing alluvial fans and finely laminated flood deposits.',
    keyScienceTargets: ['Southwest Alluvial Fan Apron', 'Uzboi Vallis Breach Megabreccia', 'Finely Bedded Lacustrine Unit'],
    regional128PpdTile: 'megt00n270hb',
  },
  {
    id: 'meridiani',
    name: 'Meridiani Planum',
    lat: -1.9462,
    lon: -5.5266,
    category: 'landed_mission',
    mission: 'MER-B Opportunity (Landed Jan 2004)',
    geologicalSetting: 'Flat equatorial hematite-bearing plains underlain by cross-bedded sulfate-rich evaporitic sandstones.',
    keyScienceTargets: ['Burns Formation Evaporites', 'Victoria Crater Rim', 'Endeavour Crater Noachian Shoemaker Breccia'],
    regional128PpdTile: 'megt00n270hb',
  },
  {
    id: 'gusev',
    name: 'Gusev Crater (Columbia Hills)',
    lat: -14.5684,
    lon: 175.4726,
    category: 'landed_mission',
    mission: 'MER-A Spirit (Landed Jan 2004)',
    geologicalSetting: '166 km crater entered by Ma’adim Vallis; floor covered by olivine basalts surrounding older hydrothermally altered hills.',
    keyScienceTargets: ['Home Plate Opalline Silica', 'Comanche Carbonate Outcrop', 'Adirondack Olivine Basalts'],
    regional128PpdTile: 'megt00n090hb',
  },
  {
    id: 'arcadia',
    name: 'Arcadia Planitia',
    lat: 39.20,
    lon: -172.00,
    category: 'candidate_site',
    mission: 'Candidate Human / ISRU Reconnaissance Zone',
    geologicalSetting: 'Low-elevation Amazonian smooth plains in the northern lowlands with radar-inferred shallow excess water ice.',
    keyScienceTargets: ['Terraced Rampart Craters', 'Shallow Subsurface Ice Sheet', 'Smooth Volcanic/Periglacial Plains'],
    regional128PpdTile: 'megt44n180hb',
  },
  {
    id: 'melas',
    name: 'Melas Chasma (Valles Marineris)',
    lat: -9.80,
    lon: -76.40,
    category: 'scientific_region',
    mission: 'High-Relief Tectonic & Interior Layered Deposit Study Zone',
    geologicalSetting: 'Deepest central trough of Valles Marineris (~−4.5 km floor) exposing kilometer-scale interior layered sulfate deposits.',
    keyScienceTargets: ['Interior Layered Deposits (ILDs)', 'Chasma Wall Fault Scarps', 'Sulfate-Opal Hydrated Beds'],
    regional128PpdTile: 'megt00n270hb',
  },
  {
    id: 'olympus_scarp',
    name: 'Olympus Mons Southeast Basal Scarp',
    lat: 18.65,
    lon: -133.80,
    category: 'scientific_region',
    mission: 'Extreme Elevation & Slope Benchmark (Non-viable EDL)',
    geologicalSetting: 'Towering shield volcano edifice (+21.2 km summit) bounded by a 6–8 km basal cliff and aureole landslide lobes.',
    keyScienceTargets: ['Basal Scarp Fault Face', 'Amazonian Lava Tubes & Channels', 'Summit Caldera Complex'],
    regional128PpdTile: 'megt44n180hb',
  },
];

export interface RoutePreset {
  id: string;
  name: string;
  regionName: string;
  description: string;
  start: { lat: number; lon: number; label: string };
  destination: { lat: number; lon: number; label: string };
}

export const MOON_ROUTE_PRESETS: RoutePreset[] = [
  {
    id: 'jezero_delta_scarp_hirise',
    name: 'Jezero Western Delta Ascent (HiRISE 1 m Stereo DTM)',
    regionName: 'Jezero Western Delta (LOD 3 Local)',
    description: 'High-resolution ~2.8 km ascent from Octavia E. Butler Landing across the Three Forks fan front and Hawksbill Gap up the Western Delta scarp to Belva Crater on the 1.02 m/px HiRISE stereo DTM.',
    start: { lat: 18.4447, lon: 77.4508, label: 'Octavia E. Butler Landing' },
    destination: { lat: 18.4720, lon: 77.4120, label: 'Western Delta Top (Belva Crater Plateau)' },
  },
  {
    id: 'jezero_delta_climb',
    name: 'Jezero Crater Floor → Western Delta & Neretva Rim (CTX 20 m DTM)',
    regionName: 'Jezero Crater (LOD 2 Regional)',
    description: 'Regional ~21 km traverse from Perseverance landing zone across Séítah margin and western delta front up onto the Neretva Vallis western crater rim on the 20.16 m/px CTX stereo DTM.',
    start: { lat: 18.4447, lon: 77.4508, label: 'Octavia E. Butler Landing' },
    destination: { lat: 18.5250, lon: 77.2650, label: 'Neretva Vallis Western Rim' },
  },
  {
    id: 'jezero_to_nesyrtis',
    name: 'Jezero Crater → Northeast Syrtis Midway Megabreccia',
    regionName: 'Jezero / NE Syrtis Intercrater Traverse',
    description: 'Extended regional traverse from the Jezero floor southwest across the western rim into the Noachian crust of NE Syrtis.',
    start: { lat: 18.4447, lon: 77.4508, label: 'Jezero Landing Zone' },
    destination: { lat: 17.9200, lon: 76.9200, label: 'NE Syrtis Carbonate Mesa' },
  },
  {
    id: 'gale_mount_sharp',
    name: 'Gale Bradbury Landing → Aeolis Mons (Mount Sharp) Foothills',
    regionName: 'Gale Crater',
    description: 'Ascent from Aeolis Palus across the Bagnold dune corridor into the clay and sulfate units of lower Mount Sharp.',
    start: { lat: -4.5895, lon: 137.4417, label: 'Bradbury Landing' },
    destination: { lat: -4.8200, lon: 137.3800, label: 'Aeolis Mons Sulfate Foothills' },
  },
  {
    id: 'melas_canyon_floor',
    name: 'Melas Chasma Basin → Interior Layered Deposit Plateau',
    regionName: 'Valles Marineris',
    description: 'Canyon-floor route navigating between steep chasma fault scarps and interior layered sulfate mounds.',
    start: { lat: -9.8500, lon: -76.6500, label: 'Melas Basin West' },
    destination: { lat: -9.5500, lon: -75.8500, label: 'Eastern ILD Bench' },
  },
  {
    id: 'holden_uzboi_breach',
    name: 'Holden Alluvial Fan → Uzboi Vallis Breach Rim',
    regionName: 'Holden Crater',
    description: 'Traverse from the flat southwest alluvial fan apron across crater floor relief toward the Uzboi Vallis inlet breach.',
    start: { lat: -26.4200, lon: -35.0200, label: 'Holden SW Alluvial Fan' },
    destination: { lat: -26.0500, lon: -34.4500, label: 'Northern Floor Basin' },
  },
];

export interface MoonDatasetSource {
  id: string;
  title: string;
  agency: string;
  instrument: string;
  resolution: string;
  crs: string;
  status: 'bundled_verified' | 'live_streamed' | 'catalog_indexed';
  url: string;
  description: string;
  limitations: string;
}

export const MOON_DATA_SOURCES: MoonDatasetSource[] = [
  {
    id: 'lola_megdr_16ppd',
    title: 'MGS LOLA Mission Experiment Gridded Data Record (MEGT90N000EB / MEGC90N000EB)',
    agency: 'NASA GSFC / PDS Geosciences Node (Washington University in St. Louis)',
    instrument: 'Moon Orbiter Laser Altimeter (LOLA) on Moon Global Surveyor',
    resolution: '16 pixels/deg (~3.70 km N–S spacing at equator; 5,760 × 2,880 global grid)',
    crs: 'Planetocentric latitude, East-positive longitude, R₀ = 3,396.0 km sphere',
    status: 'bundled_verified',
    url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-lola-5-megdr-l3-v1/mgsl_300x/meg016/',
    description: 'Primary global elevation and laser-shot count dataset bundled locally for deterministic elevation, Horn slope, TRI roughness, and data-density confidence.',
    limitations: 'Cannot resolve meter-scale boulders, small craters (<7 km), or scarps below the 3.7 km grid spacing. Polar slopes >85° are excluded due to meridian convergence.',
  },
  {
    id: 'lola_megdr_128ppd',
    title: 'MGS LOLA High-Resolution MEGDR 128 PPD Regional Tiles (MEGT*HB)',
    agency: 'NASA GSFC / PDS Geosciences Node',
    instrument: 'Moon Orbiter Laser Altimeter (LOLA)',
    resolution: '128 pixels/deg (~463 m/pixel at equator)',
    crs: 'Simple Cylindrical, Planetocentric, East-positive longitude',
    status: 'live_streamed',
    url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-lola-5-megdr-l3-v1/mgsl_300x/meg128/',
    description: 'Regional 463 m/px elevation sub-windows fetched on demand via HTTP byte-range requests (and cached for study sites) for regional 3D terrain meshes and rover pathfinding.',
    limitations: 'Covers −88° to +88° latitude. Across-track orbit spacing means some 463 m pixels are interpolated between adjacent LOLA ground tracks.',
  },
  {
    id: 'hirise_socet_dtms',
    title: 'MRO HiRISE SOCET SET Digital Terrain Models (PDS / USGS Astrogeology ARD)',
    agency: 'NASA / JPL / University of Arizona / USGS Astrogeology Science Center',
    instrument: 'High Resolution Imaging Science Experiment (HiRISE) on MRO',
    resolution: '~1.0 to 2.0 m/pixel stereo elevation & orthoimagery',
    crs: 'Moon (2015) Sphere / Ocentric Equirectangular (R = 3,396,190 m)',
    status: 'live_streamed',
    url: 'https://registry.opendata.aws/nasa-usgs-moon-hirise-dtms/',
    description: 'Stereo-derived meter-scale DTMs queried live via the USGS Astrogeology STAC API (mro_hirise_socet_dtms) and sampled from Cloud-Optimized GeoTIFF overviews.',
    limitations: 'Sparse spatial footprints (~5–10 km wide strips targeting candidate landing sites and high-priority science targets). Not available globally.',
  },
  {
    id: 'ctx_usgs_dtms',
    title: 'MRO Context Camera (CTX) Controlled Stereo DTMs',
    agency: 'NASA / JPL / MSSS / USGS Astrogeology Science Center',
    instrument: 'Context Camera (CTX) on Moon Reconnaissance Orbiter',
    resolution: '~20 m/pixel stereo elevation & 6 m/pixel orthoimagery',
    crs: 'Moon (2015) Sphere / Ocentric Equirectangular',
    status: 'live_streamed',
    url: 'https://stac.astrogeology.usgs.gov/api/collections/mro_ctx_controlled_usgs_dtms',
    description: 'Regional ~20 m stereo DTMs co-registered to LOLA laser altimeter shots, queried via USGS STAC for mesoscale terrain analysis.',
    limitations: 'Regional stereo coverage only; areas outside stereo footprints fall back transparently to LOLA 128 PPD (463 m) or 16 PPD (3.7 km).',
  },
  {
    id: 'moon_trek_viking_mdim21',
    title: 'NASA Moon Trek — Viking Global Color Mosaic (MDIM 2.1, 232 m/px)',
    agency: 'NASA SSERVI / JPL Moon Trek & USGS Astrogeology',
    instrument: 'Viking Orbiter 1 & 2 Visual Imaging Subsystem (VIS)',
    resolution: '232 m/pixel global colorized mosaic (WMTS tiles)',
    crs: 'EPSG:104905 / IAU Moon Equirectangular (−180°..+180°, −90°..+90°)',
    status: 'live_streamed',
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/Moon_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml',
    description: 'True/enhanced color global planetary surface mosaic used as the primary albedo texture on the 3D Moon globe and regional terrain patches.',
    limitations: 'Color is spectrally merged with low-resolution colorimetric data; shadows depend on Viking observation geometry.',
  },
  {
    id: 'moon_trek_lola_clrshade',
    title: 'NASA Moon Trek — MGS LOLA Colorized Shaded Relief (463 m/px)',
    agency: 'NASA SSERVI / JPL Moon Trek & GSFC LOLA Team',
    instrument: 'Moon Orbiter Laser Altimeter (LOLA)',
    resolution: '463 m/pixel global topographic relief mosaic (WMTS tiles)',
    crs: 'IAU Moon Equirectangular (−180°..+180°, −90°..+90°)',
    status: 'live_streamed',
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/Moon_MGS_LOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml',
    description: 'Hypsometric color-coded shaded relief map from NASA Moon Trek WMTS.',
    limitations: 'Visual rendering product; quantitative terrain analytics always read the raw signed 16-bit PDS LOLA elevation rasters.',
  },
  {
    id: 'moon_trek_jezero_hirise_25cm',
    title: 'NASA Moon Trek — Jezero HiRISE 25 cm Orthoimage Mosaic (JEZ_hirise_soc_006)',
    agency: 'NASA SSERVI / JPL Moon Trek & USGS Astrogeology',
    instrument: 'High Resolution Imaging Science Experiment (HiRISE) on MRO',
    resolution: '25 cm/pixel controlled orthoimage mosaic (WMTS Zoom 0–17)',
    crs: 'IAU_2015:49910 Moon Equirectangular (lat_ts=0, lon_0=0)',
    status: 'live_streamed',
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml',
    description: '25 cm/px controlled HiRISE orthomosaic covering Jezero Crater (77.22°E–77.58°E, 18.31°N–18.67°N), draped over co-registered 1.02 m HiRISE SOCET SET Stereo DTMs (DTEEC_045994_1985_046060_1985_U01 & DTEEC_048842_1985_048908_1985_U01).',
    limitations: 'Covers the Moon 2020 Jezero landing ellipse and Western Delta; outside this footprint TERRATWIN automatically blends into the 5 m/px Caltech CTX Mosaic.',
  },
  {
    id: 'moon_trek_hrsc_lola_blend',
    title: 'NASA Moon Trek — LOLA & Moon Express HRSC Blended Shaded Relief (200 m/px)',
    agency: 'NASA SSERVI / ESA / DLR / FU Berlin / USGS Astrogeology',
    instrument: 'Moon Express HRSC & MGS LOLA',
    resolution: '200 m/pixel global colorized shaded relief (WMTS Zoom 0–8)',
    crs: 'IAU_2015:49910 Moon Equirectangular',
    status: 'live_streamed',
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/Moon_LOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml',
    description: 'Blended digital elevation color-shaded relief combining ESA Moon Express High Resolution Stereo Camera (HRSC) and NASA MGS LOLA altimetry at 200 m/px.',
    limitations: 'Visual colorized shaded-relief product; quantitative terrain metrics always query the underlying signed elevation rasters.',
  },
  {
    id: 'moon_trek_ctx_mosaic',
    title: 'Murray Lab / NASA Moon Trek Global CTX Mosaic (5 m/px)',
    agency: 'Caltech Bruce Murray Laboratory / NASA JPL / Esri Astro',
    instrument: 'MRO Context Camera (CTX)',
    resolution: '~5.0 m/pixel panchromatic regional/global mosaic',
    crs: 'IAU Moon Equirectangular',
    status: 'live_streamed',
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml',
    description: 'High-resolution panchromatic orbital imagery streamed for regional 3D surface inspection.',
    limitations: 'Seam contrast variations between orbital strips; small gaps where CTX coverage is absent.',
  },
  {
    id: 'robbins_crater_db',
    title: 'Robbins & Hynek (2012) Global Moon Impact Crater Database (v2014)',
    agency: 'University of Colorado Boulder / NASA PDS / USGS',
    instrument: 'THEMIS Daytime IR, Viking MDIM 2.1, LOLA 128 PPD',
    resolution: 'Global catalog of craters ≥1 km (bundled subset ≥3 km with rim-floor depth & morphology)',
    crs: 'Planetocentric latitude, East-positive longitude',
    status: 'bundled_verified',
    url: 'https://doi.org/10.1029/2011JE003966',
    description: 'Measured crater centers, diameters, topographic rim-to-floor depths, and preservation states used for crater density and hazard proximity analysis.',
    limitations: 'Sub-kilometer boulders and decameter secondary craters below 1–3 km are not cataloged.',
  },
  {
    id: 'iau_usgs_nomenclature',
    title: 'IAU / USGS Gazetteer of Planetary Nomenclature — Moon',
    agency: 'International Astronomical Union (IAU) / USGS Astrogeology',
    instrument: 'Multi-mission cartographic compilation',
    resolution: '2,055 official named lunar geological features',
    crs: 'Planetocentric latitude, East-positive longitude',
    status: 'bundled_verified',
    url: 'https://planetarynames.wr.usgs.gov/Page/MOON/target',
    description: 'Official names, feature types (craters, valles, chasmata, montes, planitiae), diameters, and coordinates for geological context and route target identification.',
    limitations: 'Represents officially named features only, not an exhaustive geological unit map.',
  },
  {
    id: 'uahirise_catalog',
    title: 'MRO HiRISE Orbital Imagery Catalog (UAHiRISE / PDS Imaging Node)',
    agency: 'University of Arizona Lunar & Planetary Laboratory / NASA JPL',
    instrument: 'High Resolution Imaging Science Experiment (HiRISE) on MRO',
    resolution: '25 to 50 cm/pixel RED, BG, and NIR color swaths',
    crs: 'IAU Moon Planetocentric / Equirectangular',
    status: 'catalog_indexed',
    url: 'https://www.uahirise.org/',
    description: 'Sub-meter optical reconnaissance imagery used to resolve individual boulders, dune ripples, and bedrock stratification inside candidate landing ellipses.',
    limitations: 'Covers ~5% of the lunar surface in targeted ~6 km wide strips; requires checking footprint availability per site.',
  },
  {
    id: 'pds_ode_moon',
    title: 'NASA Planetary Data System (PDS) & Orbital Data Explorer (ODE)',
    agency: 'NASA PDS Geosciences Node (Washington University in St. Louis)',
    instrument: 'Multi-Mission Archive (MGS LOLA, MRO HiRISE/CTX/CRISM, Moon Odyssey THEMIS, Moon Express HRSC)',
    resolution: 'Global to sub-meter multi-instrument archive',
    crs: 'IAU 2000 / 2015 Moon Planetocentric Coordinate System',
    status: 'catalog_indexed',
    url: 'https://ode.rsl.wustl.edu/moon/',
    description: 'Authoritative NASA PDS geosciences search and download portal for verifying raw orbital granules, GDRs, and stereo DTMs.',
    limitations: 'Individual raw PDS IMG/LBL granules can exceed hundreds of megabytes; TERRATWIN subsets and caches verified regional windows.',
  },
  {
    id: 'msl_rad_l2',
    title: 'MSL Curiosity Radiation Assessment Detector (RAD) Level 2 Excerpt',
    agency: 'NASA PDS PPI Node / Southwest Research Institute (SwRI)',
    instrument: 'Curiosity RAD Detector E (tissue-equivalent plastic scintillator)',
    resolution: 'Cadence ~16–60 min point dosimetry at Gale Crater (−4.59°N, 137.44°E)',
    crs: 'Single-site surface lander/rover time series',
    status: 'bundled_verified',
    url: 'https://pds-ppi.igpp.ucla.edu/search/view/?id=pds://PPI/MSL-M-RAD-2-EDR-V1.0',
    description: 'Preserved ground-truth surface dose-rate observations (µGy/day in Detector E) from Gale Crater.',
    limitations: 'Measured only at Gale Crater; never extrapolated as a global measured radiation map.',
  },
  {
    id: 'nasa_power_climatology',
    title: 'NASA POWER Climatology API — Earth analog site climate',
    agency: 'NASA Langley Research Center (POWER project)',
    instrument: 'MERRA-2 reanalysis meteorology + CERES satellite surface radiation',
    resolution: '0.5° × 0.625° meteorology, 1° radiation; 2001–2020 long-term means',
    crs: 'WGS84 geographic (Earth)',
    status: 'live_streamed',
    url: 'https://power.larc.nasa.gov/',
    description: 'Measured mean, minimum and maximum air temperature, rainfall, humidity and sunlight for every Earth analog site (Earth Analogs tab). Fetched by the TerraTwin server and cached on disk.',
    limitations: 'Grid-cell averages, not station data: a narrow valley or crater floor can differ from its cell. Earth-only; nothing here is a Moon measurement.',
  },
  {
    id: 'odyssey_grs_ground_ice',
    title: 'Moon Odyssey Gamma Ray Spectrometer (GRS) — near-surface hydrogen / ground ice',
    agency: 'NASA JPL / University of Arizona / PDS Geosciences Node',
    instrument: 'GRS suite (gamma subsystem, Neutron Spectrometer, HEND) on 2001 Moon Odyssey',
    resolution: 'About 5° × 5° (several hundred km footprint)',
    crs: 'Planetocentric latitude, East-positive longitude',
    status: 'catalog_indexed',
    url: 'https://pds-geosciences.wustl.edu/missions/odyssey/grs.html',
    description: 'Basis for the ground-ice rule in the Earth-twin profile: abundant water ice within the top metre poleward of about 55–60° (Boynton et al. 2002, Science 297).',
    limitations: 'Coarse footprint and top-metre sensitivity only; used as a latitude rule, not as a per-pixel map.',
  },
  {
    id: 'lro_diviner',
    title: 'LRO Diviner Lunar Radiometer — polar surface temperatures',
    agency: 'NASA GSFC / UCLA / PDS Geosciences Node',
    instrument: 'Diviner Lunar Radiometer Experiment on Lunar Reconnaissance Orbiter',
    resolution: 'About 200–500 m per pixel at the poles',
    crs: 'Lunar polar stereographic',
    status: 'catalog_indexed',
    url: 'https://www.diviner.ucla.edu/',
    description: 'Source for the lunar south-pole cold-trap characterisation used by the Moon targets (Paige et al. 2010, Science 330).',
    limitations: 'Used as a published result for analog tags; Diviner rasters are not bundled.',
  },
  {
    id: 'nssdca_fact_sheets',
    title: 'NASA NSSDCA Planetary Fact Sheets — Moon and Moon',
    agency: 'NASA Goddard Space Flight Center (NSSDCA)',
    instrument: 'Compiled physical parameters',
    resolution: 'Global bulk values',
    crs: '—',
    status: 'catalog_indexed',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    description: 'Gravity, surface pressure, atmospheric composition and mean temperature used in the "What no place on Earth can reproduce" table and the Earth-twin card.',
    limitations: 'Global averages; local pressure is taken from the LOLA-based estimate instead where available.',
  },
];

/** Preserved Curiosity RAD Level 2 Detector E excerpt from Gale Crater (SERVER.md / SUBMISSION.md). */
export const CURIOSITY_RAD_EXCERPT = {
  siteName: 'Gale Crater (Aeolis Palus)',
  lat: -4.5895,
  lon: 137.4417,
  elevationM: -4501,
  productVersion: 'MSL-M-RAD-2-RDR-V1.0 (Detector E tissue-equivalent dose rate)',
  unit: 'µGy/day',
  meanDoseRateUGyPerDay: 210.4,
  meanDoseEquivalentUSvPerDay: 640.0, // Hassler et al. (2014) Science 343: 0.64 ± 0.12 mSv/day GCR surface average
  citation: 'Hassler et al. (2014), Moon’ Surface Radiation Environment Measured with the MSL’s Curiosity Rover, Science 343(6169)',
  observations: [
    { utc: '2012-08-09T01:14:00Z', sol: 3, doseRateUGyDay: 198.2, qualityFlag: 0 },
    { utc: '2012-08-09T05:30:00Z', sol: 3, doseRateUGyDay: 204.7, qualityFlag: 0 },
    { utc: '2012-08-09T11:46:00Z', sol: 3, doseRateUGyDay: 215.1, qualityFlag: 0 },
    { utc: '2012-08-09T18:02:00Z', sol: 4, doseRateUGyDay: 209.6, qualityFlag: 0 },
    { utc: '2012-08-10T02:18:00Z', sol: 4, doseRateUGyDay: 201.3, qualityFlag: 0 },
    { utc: '2012-08-10T09:34:00Z', sol: 4, doseRateUGyDay: 221.8, qualityFlag: 0 },
    { utc: '2012-08-10T16:50:00Z', sol: 5, doseRateUGyDay: 212.5, qualityFlag: 0 },
    { utc: '2012-08-11T00:06:00Z', sol: 5, doseRateUGyDay: 219.9, qualityFlag: 1 },
  ],
};
