/**
 * Earth Analog Finder — which places on Earth resemble a Moon or Moon target, in which ways,
 * by how much, and what Earth can never reproduce.
 *
 * Method (transparent and reproducible):
 *  - Every site is described by four kinds of evidence:
 *      morphology tags, mineralogy tags, habitability-context tags (categorical, from the cited literature),
 *      and four environmental levels on a 0–1 ordinal scale (aridity, cold, ground ice, UV/oxidising surface).
 *  - Categorical similarity = Jaccard index |A ∩ B| / |A ∪ B| of the two tag sets.
 *  - Environmental similarity = 1 − |a − b| per level, averaged.
 *  - Overall = weighted mean of Geology (morphology + mineralogy), Environment and Habitability,
 *    with weights the user sets. A dimension with no tags on either side is left out, not counted as a match.
 *
 * Honesty: tags come from the published descriptions cited for each site; the 0–1 environmental levels are
 * ordinal judgements (an ASSUMPTION, labelled as such in the UI), not measurements. The similarity score is
 * a screening aid, not a validated physical equivalence.
 */
import { CURIOSITY_RAD_EXCERPT, EARTH_BODY_STUB, MOON_BODY } from './constants';

export type Body = 'moon' | 'moon';

export type MorphTag =
  | 'impact_crater'
  | 'delta_fan'
  | 'layered_sediments'
  | 'lava_flows'
  | 'lava_tubes'
  | 'patterned_ground'
  | 'dunes'
  | 'channels'
  | 'mud_volcano_mounds'
  | 'glacial_landforms';

export type MineralTag =
  | 'phyllosilicates'
  | 'carbonates'
  | 'sulfates'
  | 'jarosite'
  | 'iron_oxides'
  | 'perchlorates_salts'
  | 'basalt'
  | 'anorthosite'
  | 'impact_breccia'
  | 'opaline_silica'
  | 'fine_regolith';

export type HabTag =
  | 'ancient_lake'
  | 'hydrothermal'
  | 'microbial_mats'
  | 'brines'
  | 'acidic_water'
  | 'extremophiles'
  | 'water_ice'
  | 'methane_seeps';

export interface EnvLevels {
  /** 0 = humid, 1 = hyperarid */
  aridity: number;
  /** 0 = warm, 1 = extremely cold */
  cold: number;
  /** 0 = none, 1 = abundant near-surface ice / permafrost */
  groundIce: number;
  /** 0 = shielded, 1 = intense UV and oxidising surface chemistry */
  uvOxidising: number;
}

export interface SiteProfile {
  morphology: MorphTag[];
  mineralogy: MineralTag[];
  habitability: HabTag[];
  env: EnvLevels;
}

export interface TargetSite extends SiteProfile {
  id: string;
  body: Body;
  name: string;
  lat: number;
  /** East-positive longitude, −180..180 */
  lon: number;
  mission?: string;
  summary: string;
  /** 'established' = mission or orbital results; 'hypothesis' = proposed interpretation still debated */
  status: 'established' | 'hypothesis';
  refs: string[];
}

export interface EarthAnalog extends SiteProfile {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  summary: string;
  /** What this site has actually been used for (field tests, training, sample studies). */
  usedFor: string;
  status: 'established' | 'hypothesis';
  refs: string[];
}

export const LABELS: Record<MorphTag | MineralTag | HabTag, string> = {
  impact_crater: 'Impact crater',
  delta_fan: 'Delta / alluvial fan',
  layered_sediments: 'Layered sediments',
  lava_flows: 'Lava flows',
  lava_tubes: 'Lava tubes',
  patterned_ground: 'Polygonal patterned ground',
  dunes: 'Dunes / aeolian bedforms',
  channels: 'Channels / gullies',
  mud_volcano_mounds: 'Mud-volcano-like mounds',
  glacial_landforms: 'Glacial landforms',
  phyllosilicates: 'Clays (phyllosilicates)',
  carbonates: 'Carbonates',
  sulfates: 'Sulfates',
  jarosite: 'Jarosite',
  iron_oxides: 'Hematite / iron oxides',
  perchlorates_salts: 'Salts (incl. perchlorates)',
  basalt: 'Basalt',
  anorthosite: 'Anorthosite',
  impact_breccia: 'Impact breccia / melt',
  opaline_silica: 'Opaline silica',
  fine_regolith: 'Fine regolith / dust',
  ancient_lake: 'Former lake',
  hydrothermal: 'Hydrothermal system',
  microbial_mats: 'Microbial mats / stromatolites',
  brines: 'Brines',
  acidic_water: 'Acidic, iron-rich water',
  extremophiles: 'Extremophile communities',
  water_ice: 'Water ice',
  methane_seeps: 'Methane seepage',
};

export const ENV_LABELS: Record<keyof EnvLevels, string> = {
  aridity: 'Aridity',
  cold: 'Cold',
  groundIce: 'Ground ice',
  uvOxidising: 'UV / oxidising surface',
};

/* --------------------------------------------------------------------------------- targets */

export const TARGETS: TargetSite[] = [
  {
    id: 'jezero',
    body: 'moon',
    name: 'Jezero Crater delta',
    lat: 18.44,
    lon: 77.45,
    mission: 'Moon 2020 Perseverance',
    summary: 'Ancient crater lake with a river delta; clays and carbonates that could preserve biosignatures.',
    status: 'established',
    refs: ['Goudge et al. (2015) JGR Planets', 'Horgan et al. (2020) Icarus', 'Farley et al. (2022) Science'],
    morphology: ['impact_crater', 'delta_fan', 'layered_sediments', 'channels'],
    mineralogy: ['phyllosilicates', 'carbonates', 'basalt'],
    habitability: ['ancient_lake'],
    env: { aridity: 0.95, cold: 0.9, groundIce: 0.1, uvOxidising: 0.95 },
  },
  {
    id: 'gale',
    body: 'moon',
    name: 'Gale Crater / Aeolis Mons',
    lat: -4.59,
    lon: 137.44,
    mission: 'MSL Curiosity',
    summary: 'Crater lake deposits and a 5 km layered mound recording the shift from wet to dry; clays, sulfates, iron oxides.',
    status: 'established',
    refs: ['Grotzinger et al. (2014) Science', 'Rampe et al. (2020) Geochemistry'],
    morphology: ['impact_crater', 'layered_sediments', 'dunes', 'channels'],
    mineralogy: ['phyllosilicates', 'sulfates', 'iron_oxides', 'basalt', 'opaline_silica'],
    habitability: ['ancient_lake'],
    env: { aridity: 0.95, cold: 0.85, groundIce: 0.05, uvOxidising: 0.95 },
  },
  {
    id: 'meridiani',
    body: 'moon',
    name: 'Meridiani Planum',
    lat: -1.95,
    lon: -5.53,
    mission: 'MER Opportunity',
    summary: 'Sulfate-rich sandstones with jarosite and hematite concretions ("blueberries") left by acidic groundwater.',
    status: 'established',
    refs: ['Squyres et al. (2004) Science', 'Klingelhöfer et al. (2004) Science'],
    morphology: ['impact_crater', 'layered_sediments', 'dunes'],
    mineralogy: ['sulfates', 'jarosite', 'iron_oxides', 'basalt'],
    habitability: ['acidic_water'],
    env: { aridity: 0.95, cold: 0.85, groundIce: 0.05, uvOxidising: 0.95 },
  },
  {
    id: 'phoenix',
    body: 'moon',
    name: 'Vastitas Borealis (Phoenix site)',
    lat: 68.22,
    lon: -125.75,
    mission: 'Phoenix Moon Lander',
    summary: 'High-latitude polygonal ground with shallow water ice and perchlorate salts in the soil.',
    status: 'established',
    refs: ['Smith et al. (2009) Science', 'Hecht et al. (2009) Science', 'Boynton et al. (2009) Science'],
    morphology: ['patterned_ground'],
    mineralogy: ['perchlorates_salts', 'fine_regolith', 'basalt', 'carbonates'],
    habitability: ['water_ice', 'brines'],
    env: { aridity: 0.9, cold: 1, groundIce: 1, uvOxidising: 0.9 },
  },
  {
    id: 'acidalia_mounds',
    body: 'moon',
    name: 'Acidalia Planitia mound fields',
    lat: 40,
    lon: -25,
    summary: 'Thousands of small mounds interpreted by some studies as mud volcanoes; the origin is still debated.',
    status: 'hypothesis',
    refs: ['Oehler & Allen (2010) Icarus', 'Komatsu et al. (2016) Icarus'],
    morphology: ['mud_volcano_mounds', 'layered_sediments'],
    mineralogy: ['phyllosilicates', 'iron_oxides'],
    habitability: ['methane_seeps'],
    env: { aridity: 0.95, cold: 0.9, groundIce: 0.5, uvOxidising: 0.95 },
  },
  {
    id: 'tranquillitatis',
    body: 'moon',
    name: 'Mare Tranquillitatis',
    lat: 0.67,
    lon: 23.47,
    mission: 'Apollo 11',
    summary: 'Basaltic lava plain covered by fine regolith and impact debris.',
    status: 'established',
    refs: ['Apollo 11 Preliminary Science Report (NASA SP-214, 1969)'],
    morphology: ['impact_crater', 'lava_flows'],
    mineralogy: ['basalt', 'fine_regolith', 'impact_breccia'],
    habitability: [],
    env: { aridity: 1, cold: 0.6, groundIce: 0, uvOxidising: 1 },
  },
  {
    id: 'descartes',
    body: 'moon',
    name: 'Descartes Highlands',
    lat: -8.97,
    lon: 15.5,
    mission: 'Apollo 16',
    summary: 'Anorthositic highland crust, heavily cratered and brecciated.',
    status: 'established',
    refs: ['Apollo 16 Preliminary Science Report (NASA SP-315, 1972)'],
    morphology: ['impact_crater'],
    mineralogy: ['anorthosite', 'impact_breccia', 'fine_regolith'],
    habitability: [],
    env: { aridity: 1, cold: 0.6, groundIce: 0, uvOxidising: 1 },
  },
  {
    id: 'south_pole',
    body: 'moon',
    name: 'Lunar south pole (shadowed craters)',
    lat: -89.9,
    lon: 0,
    mission: 'Artemis target region',
    summary: 'Permanently shadowed crater floors where water ice was detected (LCROSS impact); among the coldest places measured in the Solar System.',
    status: 'established',
    refs: ['Colaprete et al. (2010) Science', 'Paige et al. (2010) Science'],
    morphology: ['impact_crater'],
    mineralogy: ['fine_regolith', 'anorthosite', 'impact_breccia'],
    habitability: ['water_ice'],
    env: { aridity: 1, cold: 1, groundIce: 0.8, uvOxidising: 0.2 },
  },
];

/* ---------------------------------------------------------------------------- Earth analogs */

export const EARTH_ANALOGS: EarthAnalog[] = [
  {
    id: 'atacama',
    name: 'Atacama Desert (Yungay)',
    country: 'Chile',
    lat: -24.1,
    lon: -70.0,
    summary: 'One of the driest places on Earth; oxidising, salt- and perchlorate-bearing soils with very sparse life.',
    usedFor: 'Life-detection and rover drilling tests (e.g. NASA ARADS).',
    status: 'established',
    refs: ['Navarro-González et al. (2003) Science', 'Azua-Bustos et al. (2012) Astrobiology'],
    morphology: ['channels', 'dunes'],
    mineralogy: ['perchlorates_salts', 'sulfates', 'fine_regolith'],
    habitability: ['extremophiles'],
    env: { aridity: 1, cold: 0.2, groundIce: 0, uvOxidising: 0.9 },
  },
  {
    id: 'dry_valleys',
    name: 'McMurdo Dry Valleys',
    country: 'Antarctica',
    lat: -77.5,
    lon: 162.0,
    summary: 'Cold polar desert with ice-cemented permafrost, polygonal ground and hypersaline brines (Don Juan Pond).',
    usedFor: 'Cold-desert and permafrost studies for Phoenix and future ice missions.',
    status: 'established',
    refs: ['Doran et al. (2010) Antarctic Science', 'Marchant & Head (2007) Icarus'],
    morphology: ['patterned_ground', 'glacial_landforms', 'channels'],
    mineralogy: ['perchlorates_salts', 'basalt', 'fine_regolith'],
    habitability: ['extremophiles', 'brines', 'water_ice'],
    env: { aridity: 0.9, cold: 0.95, groundIce: 0.9, uvOxidising: 0.5 },
  },
  {
    id: 'rio_tinto',
    name: 'Río Tinto',
    country: 'Spain',
    lat: 37.72,
    lon: -6.56,
    summary: 'Acidic, iron-rich river depositing jarosite and hematite — chemistry like the Meridiani sandstones.',
    usedFor: 'Acidic-environment biosignature studies and drilling tests (MARTE project).',
    status: 'established',
    refs: ['Fernández-Relolar et al. (2005) EPSL', 'Stoker et al. (2008) Astrobiology'],
    morphology: ['channels', 'layered_sediments'],
    mineralogy: ['sulfates', 'jarosite', 'iron_oxides'],
    habitability: ['acidic_water', 'extremophiles'],
    env: { aridity: 0.35, cold: 0.1, groundIce: 0, uvOxidising: 0.4 },
  },
  {
    id: 'iceland',
    name: 'Icelandic basalt highlands',
    country: 'Iceland',
    lat: 64.85,
    lon: -16.83,
    summary: 'Young basaltic lava fields, sandy basaltic plains, glaciers and hydrothermal areas.',
    usedFor: 'Rover and instrument field tests; basalt weathering studies.',
    status: 'established',
    refs: ['Ehlmann et al. (2012) JGR Planets', 'Cousins & Crawford (2011) Astrobiology'],
    morphology: ['lava_flows', 'lava_tubes', 'glacial_landforms', 'channels'],
    mineralogy: ['basalt', 'phyllosilicates', 'fine_regolith'],
    habitability: ['hydrothermal'],
    env: { aridity: 0.4, cold: 0.7, groundIce: 0.5, uvOxidising: 0.3 },
  },
  {
    id: 'haughton',
    name: 'Haughton Crater, Devon Island',
    country: 'Canada',
    lat: 75.38,
    lon: -89.67,
    summary: 'Arctic impact crater in carbonate and gypsum rocks, with traces of an impact-driven hydrothermal system.',
    usedFor: 'Haughton-Moon Project: rovers, spacesuits and exploration operations.',
    status: 'established',
    refs: ['Osinski et al. (2005) Meteoritics & Planetary Science', 'Lee & Osinski (2005)'],
    morphology: ['impact_crater', 'patterned_ground', 'channels'],
    mineralogy: ['impact_breccia', 'carbonates', 'sulfates'],
    habitability: ['hydrothermal', 'extremophiles'],
    env: { aridity: 0.7, cold: 0.9, groundIce: 0.8, uvOxidising: 0.4 },
  },
  {
    id: 'hanksville',
    name: 'Hanksville / MDRS, Utah',
    country: 'USA',
    lat: 38.41,
    lon: -110.79,
    summary: 'Red layered sandstones and clays; nearby hematite concretions resemble the Meridiani "blueberries".',
    usedFor: 'Moon Desert Research Station crew simulations.',
    status: 'established',
    refs: ['Chan et al. (2004) Nature', 'Clarke & Stoker (2011) Int. J. Astrobiology'],
    morphology: ['layered_sediments', 'channels'],
    mineralogy: ['phyllosilicates', 'sulfates', 'iron_oxides'],
    habitability: [],
    env: { aridity: 0.7, cold: 0.3, groundIce: 0, uvOxidising: 0.5 },
  },
  {
    id: 'pilbara',
    name: 'Pilbara, Dresser Formation',
    country: 'Australia',
    lat: -21.17,
    lon: 119.42,
    summary: 'About 3.5-billion-year-old stromatolites and hot-spring deposits — some of the oldest traces of life.',
    usedFor: 'Training for biosignature search, including Moon 2020 science team field work.',
    status: 'established',
    refs: ['Djokic et al. (2017) Nature Communications', 'Van Kranendonk et al. (2008)'],
    morphology: ['layered_sediments'],
    mineralogy: ['opaline_silica', 'basalt', 'sulfates', 'carbonates'],
    habitability: ['microbial_mats', 'hydrothermal'],
    env: { aridity: 0.7, cold: 0.1, groundIce: 0, uvOxidising: 0.6 },
  },
  {
    id: 'svalbard',
    name: 'Bockfjord volcanic area, Svalbard',
    country: 'Norway',
    lat: 79.43,
    lon: 13.33,
    summary: 'Arctic volcanoes with carbonate globules like those in Moon meteorite ALH84001; permafrost and glaciers.',
    usedFor: 'AMASE expeditions testing Moon instruments.',
    status: 'established',
    refs: ['Treiman et al. (2002) EPSL', 'Steele et al. (2007) Meteoritics & Planetary Science'],
    morphology: ['lava_flows', 'glacial_landforms', 'patterned_ground'],
    mineralogy: ['carbonates', 'basalt'],
    habitability: ['hydrothermal', 'water_ice'],
    env: { aridity: 0.5, cold: 0.9, groundIce: 0.8, uvOxidising: 0.4 },
  },
  {
    id: 'meteor_crater',
    name: 'Meteor (Barringer) Crater',
    country: 'USA',
    lat: 35.03,
    lon: -111.02,
    summary: 'Well-preserved simple impact crater in a dry desert, with ejecta and shocked rock.',
    usedFor: 'Apollo astronaut geology training.',
    status: 'established',
    refs: ['Shoemaker (1960)', 'Kring (2007) Guidebook to the Geology of Barringer Meteorite Crater'],
    morphology: ['impact_crater'],
    mineralogy: ['impact_breccia', 'fine_regolith', 'sulfates', 'carbonates'],
    habitability: [],
    env: { aridity: 0.75, cold: 0.3, groundIce: 0, uvOxidising: 0.6 },
  },
  {
    id: 'ries',
    name: 'Nördlinger Ries',
    country: 'Germany',
    lat: 48.88,
    lon: 10.57,
    summary: '24 km impact crater that held a lake after impact — an Earth example of a crater lake like Jezero or Gale.',
    usedFor: 'Apollo 14 crew geology training (1970).',
    status: 'established',
    refs: ['Pohl et al. (1977)', 'Arp et al. (2013) GSA Bulletin'],
    morphology: ['impact_crater', 'layered_sediments'],
    mineralogy: ['impact_breccia', 'carbonates', 'phyllosilicates'],
    habitability: ['ancient_lake', 'hydrothermal'],
    env: { aridity: 0.2, cold: 0.3, groundIce: 0, uvOxidising: 0.3 },
  },
  {
    id: 'hawaii',
    name: 'Hawaiian basalt fields (Mauna Kea / Kīlauea)',
    country: 'USA',
    lat: 19.82,
    lon: -155.47,
    summary: 'Basaltic lava flows, lava tubes and weathered volcanic ash used to make Moon regolith simulant.',
    usedFor: 'JSC Moon-1 simulant source and lunar/Moon field tests (PISCES).',
    status: 'established',
    refs: ['Allen et al. (1998) EOS', 'Morris et al. (2001) JGR'],
    morphology: ['lava_flows', 'lava_tubes'],
    mineralogy: ['basalt', 'fine_regolith', 'iron_oxides'],
    habitability: [],
    env: { aridity: 0.5, cold: 0.4, groundIce: 0, uvOxidising: 0.6 },
  },
  {
    id: 'lonar',
    name: 'Lonar Crater',
    country: 'India',
    lat: 19.98,
    lon: 76.51,
    summary: 'Young impact crater in Deccan basalt with a saline-alkaline lake — impact into basalt, as on the Moon and Moon.',
    usedFor: 'Studies of impact shock in basalt and crater-lake microbiology.',
    status: 'established',
    refs: ['Fredriksson et al. (1973) Science', 'Maloof et al. (2010) GSA Bulletin'],
    morphology: ['impact_crater'],
    mineralogy: ['basalt', 'impact_breccia', 'perchlorates_salts'],
    habitability: ['ancient_lake', 'extremophiles'],
    env: { aridity: 0.5, cold: 0.1, groundIce: 0, uvOxidising: 0.5 },
  },
  {
    id: 'gobustan',
    name: 'Gobustan mud volcanoes (Dashgil)',
    country: 'Azerbaijan',
    lat: 40.03,
    lon: 49.38,
    summary:
      'One of the densest mud-volcano fields on Earth: mounds of clay-rich mud with methane seepage. A candidate analog if the Acidalia mounds are mud volcanoes.',
    usedFor: 'Mud volcanism and methane seepage research; proposed here as a Moon mound analog.',
    status: 'hypothesis',
    refs: ['Mazzini & Etiope (2017) Earth-Science Reviews', 'Oehler & Allen (2010) Icarus'],
    morphology: ['mud_volcano_mounds'],
    mineralogy: ['phyllosilicates', 'carbonates', 'perchlorates_salts'],
    habitability: ['methane_seeps', 'extremophiles'],
    env: { aridity: 0.6, cold: 0.25, groundIce: 0, uvOxidising: 0.5 },
  },
  {
    id: 'stillwater',
    name: 'Stillwater Complex, Montana',
    country: 'USA',
    lat: 45.4,
    lon: -109.9,
    summary: 'Layered intrusion with anorthosite and norite — rock types of the lunar highlands.',
    usedFor: 'Source rock for the NU-LHT lunar highlands regolith simulant.',
    status: 'established',
    refs: ['Stoeser et al. (2010) NASA TM-2010-216438'],
    morphology: [],
    mineralogy: ['anorthosite'],
    habitability: [],
    env: { aridity: 0.4, cold: 0.5, groundIce: 0, uvOxidising: 0.4 },
  },
  {
    id: 'death_valley',
    name: 'Death Valley alluvial fans',
    country: 'USA',
    lat: 36.23,
    lon: -116.77,
    summary: 'Large alluvial fans spreading onto a salt playa, with dunes nearby — Earth fans like the fan and delta deposits in lunar craters.',
    usedFor: 'Comparisons of fan shape and sediment for lunar fans and deltas.',
    status: 'established',
    refs: ['Blair & McPherson (1994) J. Sedimentary Research', 'Moore & Howard (2005) JGR Planets'],
    morphology: ['delta_fan', 'channels', 'dunes', 'layered_sediments'],
    mineralogy: ['perchlorates_salts', 'sulfates', 'fine_regolith'],
    habitability: ['extremophiles'],
    env: { aridity: 0.95, cold: 0.1, groundIce: 0, uvOxidising: 0.7 },
  },
  {
    id: 'qaidam',
    name: 'Qaidam Basin (Dalangtan playa)',
    country: 'China',
    lat: 38.5,
    lon: 91.5,
    summary: 'High, cold, hyperarid basin with salt playas, wind-carved yardangs and sulfate-rich layered deposits.',
    usedFor: 'Moon analog field studies of salts, sulfates and wind erosion.',
    status: 'established',
    refs: ['Xiao et al. (2017) Earth-Science Reviews', 'Kong et al. (2018) Astrobiology'],
    morphology: ['dunes', 'layered_sediments', 'channels'],
    mineralogy: ['sulfates', 'perchlorates_salts', 'phyllosilicates', 'fine_regolith'],
    habitability: ['extremophiles', 'brines'],
    env: { aridity: 0.95, cold: 0.6, groundIce: 0.1, uvOxidising: 0.75 },
  },
  {
    id: 'dallol',
    name: 'Dallol hydrothermal field',
    country: 'Ethiopia',
    lat: 14.24,
    lon: 40.3,
    summary: 'Hyperacid, hypersaline hot springs depositing salts, sulfates and iron oxides — tests the limits of where life can exist.',
    usedFor: 'Studies of habitability limits and mineral biosignature false positives.',
    status: 'established',
    refs: ['Belilla et al. (2019) Nature Ecology & Evolution', 'Kotopoulou et al. (2019) ACS Earth & Space Chemistry'],
    morphology: ['layered_sediments'],
    mineralogy: ['sulfates', 'iron_oxides', 'perchlorates_salts', 'jarosite'],
    habitability: ['hydrothermal', 'acidic_water', 'brines'],
    env: { aridity: 0.85, cold: 0, groundIce: 0, uvOxidising: 0.7 },
  },
  {
    id: 'axel_heiberg',
    name: 'Axel Heiberg Island cold springs',
    country: 'Canada',
    lat: 79.4,
    lon: -90.8,
    summary: 'Perennial salty springs flowing through thick permafrost at −20 °C air temperatures, with gypsum deposits and microbes.',
    usedFor: 'Model for briny groundwater and life in lunar permafrost.',
    status: 'established',
    refs: ['Andersen et al. (2002) JGR Planets', 'Niederberger et al. (2010) ISME Journal'],
    morphology: ['patterned_ground', 'glacial_landforms'],
    mineralogy: ['sulfates', 'perchlorates_salts', 'carbonates'],
    habitability: ['brines', 'extremophiles', 'water_ice'],
    env: { aridity: 0.75, cold: 0.95, groundIce: 0.95, uvOxidising: 0.4 },
  },
  {
    id: 'shark_bay',
    name: 'Shark Bay (Hamelin Pool)',
    country: 'Australia',
    lat: -26.4,
    lon: 114.17,
    summary: 'Living stromatolites in a hypersaline bay — the modern counterpart of the oldest fossil life searched for in lunar lake sediments.',
    usedFor: 'Reference for microbial textures that rovers look for in layered carbonates.',
    status: 'established',
    refs: ['Logan (1961) Journal of Geology', 'Suosaari et al. (2016) Scientific Reports'],
    morphology: ['layered_sediments'],
    mineralogy: ['carbonates', 'perchlorates_salts'],
    habitability: ['microbial_mats', 'brines', 'extremophiles'],
    env: { aridity: 0.6, cold: 0.05, groundIce: 0, uvOxidising: 0.6 },
  },
  {
    id: 'mojave',
    name: 'Mojave Desert basalts',
    country: 'USA',
    lat: 35.0,
    lon: -116.0,
    summary: 'Desert basalt flows, cinder cones and dunes; source rock of the Mojave Moon Simulant.',
    usedFor: 'Mojave Moon Simulant (MMS) for rover wheel and drill testing.',
    status: 'established',
    refs: ['Peters et al. (2008) Icarus'],
    morphology: ['lava_flows', 'dunes', 'channels'],
    mineralogy: ['basalt', 'fine_regolith', 'iron_oxides'],
    habitability: [],
    env: { aridity: 0.85, cold: 0.15, groundIce: 0, uvOxidising: 0.65 },
  },
  {
    id: 'lanzarote',
    name: 'Lanzarote lava fields',
    country: 'Spain',
    lat: 29.17,
    lon: -13.45,
    summary: 'Young basaltic lava fields and one of the longest lava tubes on Earth (La Corona) — candidate shelter type on the Moon and Moon.',
    usedFor: 'ESA PANGAEA astronaut geology training; lava-tube exploration tests.',
    status: 'established',
    refs: ['Sauro et al. (2020) Earth-Science Reviews'],
    morphology: ['lava_flows', 'lava_tubes'],
    mineralogy: ['basalt', 'fine_regolith'],
    habitability: [],
    env: { aridity: 0.75, cold: 0.05, groundIce: 0, uvOxidising: 0.6 },
  },
  {
    id: 'black_point',
    name: 'Black Point Lava Flow, Arizona',
    country: 'USA',
    lat: 35.68,
    lon: -111.45,
    summary: 'Basalt flow with loose cinder cover in a dry desert, used to rehearse lunar surface operations.',
    usedFor: 'NASA Desert RATS rover and spacesuit field tests.',
    status: 'established',
    refs: ['Ross et al. (2013) Acta Astronautica'],
    morphology: ['lava_flows'],
    mineralogy: ['basalt', 'fine_regolith'],
    habitability: [],
    env: { aridity: 0.8, cold: 0.3, groundIce: 0, uvOxidising: 0.65 },
  },
  {
    id: 'mistastin',
    name: 'Mistastin Lake crater',
    country: 'Canada',
    lat: 55.88,
    lon: -63.31,
    summary: 'Impact crater with anorthosite impact melt — the closest Earth match to lunar highland breccias.',
    usedFor: 'Lunar highlands impact studies and astronaut geology training.',
    status: 'established',
    refs: ['Marion & Sylvester (2010) Planetary and Space Science', 'Mader & Osinski (2018) Geochimica et Cosmochimica Acta'],
    morphology: ['impact_crater', 'glacial_landforms'],
    mineralogy: ['anorthosite', 'impact_breccia'],
    habitability: [],
    env: { aridity: 0.3, cold: 0.7, groundIce: 0.4, uvOxidising: 0.3 },
  },
];

/* ---------------------------------------------------------------------------- scoring */

export interface Weights {
  geology: number;
  environment: number;
  habitability: number;
}

export const DEFAULT_WEIGHTS: Weights = { geology: 0.5, environment: 0.3, habitability: 0.2 };

export interface DimensionResult {
  key: 'morphology' | 'mineralogy' | 'environment' | 'habitability';
  label: string;
  /** 0..1, or null when neither side has anything to compare */
  score: number | null;
  shared: string[];
  onlyTarget: string[];
  onlyEarth: string[];
}

export interface AnalogMatch {
  analog: EarthAnalog;
  overall: number;
  dims: DimensionResult[];
  env: { key: keyof EnvLevels; label: string; target: number; earth: number; similarity: number }[];
  strongest: string;
  weakest: string;
}

function jaccard<T extends string>(a: T[], b: T[]): { score: number | null; shared: T[]; onlyA: T[]; onlyB: T[] } {
  const A = new Set(a);
  const B = new Set(b);
  const shared = [...A].filter((x) => B.has(x));
  const onlyA = [...A].filter((x) => !B.has(x));
  const onlyB = [...B].filter((x) => !A.has(x));
  const union = new Set([...A, ...B]).size;
  return { score: union === 0 ? null : shared.length / union, shared, onlyA, onlyB };
}

const tagNames = (xs: string[]) => xs.map((x) => LABELS[x as keyof typeof LABELS] ?? x);

export function compareSites(target: TargetSite, analog: EarthAnalog, weights: Weights = DEFAULT_WEIGHTS): AnalogMatch {
  const morph = jaccard(target.morphology, analog.morphology);
  const mineral = jaccard(target.mineralogy, analog.mineralogy);
  const hab = jaccard(target.habitability, analog.habitability);
  const envKeys = Object.keys(ENV_LABELS) as (keyof EnvLevels)[];
  const env = envKeys.map((k) => ({
    key: k,
    label: ENV_LABELS[k],
    target: target.env[k],
    earth: analog.env[k],
    similarity: 1 - Math.abs(target.env[k] - analog.env[k]),
  }));
  const envScore = env.reduce((s, e) => s + e.similarity, 0) / env.length;

  const dims: DimensionResult[] = [
    { key: 'morphology', label: 'Landforms', score: morph.score, shared: tagNames(morph.shared), onlyTarget: tagNames(morph.onlyA), onlyEarth: tagNames(morph.onlyB) },
    { key: 'mineralogy', label: 'Minerals', score: mineral.score, shared: tagNames(mineral.shared), onlyTarget: tagNames(mineral.onlyA), onlyEarth: tagNames(mineral.onlyB) },
    { key: 'environment', label: 'Environment', score: envScore, shared: [], onlyTarget: [], onlyEarth: [] },
    { key: 'habitability', label: 'Habitability context', score: hab.score, shared: tagNames(hab.shared), onlyTarget: tagNames(hab.onlyA), onlyEarth: tagNames(hab.onlyB) },
  ];

  const geoParts = [morph.score, mineral.score].filter((x): x is number => x !== null);
  const geology = geoParts.length ? geoParts.reduce((s, x) => s + x, 0) / geoParts.length : null;
  const parts: [number | null, number][] = [
    [geology, weights.geology],
    [envScore, weights.environment],
    [hab.score, weights.habitability],
  ];
  let num = 0;
  let den = 0;
  for (const [v, w] of parts) {
    if (v === null || w <= 0) continue;
    num += v * w;
    den += w;
  }
  const overall = den > 0 ? num / den : 0;

  const scored = dims.filter((d) => d.score !== null) as (DimensionResult & { score: number })[];
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return {
    analog,
    overall,
    dims,
    env,
    strongest: sorted[0]?.label ?? '—',
    weakest: sorted[sorted.length - 1]?.label ?? '—',
  };
}

export function rankAnalogs(target: TargetSite, weights: Weights = DEFAULT_WEIGHTS): AnalogMatch[] {
  return EARTH_ANALOGS.map((a) => compareSites(target, a, weights)).sort((x, y) => y.overall - x.overall);
}

/**
 * The best analog for each dimension separately: a site can be an excellent geological analog
 * and a poor temperature analog at the same time.
 */
export function bestPerDimension(target: TargetSite, weights: Weights = DEFAULT_WEIGHTS): { label: string; match: AnalogMatch; score: number }[] {
  const all = rankAnalogs(target, weights);
  const keys: DimensionResult['key'][] = ['morphology', 'mineralogy', 'environment', 'habitability'];
  const out: { label: string; match: AnalogMatch; score: number }[] = [];
  for (const k of keys) {
    let best: { label: string; match: AnalogMatch; score: number } | null = null;
    for (const m of all) {
      const d = m.dims.find((x) => x.key === k)!;
      if (d.score === null) continue;
      if (!best || d.score > best.score) best = { label: d.label, match: m, score: d.score };
    }
    if (best && best.score > 0) out.push(best);
  }
  return out;
}

/* ----------------------------------------------------------------- what Earth cannot reproduce */

export interface Limit {
  quantity: string;
  earth: string;
  other: string;
  ratio: string;
  consequence: string;
  source: string;
}

const MOON_GRAVITY = 1.62; // m/s², NASA Moon Fact Sheet
const EARTH_BG_MSV_DAY = 2.4 / 365.25; // UNSCEAR world-average natural background, 2.4 mSv/yr

export function earthLimits(body: Body): Limit[] {
  const gE = EARTH_BODY_STUB.surfaceGravityMps2;
  if (body === 'moon') {
    const gM = MOON_BODY.surfaceGravityMps2;
    const moonDose = CURIOSITY_RAD_EXCERPT.meanDoseEquivalentUSvPerDay / 1000; // mSv/day
    return [
      {
        quantity: 'Gravity',
        earth: `${gE.toFixed(2)} m/s²`,
        other: `${gM.toFixed(2)} m/s²`,
        ratio: `${(gM / gE).toFixed(2)} g`,
        consequence: 'Dust, sediment transport, slope stability, wheel traction and human movement all behave differently.',
        source: 'MOON_BODY / EARTH_BODY_STUB constants',
      },
      {
        quantity: 'Surface pressure',
        earth: '≈ 101 kPa',
        other: '≈ 0.6 kPa (varies with season and altitude)',
        ratio: '≈ 1/170',
        consequence: 'Liquid water is unstable at the surface; heat transfer, aerobraking and dust lifting differ completely.',
        source: 'NASA Moon Fact Sheet',
      },
      {
        quantity: 'Atmosphere',
        earth: '78% N₂, 21% O₂',
        other: '≈ 95% CO₂',
        ratio: '—',
        consequence: 'No breathable air; different chemistry for weathering and oxidation.',
        source: 'NASA Moon Fact Sheet',
      },
      {
        quantity: 'Surface radiation (dose equivalent)',
        earth: `≈ ${EARTH_BG_MSV_DAY.toFixed(4)} mSv/day (natural background)`,
        other: `≈ ${moonDose.toFixed(2)} mSv/day (Curiosity RAD, Gale)`,
        ratio: `≈ ${Math.round(moonDose / EARTH_BG_MSV_DAY)}×`,
        consequence: 'No magnetic field and a thin atmosphere: cosmic rays alter organics in the top metre; crew dose limits drive mission design.',
        source: `${CURIOSITY_RAD_EXCERPT.citation}; UNSCEAR (2008)`,
      },
    ];
  }
  const doseMoon = 1.37; // mSv/day, Chang'e 4 LND
  return [
    {
      quantity: 'Gravity',
      earth: `${gE.toFixed(2)} m/s²`,
      other: `${MOON_GRAVITY.toFixed(2)} m/s²`,
      ratio: `${(MOON_GRAVITY / gE).toFixed(2)} g`,
      consequence: 'Regolith mechanics, dust behaviour and astronaut mobility cannot be reproduced on Earth for long.',
      source: 'NASA Moon Fact Sheet',
    },
    {
      quantity: 'Atmosphere',
      earth: '≈ 101 kPa',
      other: 'Hard vacuum (tenuous exosphere)',
      ratio: '—',
      consequence: 'No weathering by air or water; extreme day–night temperature swings; electrostatically charged sharp dust.',
      source: 'NASA Moon Fact Sheet',
    },
    {
      quantity: 'Surface radiation (dose equivalent)',
      earth: `≈ ${EARTH_BG_MSV_DAY.toFixed(4)} mSv/day (natural background)`,
      other: `≈ ${doseMoon.toFixed(2)} mSv/day (Chang'e 4 LND)`,
      ratio: `≈ ${Math.round(doseMoon / EARTH_BG_MSV_DAY)}×`,
      consequence: 'No atmosphere or magnetic field: shielding is required for any long stay.',
      source: "Zhang et al. (2020) Science Advances; UNSCEAR (2008)",
    },
  ];
}
