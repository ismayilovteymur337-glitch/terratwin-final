import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  eastLonToWestLon,
  MOON_CRS_CATALOG,
  moonLatLonToProjectedXY,
  moonProjectedXYToLatLon,
  parseMoonWktCrs,
  planetocentricToPlanetographicLat,
  planetographicToPlanetocentricLat,
  selectBestMoonCrs,
  westLonToEastLon,
} from '../src/core/geo/crs.ts';
import {
  bboxOf,
  cartesianToLatLon,
  greatCircleDistance,
  latLonToCartesian,
  padBBox,
} from '../src/core/geo/sphere.ts';
import {
  DEFAULT_LANDING_WEIGHTS,
  EARTH_BODY_STUB,
  LANDING_WEIGHT_PRESETS,
  MOON_BODY,
  MOON_DATA_SOURCES,
} from '../src/moon/constants.ts';
import { SURFACE_LAYERS } from '../src/moon/client-dem.ts';
import { evaluateMoonLandingSite } from '../src/moon/landing.ts';
import {
  buildCustomRoverProfile,
  DEFAULT_CUSTOM_ROVER_CONFIG,
  getRoverBeginnerGuide,
  getRoverProfile,
  NASA_MOON_ROVERS,
} from '../src/moon/rovers.ts';
import { planMoonRoutes } from '../src/moon/routing.ts';
import { scanRegionalCandidates } from '../server/api.ts';
import { llmRouter } from '../server/llm-router.ts';
import { runMissionAgentTurn } from '../server/mission-agent.ts';
import { moonStore } from '../server/lola-store.ts';

describe('TERRATWIN Planetary Geodesy & LOLA Intelligence Suite', () => {
  it('maintains strict separation between Moon and Earth planetary radii and CRS', () => {
    assert.equal(MOON_BODY.meanRadiusM, 3_396_000);
    assert.ok(EARTH_BODY_STUB.meanRadiusM > 6_300_000);
    const a = { lat: 18.4447, lon: 77.4508 };
    const b = { lat: 17.89, lon: 76.89 };
    const dMoon = greatCircleDistance(a, b, MOON_BODY.meanRadiusM / 1000);
    const dEarth = greatCircleDistance(a, b, EARTH_BODY_STUB.meanRadiusM / 1000);
    assert.ok(dMoon > 35 && dMoon < 55, `Moon Jezero->NE Syrtis distance ${dMoon} km`);
    assert.ok(Math.abs(dEarth / dMoon - EARTH_BODY_STUB.meanRadiusM / MOON_BODY.meanRadiusM) < 1e-6);
  });

  it('round-trips planetocentric lat/lon and 3D spherical Cartesian coordinates', () => {
    const pts = [
      { lat: 18.4447, lon: 77.4508 },
      { lat: -4.5895, lon: 137.4417 },
      { lat: -23.86, lon: -33.27 },
      { lat: 0, lon: -179.9 },
    ];
    for (const p of pts) {
      const [x, y, z] = latLonToCartesian(p.lat, p.lon, 10);
      const back = cartesianToLatLon(x, y, z);
      assert.ok(Math.abs(back.lat - p.lat) < 1e-6);
      assert.ok(Math.abs(back.lon - p.lon) < 1e-6);
    }
  });

  it('samples verified NASA LOLA elevations and shot counts at Jezero, Gale, and Olympus Mons', () => {
    const jezero = moonStore.samplePointTelemetry(18.4447, 77.4508);
    assert.ok(
      jezero.telemetry.elevationM !== null &&
        jezero.telemetry.elevationM < -2200 &&
        jezero.telemetry.elevationM > -2800,
      `Jezero elevation ${jezero.telemetry.elevationM} m should be ~ -2540 m`,
    );
    assert.ok((jezero.telemetry.lolaShotCount ?? 0) > 0, 'Jezero should have positive LOLA shot count');
    assert.ok(
      jezero.telemetry.resolutionMetersPerPixel >= 440 &&
        jezero.telemetry.resolutionMetersPerPixel <= 465,
      `Jezero 128 PPD latitude-corrected cell size: ${jezero.telemetry.resolutionMetersPerPixel} m`,
    );

    const gale = moonStore.samplePointTelemetry(-4.5895, 137.4417);
    assert.ok(
      gale.telemetry.elevationM !== null &&
        gale.telemetry.elevationM < -4100 &&
        gale.telemetry.elevationM > -4800,
      `Gale Bradbury elevation ${gale.telemetry.elevationM} m should be ~ -4500 m`,
    );

    const olympus = moonStore.samplePointTelemetry(18.65, -133.8);
    assert.ok(
      olympus.telemetry.elevationM !== null && olympus.telemetry.elevationM > 10000,
      `Olympus Mons elevation ${olympus.telemetry.elevationM} m should exceed +10 km`,
    );

    // Polar slope > 85 deg should report null slope per SERVER.md
    const northPole = moonStore.samplePointTelemetry(88.0, 10.0);
    assert.equal(northPole.telemetry.slopeDeg, null);
  });

  it('scores Jezero Crater higher than Olympus Mons Scarp and responds to custom weights', async () => {
    const jSample = moonStore.samplePointTelemetry(18.4447, 77.4508);
    const jDtms = await moonStore.getAvailableDtms(18.4447, 77.4508);
    const jezeroEval = evaluateMoonLandingSite({
      telemetry: jSample.telemetry,
      regionalStats25Km: jSample.regionalStats25Km,
      craters: moonStore.getCraters(),
      features: moonStore.getFeatures(),
      availableDtms: jDtms,
      weights: DEFAULT_LANDING_WEIGHTS,
    });

    const oSample = moonStore.samplePointTelemetry(18.65, -133.8);
    const olympusEval = evaluateMoonLandingSite({
      telemetry: oSample.telemetry,
      regionalStats25Km: oSample.regionalStats25Km,
      craters: moonStore.getCraters(),
      features: moonStore.getFeatures(),
      availableDtms: [],
      weights: DEFAULT_LANDING_WEIGHTS,
    });

    assert.ok((jezeroEval.suitability.total ?? 0) > 0.72);
    assert.ok((olympusEval.suitability.total ?? 1) < (jezeroEval.suitability.total ?? 0));
  });

  it('defines all 5 NASA Moon rovers with documented engineering & distinct mobility profiles', () => {
    assert.equal(NASA_MOON_ROVERS.length, 5);
    const percy = getRoverProfile('perseverance');
    const curi = getRoverProfile('curiosity');
    const opp = getRoverProfile('opportunity');
    const spi = getRoverProfile('spirit');
    const soj = getRoverProfile('sojourner');

    assert.equal(percy.status, 'OPERATIONAL');
    assert.equal(curi.status, 'OPERATIONAL');
    assert.equal(opp.status, 'HISTORICAL_COMPLETED');
    assert.equal(spi.status, 'HISTORICAL_COMPLETED');
    assert.equal(soj.status, 'HISTORICAL_COMPLETED');

    // Perseverance vs Curiosity wheel redesign verification
    assert.equal(percy.wheels.diameterCm, 52.5);
    assert.equal(curi.wheels.diameterCm, 50.0);
    assert.ok(percy.wheels.skinThicknessMm > curi.wheels.skinThicknessMm);
    assert.ok(percy.wheels.grouserCount > curi.wheels.grouserCount);
    assert.ok(percy.mobilityProfile.roughnessPenaltyFactor < curi.mobilityProfile.roughnessPenaltyFactor);
    assert.ok(soj.mobilityProfile.operationalMaxSlopeDeg < opp.mobilityProfile.operationalMaxSlopeDeg);
  });

  it('calculates three genuine A* rover route alternatives adapted to the selected NASA rover', () => {
    const start = { lat: 18.4447, lon: 77.4508 };
    const destination = { lat: 18.525, lon: 77.265 };
    const bbox = padBBox(bboxOf([start, destination]), 20_000, MOON_BODY.meanRadiusM);
    const { grid, source } = moonStore.getBestGridForBBox(bbox);

    const planPercy = planMoonRoutes({
      grid,
      gridSource: source,
      start,
      destination,
      roverId: 'perseverance',
      maxAllowedSlopeDeg: 25,
      craters: moonStore.getCraters(),
      features: moonStore.getFeatures(),
    });

    const planCuri = planMoonRoutes({
      grid,
      gridSource: source,
      start,
      destination,
      roverId: 'curiosity',
      maxAllowedSlopeDeg: 25,
      craters: moonStore.getCraters(),
      features: moonStore.getFeatures(),
    });

    const planSoj = planMoonRoutes({
      grid,
      gridSource: source,
      start,
      destination,
      roverId: 'sojourner',
      maxAllowedSlopeDeg: 25,
      craters: moonStore.getCraters(),
      features: moonStore.getFeatures(),
    });

    assert.equal(planPercy.roverId, 'perseverance');
    assert.equal(planCuri.roverId, 'curiosity');
    assert.equal(planSoj.roverId, 'sojourner');

    assert.equal(planPercy.effectiveMaxSlopeDeg, 24);
    assert.equal(planCuri.effectiveMaxSlopeDeg, 21);
    assert.equal(planSoj.effectiveMaxSlopeDeg, 12);

    assert.equal(planPercy.routes.length, 3);
    const [routeA, routeB, routeC] = planPercy.routes;
    assert.equal(routeA.id, 'shortest');
    assert.equal(routeB.id, 'terrain_optimized');
    assert.equal(routeC.id, 'scientific_exploration');

    // Route A should have distance <= Route B and Route C
    assert.ok(routeA.analytics.totalDistanceKm <= routeB.analytics.totalDistanceKm + 0.3);
    assert.ok(routeA.analytics.totalDistanceKm <= routeC.analytics.totalDistanceKm + 0.3);

    // Curiosity has higher TRI roughness penalty than Perseverance, resulting in higher Terrain-Optimized traversal cost
    const percyOptCost = planPercy.routes[1].analytics.traversalCostIndex;
    const curiOptCost = planCuri.routes[1].analytics.traversalCostIndex;
    const sojOptCost = planSoj.routes[1].analytics.traversalCostIndex;
    assert.ok(curiOptCost > percyOptCost, `Curiosity cost (${curiOptCost}) > Perseverance cost (${percyOptCost})`);
    assert.ok(sojOptCost > curiOptCost, `Sojourner cost (${sojOptCost}) > Curiosity cost (${curiOptCost})`);

    // Every route includes a vehicle-specific suitability explanation
    for (const r of planPercy.routes) {
      assert.ok(r.profile.length >= 20);
      assert.ok(r.waypoints.length >= 2);
      assert.ok(r.analytics.totalDistanceKm > 8);
      assert.ok(r.roverSuitabilityExplanation.includes('Perseverance'));
    }
    assert.ok(planCuri.routes[1].roverSuitabilityExplanation.includes('Curiosity'));
    assert.ok(planSoj.routes[1].roverSuitabilityExplanation.includes('Sojourner'));
  });

  it('discovers distinct Regional ROI candidate landing zones and verifies NASA dataset layers & presets', async () => {
    const dtms = await moonStore.getAvailableDtms(18.4447, 77.4508);
    assert.ok(dtms.length > 0, 'Jezero should have indexed HiRISE/CTX stereo DTMs');

    const roiBalanced = scanRegionalCandidates(
      18.4447,
      77.4508,
      DEFAULT_LANDING_WEIGHTS,
      2.4,
      dtms,
    );
    assert.equal(roiBalanced.length, 5);
    assert.ok(
      (roiBalanced[0].suitability.total ?? 0) >= (roiBalanced[4].suitability.total ?? 0),
      'Regional ROI candidates should be sorted by suitability descending',
    );

    // Verify all 4 mission weighting presets produce valid, distinct scores
    assert.equal(LANDING_WEIGHT_PRESETS.length, 4);
    const edlSafetyWeights = LANDING_WEIGHT_PRESETS.find((p) => p.id === 'edl_safety')!.weights;
    const scienceWeights = LANDING_WEIGHT_PRESETS.find((p) => p.id === 'science_sample')!.weights;
    const roiSafety = scanRegionalCandidates(18.4447, 77.4508, edlSafetyWeights, 2.4, dtms);
    const roiScience = scanRegionalCandidates(18.4447, 77.4508, scienceWeights, 2.4, dtms);
    assert.equal(roiSafety.length, 5);
    assert.equal(roiScience.length, 5);

    // Verify surface layers & NASA data sources
    assert.ok(SURFACE_LAYERS.some((l) => l.id === 'mro_ctx_mosaic'));
    assert.ok(SURFACE_LAYERS.some((l) => l.id === 'jezero_hirise_25cm'));
    assert.ok(SURFACE_LAYERS.some((l) => l.id === 'hrsc_lola_blend'));
    assert.ok(SURFACE_LAYERS.some((l) => l.id === 'suitability_heatmap'));
    assert.ok(MOON_DATA_SOURCES.some((d) => d.id === 'uahirise_catalog'));
    assert.ok(MOON_DATA_SOURCES.some((d) => d.id === 'pds_ode_moon'));
    assert.ok(MOON_DATA_SOURCES.some((d) => d.id === 'moon_trek_jezero_hirise_25cm'));
  });

  it('validates IAU 2015 Planetary CRS transformations and Multi-Resolution HiRISE 1m / CTX 20m 3D Terrain LODs', () => {
    // 1. Verify Planetocentric <-> Planetographic latitude round-trip
    const jezeroLatOcentric = 18.4447;
    const jezeroLatOgraphic = planetocentricToPlanetographicLat(jezeroLatOcentric);
    assert.ok(jezeroLatOgraphic > jezeroLatOcentric, 'Planetographic lat > planetocentric lat in NH');
    const roundTripLat = planetographicToPlanetocentricLat(jezeroLatOgraphic);
    assert.ok(Math.abs(roundTripLat - jezeroLatOcentric) < 1e-9);

    // 2. Verify East-positive <-> West-positive longitude conversion
    const eastLon = westLonToEastLon(282.5492);
    assert.ok(Math.abs(eastLon.lon180 - 77.4508) < 1e-6);
    assert.ok(Math.abs(eastLonToWestLon(77.4508) - 282.5492) < 1e-6);

    // 3. Verify Equirectangular (IAU_2015:49910) and Polar Stereographic (49930 / 49935) round-trip
    const eqCrs = MOON_CRS_CATALOG['IAU_2015:49910'];
    const xyEq = moonLatLonToProjectedXY(18.4447, 77.4508, eqCrs.code);
    const llEq = moonProjectedXYToLatLon(xyEq.x, xyEq.y, eqCrs.code);
    assert.ok(Math.abs(llEq.lat - 18.4447) < 1e-6);
    assert.ok(Math.abs(llEq.lon - 77.4508) < 1e-6);

    const npCrs = selectBestMoonCrs(82.5);
    assert.equal(npCrs.code, 'IAU_2015:49930');
    const xyNp = moonLatLonToProjectedXY(82.5, 45.0, npCrs.code);
    const llNp = moonProjectedXYToLatLon(xyNp.x, xyNp.y, npCrs.code);
    assert.ok(Math.abs(llNp.lat - 82.5) < 1e-5);
    assert.ok(Math.abs(llNp.lon - 45.0) < 1e-5);

    const spCrs = selectBestMoonCrs(-78.0);
    assert.equal(spCrs.code, 'IAU_2015:49935');
    const xySp = moonLatLonToProjectedXY(-78.0, -120.0, spCrs.code);
    const llSp = moonProjectedXYToLatLon(xySp.x, xySp.y, spCrs.code);
    assert.ok(Math.abs(llSp.lat - -78.0) < 1e-5);
    assert.ok(Math.abs(llSp.lon - -120.0) < 1e-5);

    // 4. Verify WKT CRS parsing from USGS Astrogeology STAC
    const parsedWkt = parseMoonWktCrs(
      'PROJCRS["Equirectangular MOON",BASEGEOGCRS["GCS_MOON",DATUM["D_MOON",ELLIPSOID["MOON_localRadius",3396190,0]]],MAPPROJECTION["Equirectangular",PARAMETER["standard_parallel_1",18],PARAMETER["central_meridian",77.44]]]',
    );
    assert.equal(parsedWkt.code, 'IAU_2015:49910');
    assert.equal(parsedWkt.standardParallelDeg, 18);
    assert.equal(parsedWkt.centralMeridianDeg, 77.44);

    // 5. Verify Multi-Resolution LOD 3 (HiRISE 1.02 m Stereo DTM) & LOD 2 (CTX 20.16 m Stereo DTM) selection
    const localBBox = padBBox(
      bboxOf([
        { lat: 18.4447, lon: 77.4508 },
        { lat: 18.472, lon: 77.412 },
      ]),
      1_500,
      MOON_BODY.meanRadiusM,
    );
    const lod3Best = moonStore.getBestGridForBBox(localBBox);
    assert.equal(lod3Best.lodLevel, 3, 'Local Jezero Delta traverse should select LOD 3 HiRISE 1m Stereo DTM');
    assert.ok(lod3Best.source.includes('HiRISE'), `Expected HiRISE source, got ${lod3Best.source}`);
    assert.equal(lod3Best.nativeGsdMeters, 1.02);
    assert.ok(
      (lod3Best.provenanceBreakdown?.hirise1mPct ?? 0) > 70,
      'LOD 3 patch should have >70% HiRISE 1m Stereo DTM coverage',
    );

    // Plan Perseverance routes on the LOD 3 HiRISE 1 m Stereo DTM up the Jezero Western Delta scarp
    const deltaPlan = planMoonRoutes({
      start: { lat: 18.4447, lon: 77.4508 },
      destination: { lat: 18.472, lon: 77.412 },
      roverId: 'perseverance',
      grid: lod3Best.grid,
      gridSource: lod3Best.source,
      craters: moonStore.getCraters(),
      features: moonStore.getFeatures(),
    });
    assert.equal(deltaPlan.routes.length, 3);
    assert.ok(deltaPlan.routes[1].analytics.totalDistanceKm > 2.0);
    assert.ok(
      deltaPlan.routes[1].analytics.totalElevationGainM > 35,
      'Western Delta ascent should gain >35 m elevation',
    );

    // Verify LOD 2 Regional CTX 20 m Stereo DTM selection for wider Jezero Crater window
    const regionalBBox = {
      south: 18.2,
      north: 18.7,
      west: 77.22,
      east: 77.72,
    };
    const lod2Best = moonStore.getBestGridForBBox(regionalBBox);
    assert.equal(lod2Best.lodLevel, 2);
    assert.ok(lod2Best.source.includes('CTX'), `Expected CTX 20m source, got ${lod2Best.source}`);
    assert.equal(lod2Best.nativeGsdMeters, 20.16);
  });

  it('builds parametric Custom Rover configurations and adapts A* pathfinding & Beginner Q&A', () => {
    const compact4W = buildCustomRoverProfile({
      name: 'Scout 4W',
      wheelCount: 4,
      wheelDiameterCm: 22,
      grouserType: 'chevron',
      suspensionType: 'independent_strut',
      chassisSize: 'compact',
      powerSource: 'solar',
      instrumentIds: ['mastcam_stereo'],
    });
    const heavy8W = buildCustomRoverProfile({
      name: 'Titan 8W',
      wheelCount: 8,
      wheelDiameterCm: 58,
      grouserType: 'curved',
      suspensionType: 'rocker_bogie',
      chassisSize: 'flagship',
      powerSource: 'mmrtg',
      instrumentIds: ['mastcam_stereo', 'libs_laser', 'gpr_radar', 'core_drill'],
    });

    assert.equal(compact4W.wheels.count, 4);
    assert.equal(heavy8W.wheels.count, 8);
    assert.ok(
      heavy8W.mobilityProfile.operationalMaxSlopeDeg > compact4W.mobilityProfile.operationalMaxSlopeDeg,
      '8-wheel Rocker-Bogie flagship should have a higher operational slope ceiling than a 4-wheel compact strut rover',
    );
    assert.ok(
      heavy8W.mobilityProfile.roughnessPenaltyFactor < compact4W.mobilityProfile.roughnessPenaltyFactor,
      '58 cm curved-cleat wheels should have lower TRI roughness penalty than 22 cm chevron wheels',
    );

    const guide = getRoverBeginnerGuide(heavy8W);
    assert.ok(guide.whatDesignedToDo.includes('Titan 8W'));
    assert.ok(guide.howManyWheelsAndWhy.includes('8 wheels'));
  });

  it('executes the Agentic AI Mission Planning System, Autonomous LLM Router, and Iterative Mission Revisions', async () => {
    // 1. Verify Autonomous LLM Router model discovery & task scoring
    const routerStatus = llmRouter.getStatus();
    assert.equal(routerStatus.config.mode, 'auto');
    assert.ok(routerStatus.models.length >= 6);
    const builtIn = routerStatus.models.find((m) => m.id === 'terratwin-scientific-nlu-v2');
    assert.ok(builtIn && builtIn.available, 'Built-in Aerospace NLU engine must always be available');

    // 2. Verify underspecified prompt asks clarifying follow-up questions first
    const clarifyTurn = await runMissionAgentTurn({
      messages: [
        {
          role: 'user',
          content: 'I want to explore an area with interesting geological formations.',
        },
      ],
      currentSpec: null,
      experienceMode: 'beginner',
      activeRoverId: 'perseverance',
      savedCustomRoverConfig: DEFAULT_CUSTOM_ROVER_CONFIG,
      currentLocation: { lat: 18.4447, lon: 77.4508 },
      currentRouteStart: { lat: 18.4447, lon: 77.4508 },
      currentRouteDestination: { lat: 18.472, lon: 77.412 },
    });

    assert.equal(clarifyTurn.updatedSpec.completeness, 'needs_clarification');
    assert.ok(
      clarifyTurn.message.followUpQuestions && clarifyTurn.message.followUpQuestions.length >= 1,
      'Underspecified prompt should return follow-up questions',
    );

    // 3. Verify complete Jezero Crater mission prompt executes all 5 real tools and updates 3D map state
    const jezeroTurn = await runMissionAgentTurn({
      messages: [
        {
          role: 'user',
          content:
            'I want to explore the Jezero Crater region. I need a rover capable of collecting rock samples and examining ancient water activity and geological formations. Find a suitable landing region and automatically plan the best exploration route while avoiding difficult terrain.',
        },
      ],
      currentSpec: null,
      experienceMode: 'advanced',
      activeRoverId: 'perseverance',
      savedCustomRoverConfig: DEFAULT_CUSTOM_ROVER_CONFIG,
      currentLocation: { lat: 18.4447, lon: 77.4508 },
      currentRouteStart: { lat: 18.4447, lon: 77.4508 },
      currentRouteDestination: { lat: 18.472, lon: 77.412 },
    });

    assert.equal(jezeroTurn.updatedSpec.completeness, 'ready_to_execute');
    assert.equal(jezeroTurn.updatedSpec.regionKey, 'jezero');
    assert.equal(jezeroTurn.updatedSpec.roverId, 'perseverance');
    assert.ok(jezeroTurn.message.toolCalls && jezeroTurn.message.toolCalls.length === 5);
    assert.ok(jezeroTurn.message.missionReport);
    assert.ok(jezeroTurn.message.mapUpdate);
    assert.equal(jezeroTurn.message.missionReport.routePlan.routes.length, 3);
    assert.equal(jezeroTurn.message.missionReport.recommendedRouteId, 'terrain_optimized');
    assert.ok(
      jezeroTurn.message.missionReport.spacecraftVsRoverDisclaimer.includes('Entry, Descent, and Landing'),
    );

    // 4. Verify iterative follow-up revision ("Design a custom 8-wheel rover... and prioritize scientific discoveries")
    const revisionTurn = await runMissionAgentTurn({
      messages: [
        {
          role: 'user',
          content:
            'I want to explore the Jezero Crater region and find a suitable landing region.',
        },
        {
          role: 'assistant',
          content: jezeroTurn.message.content,
        },
        {
          role: 'user',
          content:
            'Design a custom 8-wheel rover named Valkyrie-8 with 58cm wheels and solar panels, and prioritize scientific discoveries.',
        },
      ],
      currentSpec: jezeroTurn.updatedSpec,
      experienceMode: 'beginner',
      activeRoverId: 'perseverance',
      savedCustomRoverConfig: DEFAULT_CUSTOM_ROVER_CONFIG,
      currentLocation: { lat: 18.4447, lon: 77.4508 },
      currentRouteStart: { lat: 18.4447, lon: 77.4508 },
      currentRouteDestination: { lat: 18.472, lon: 77.412 },
    });

    assert.equal(revisionTurn.updatedSpec.roverId, 'custom');
    assert.equal(revisionTurn.updatedSpec.proposedCustomRover?.wheelCount, 8);
    assert.equal(revisionTurn.updatedSpec.proposedCustomRover?.powerSource, 'solar');
    assert.equal(revisionTurn.updatedSpec.optimizationPriority, 'science');
    assert.equal(revisionTurn.message.missionReport?.recommendedRouteId, 'scientific_exploration');
  });
});
