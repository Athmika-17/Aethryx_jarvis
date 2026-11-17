import assert from 'node:assert/strict';
import http from 'node:http';
import type { TimeSeriesPoint } from '../src/types/earth.ts';
import { initDatabase } from '../server/database.ts';
import {
  computeAreaWeightedMean,
  cosineLatitudeWeight,
  fetchWithRetry,
} from '../server/nasaConnectors.ts';
import { generateCsvReport, generateHtmlReport } from '../server/reportGenerator.ts';
import {
  computeSummaryStats,
  detectAnomalies,
  generateForecast,
  runTrendAnalysis,
} from '../server/statistics.ts';
import { createAppServer } from '../server.ts';

function makeMonthlySeries(
  months: number,
  fn: (i: number, monthOfYear: number) => number | null,
): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let i = 0; i < months; i++) {
    const yr = 2005 + Math.floor(i / 12);
    const mo = (i % 12) + 1;
    const date = `${yr}-${String(mo).padStart(2, '0')}`;
    const ts = Date.parse(`${date}-01T00:00:00Z`);
    const v = fn(i, mo);
    pts.push({
      date,
      timestamp: ts,
      value: v,
      rawValue: v,
      unit: '°C',
      isMissing: v === null,
    });
  }
  return pts;
}

async function runUnitTests() {
  console.log('1. Testing Statistical Engine...');

  // Test A: Strong increasing seasonal series (+0.06/yr)
  const incSeries = makeMonthlySeries(120, (i, mo) => {
    if (i === 15 || i === 44) return null; // Test missing data handling
    const yrFrac = i / 12;
    const seasonal = 4 * Math.sin(((mo - 4) / 12) * 2 * Math.PI);
    return 24 + 0.08 * yrFrac + seasonal;
  });

  const incTrend = runTrendAnalysis({
    points: incSeries,
    variableId: 'T2M',
    variableName: 'Temperature at 2m',
    units: '°C',
    datasetName: 'NASA POWER',
    productId: 'POWER_TEST',
    aggregation: 'monthly',
    mode: 'live',
    isSimulated: false,
  });

  assert.equal(incTrend.validObservations, 118, 'Should count 118 valid observations');
  assert.equal(incTrend.missingObservations, 2, 'Should count 2 missing observations');
  assert.equal(incTrend.classification, 'increasing', 'Should classify as increasing');
  assert.equal(incTrend.mannKendall.method, 'seasonal', 'Should select Seasonal Mann-Kendall');
  assert.ok(incTrend.mannKendall.pValue < 0.001, 'MK p-value should be < 0.001');
  assert.ok(
    Math.abs(incTrend.sensSlope.slopePerYear - 0.08) < 0.01,
    `Sen's slope (${incTrend.sensSlope.slopePerYear}) should be close to 0.08/yr`,
  );
  assert.ok(
    incTrend.linearRegression.ci95LowerPerYear <= incTrend.linearRegression.slopePerYear &&
      incTrend.linearRegression.slopePerYear <= incTrend.linearRegression.ci95UpperPerYear,
    '95% CI should bracket OLS slope',
  );

  // Test B: Stationary alternating series (no trend)
  const flatSeries = makeMonthlySeries(60, (i) => 20 + (i % 2 === 0 ? 0.2 : -0.2));
  const flatTrend = runTrendAnalysis({
    points: flatSeries,
    variableId: 'T2M',
    variableName: 'Temperature at 2m',
    units: '°C',
    datasetName: 'Test',
    productId: 'TEST',
    aggregation: 'monthly',
    mode: 'demo',
    isSimulated: true,
  });
  assert.equal(flatTrend.classification, 'no-significant-trend');

  // Test C: Insufficient sample size
  const shortSeries = makeMonthlySeries(5, (i) => 20 + i);
  const shortTrend = runTrendAnalysis({
    points: shortSeries,
    variableId: 'T2M',
    variableName: 'Temp',
    units: '°C',
    datasetName: 'Test',
    productId: 'TEST',
    aggregation: 'monthly',
    mode: 'live',
    isSimulated: false,
  });
  assert.equal(shortTrend.classification, 'insufficient-evidence');

  // Test D: Anomaly Detection with injected extreme spike
  const anomSeries = makeMonthlySeries(72, (i, mo) => {
    const seasonal = 3 * Math.cos(((mo - 5) / 12) * 2 * Math.PI);
    const noise = ((i * 7) % 5) * 0.1 - 0.2;
    return i === 40 ? 39.5 : 24 + seasonal + noise;
  });
  const anomRes = detectAnomalies({
    points: anomSeries,
    units: '°C',
    method: 'seasonal-z-score',
    threshold: 2.0,
    mode: 'live',
    isSimulated: false,
  });
  assert.ok(anomRes.anomalyCount >= 1, 'Should detect injected spike');
  assert.equal(anomRes.anomalies[0].date, anomSeries[40].date, 'Top anomaly should be index 40');

  // Test E: Forecasting & Holdout Validation
  const fcOk = generateForecast({ points: incSeries, units: '°C', aggregation: 'monthly', horizonSteps: 12 });
  assert.equal(fcOk.available, true);
  assert.equal(fcOk.points.length, 12);
  assert.equal(fcOk.points[0].isEstimate, true);
  assert.ok((fcOk.validationMetrics?.rmse ?? 999) < 1.0);

  const fcShort = generateForecast({ points: shortSeries, units: '°C', aggregation: 'monthly' });
  assert.equal(fcShort.available, false);

  // Test F: Summary stats & Seasonal Breakdown
  const stats = computeSummaryStats(incSeries);
  assert.ok(stats.mean !== null && stats.min !== null && stats.max !== null);

  assert.ok(incTrend.seasonalBreakdown, 'Seasonal breakdown should be populated for monthly data');
  assert.equal(incTrend.seasonalBreakdown.monthly.length, 12, 'Should include all 12 calendar months');
  assert.equal(incTrend.seasonalBreakdown.quarters.length, 4, 'Should include DJF, MAM, JJA, SON quarters');
  const firstQuarter = incTrend.seasonalBreakdown.quarters[0];
  assert.ok(
    firstQuarter.slopePerYear !== null && Math.abs(firstQuarter.slopePerYear - 0.08) < 0.02,
    `Quarterly seasonal Sen's slope (${firstQuarter.slopePerYear}) should recover +0.08/yr`,
  );

  // Test G: Cosine-Latitude Area Weighting
  const eqWeight = cosineLatitudeWeight(0);
  const midLatWeight = cosineLatitudeWeight(60);
  assert.ok(Math.abs(eqWeight - 1) < 1e-4, 'cos(0°) should be 1');
  assert.ok(Math.abs(midLatWeight - 0.5) < 1e-4, 'cos(60°) should be 0.5');
  const weightedMean = computeAreaWeightedMean([
    { value: 10, lat: 0 },
    { value: 20, lat: 60 },
  ]);
  const expectedWeighted = (10 * eqWeight + 20 * midLatWeight) / (eqWeight + midLatWeight);
  assert.ok(
    weightedMean !== null && Math.abs(weightedMean - expectedWeighted) < 1e-4,
    `Cosine-latitude area-weighted mean (${weightedMean}) should equal ${expectedWeighted}`,
  );

  // Test H: Timeout & API failure honesty (never hang or return fabricated fallback)
  const slowServer = http.createServer((_req, _res) => {
    // Intentionally never respond to simulate network stall
  });
  await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
  const slowPort = (slowServer.address() as { port: number }).port;
  let timedOutHonest = false;
  try {
    await fetchWithRetry(`http://127.0.0.1:${slowPort}/stall`, {}, 0, 40);
  } catch {
    timedOutHonest = true;
  } finally {
    slowServer.closeAllConnections?.();
    slowServer.close();
  }
  assert.equal(timedOutHonest, true, 'fetchWithRetry must reject cleanly on timeout without faking data');

  console.log('✓ Statistical Engine, Seasonal Breakdown, Cosine-Weighting & Timeout unit tests passed.');
}

async function runApiTests() {
  console.log('2. Testing Express Backend & Live NASA Endpoints...');
  process.env.DB_PATH = ':memory:';
  initDatabase(':memory:');
  const app = await createAppServer();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Health
    const hRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(hRes.status, 200);
    const hJson = (await hRes.json()) as { status: string };
    assert.equal(hJson.status, 'ok');

    // Datasets discovery
    const dsRes = await fetch(`${baseUrl}/api/datasets`);
    assert.equal(dsRes.status, 200);
    const dsJson = (await dsRes.json()) as { datasets: Array<{ id: string }> };
    assert.equal(dsJson.datasets.length, 7, 'Should expose all 7 NASA dataset connectors');

    // Region search for Shivamogga
    const regRes = await fetch(`${baseUrl}/api/regions/search?q=Shivamogga`);
    assert.equal(regRes.status, 200);
    const regJson = (await regRes.json()) as { regions: Array<{ name: string; lat: number; lon: number }> };
    assert.ok(regJson.regions.length >= 1);
    assert.ok(regJson.regions[0].name.includes('Shivamogga'));

    // Live NASA POWER retrieval for Shivamogga
    const retRes = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'nasa-power',
        variableId: 'T2M',
        region: regJson.regions[0],
        startDate: '2015-01-01',
        endDate: '2024-12-31',
        aggregation: 'monthly',
        mode: 'live',
      }),
    });
    assert.equal(retRes.status, 200);
    const retJson = (await retRes.json()) as {
      retrievalStatus: string;
      isSimulated: boolean;
      validObservations: number;
      points: TimeSeriesPoint[];
    };
    assert.equal(retJson.retrievalStatus, 'success');
    assert.equal(retJson.isSimulated, false);
    assert.ok(retJson.validObservations >= 100, `Expected >=100 live NASA POWER points, got ${retJson.validObservations}`);

    // Trend endpoint on live NASA data
    const trRes = await fetch(`${baseUrl}/api/analysis/trend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrieved: retJson, alpha: 0.05 }),
    });
    assert.equal(trRes.status, 200);
    const trJson = (await trRes.json()) as { mannKendall: { pValue: number } };
    assert.ok(Number.isFinite(trJson.mannKendall.pValue));

    // CSV & HTML Report Generation
    const csv = generateCsvReport({ retrieved: retJson as never, trend: trJson as never });
    assert.ok(csv.includes('AETHRYX JARVIS'));
    const html = generateHtmlReport({ retrieved: retJson as never, trend: trJson as never });
    assert.ok(html.includes('<svg'));

    // Earthdata gated dataset honesty check (MODIS without EARTHDATA_TOKEN)
    const modisRes = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'modis',
        variableId: 'MODIS_NDVI',
        region: regJson.regions[0],
        startDate: '2020-01-01',
        endDate: '2024-01-01',
        aggregation: 'monthly',
        mode: 'live',
      }),
    });
    const modisJson = (await modisRes.json()) as { retrievalStatus: string; points: unknown[] };
    assert.equal(modisJson.retrievalStatus, 'auth-required');
    assert.equal(modisJson.points.length, 0);

    // History persistence roundtrip
    const saveRes = await fetch(`${baseUrl}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test-inv-1',
        title: 'Shivamogga Test',
        createdAt: new Date().toISOString(),
        region: regJson.regions[0],
        datasetId: 'nasa-power',
        datasetName: 'NASA POWER',
        productId: 'POWER_LARC_AG_RE_v9',
        variableId: 'T2M',
        variableName: 'Temperature at 2m',
        units: '°C',
        aggregation: 'monthly',
        mode: 'live',
        isSimulated: false,
        startDate: '2015-01',
        endDate: '2024-12',
      }),
    });
    assert.equal(saveRes.status, 201);
    const listRes = await fetch(`${baseUrl}/api/history`);
    const listJson = (await listRes.json()) as { investigations: Array<{ id: string }> };
    assert.ok(listJson.investigations.some((i) => i.id === 'test-inv-1'));

    // NASA Images API proxy check
    const imgRes = await fetch(`${baseUrl}/api/images/search?q=Earth`);
    assert.equal(imgRes.status, 200);
    const imgJson = (await imgRes.json()) as { items: unknown[] };
    assert.ok(imgJson.items.length > 0);

    console.log('✓ Core Express API & Live NASA integration tests passed.');
    console.log('3. Testing Global Worldwide Location Support (8+ Regions, Ocean, BBox, Polygon & Coverage Rules)...');

    // A. Invalid location search must NEVER fall back to Shivamogga
    const badSearchRes = await fetch(`${baseUrl}/api/regions/search?q=zzzzinvalidnowhere98765`);
    assert.equal(badSearchRes.status, 200);
    const badSearchJson = (await badSearchRes.json()) as {
      regions: Array<{ name: string }>;
      ambiguous: boolean;
      error?: string;
    };
    assert.equal(badSearchJson.regions.length, 0, 'Invalid search must return 0 regions (zero Shivamogga fallback)');
    assert.ok(Boolean(badSearchJson.error), 'Invalid search should explain why location could not be resolved');

    // B. Coordinate string parsing (New York)
    const coordSearchRes = await fetch(`${baseUrl}/api/regions/search?q=${encodeURIComponent('40.7128, -74.0060')}`);
    assert.equal(coordSearchRes.status, 200);
    const coordSearchJson = (await coordSearchRes.json()) as { regions: Array<{ lat: number; lon: number }> };
    assert.equal(coordSearchJson.regions.length, 1);
    assert.ok(Math.abs(coordSearchJson.regions[0].lat - 40.7128) < 0.01);
    assert.ok(Math.abs(coordSearchJson.regions[0].lon + 74.006) < 0.01);

    // C. Reverse geocoding over open Atlantic Ocean (0, -30)
    const oceanRevRes = await fetch(`${baseUrl}/api/regions/reverse?lat=0&lon=-30`);
    assert.equal(oceanRevRes.status, 200);
    const oceanRevJson = (await oceanRevRes.json()) as { region: { isOcean?: boolean; lat: number; lon: number } };
    assert.equal(oceanRevJson.region.isOcean, true, 'Mid-Atlantic coordinate (0, -30) must be identified as Ocean');

    // D. Independent Dataset Coverage Checks: Ocean (land-only exclusions) & Svalbard Arctic (GPM IMERG 60°S–60°N)
    const oceanCovRes = await fetch(`${baseUrl}/api/datasets/coverage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: oceanRevJson.region,
        startDate: '2015-01-01',
        endDate: '2024-12-31',
        variableId: 'MODIS_NDVI',
      }),
    });
    assert.equal(oceanCovRes.status, 200);
    const oceanCovJson = (await oceanCovRes.json()) as {
      coverage: Array<{
        datasetId: string;
        surfaceApplicable: boolean;
        availableForRegion: boolean;
        suggestedAlternatives: Array<{ datasetId: string }>;
      }>;
    };
    const modisOcean = oceanCovJson.coverage.find((c) => c.datasetId === 'modis');
    const gldasOcean = oceanCovJson.coverage.find((c) => c.datasetId === 'gldas');
    assert.equal(modisOcean?.surfaceApplicable, false, 'MODIS must be flagged land-only over oceans');
    assert.equal(gldasOcean?.surfaceApplicable, false, 'GLDAS must be flagged land-only over oceans');
    assert.ok((modisOcean?.suggestedAlternatives.length ?? 0) > 0, 'Unavailable dataset must suggest valid alternatives');

    // Ocean GWETROOT soil moisture retrieval must fail honestly rather than substituting data
    const oceanSoilRes = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'nasa-power',
        variableId: 'GWETROOT',
        region: oceanRevJson.region,
        startDate: '2020-01-01',
        endDate: '2023-12-31',
        aggregation: 'monthly',
        mode: 'live',
      }),
    });
    const oceanSoilJson = (await oceanSoilRes.json()) as { retrievalStatus: string };
    assert.equal(oceanSoilJson.retrievalStatus, 'unavailable', 'Land-only GWETROOT must be unavailable over ocean');

    // Arctic Svalbard (78.22°N) GPM IMERG latitude coverage & pre-1998 temporal coverage check
    const arcticRegion = {
      id: 'svalbard',
      name: 'Svalbard',
      displayName: 'Longyearbyen, Svalbard, Norway',
      country: 'Norway',
      lat: 78.2232,
      lon: 15.6267,
      bbox: [14.5, 77.7, 16.7, 78.7],
      isOcean: false,
    };
    const arcticCovRes = await fetch(`${baseUrl}/api/datasets/coverage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: arcticRegion,
        startDate: '1990-01-01',
        endDate: '1995-12-31',
        variableId: 'GPM_PRECIP',
      }),
    });
    const arcticCovJson = (await arcticCovRes.json()) as {
      coverage: Array<{ datasetId: string; spatialCovered: boolean; temporalCovered: boolean }>;
    };
    const imergArctic = arcticCovJson.coverage.find((c) => c.datasetId === 'gpm-imerg');
    assert.equal(imergArctic?.spatialCovered, false, 'GPM IMERG covers 60°S–60°N and excludes 78.22°N Svalbard');
    assert.equal(imergArctic?.temporalCovered, false, 'GPM IMERG historical record begins 1998-01-01');

    // E. Retrieve live NASA POWER T2M across all required diverse worldwide locations & custom Polygon/BBox
    const globalTestRegions = [
      { name: 'Shivamogga, India', lat: 13.9299, lon: 75.5681, isOcean: false },
      { name: 'New York, USA', lat: 40.7128, lon: -74.006, isOcean: false },
      { name: 'London, UK', lat: 51.5074, lon: -0.1278, isOcean: false },
      { name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, isOcean: false },
      { name: 'Amazon Rainforest, Brazil', lat: -3.4653, lon: -62.2159, isOcean: false },
      { name: 'Sahara Desert, Africa', lat: 23.4162, lon: 11.2422, isOcean: false },
      { name: 'Atlantic Ocean', lat: 0.0, lon: -30.0, isOcean: true },
      {
        name: 'Custom Iberian Polygon',
        lat: 40.0,
        lon: -4.0,
        bbox: [-6.0, 38.0, -2.0, 42.0] as [number, number, number, number],
        polygon: [
          [-6.0, 38.0],
          [-2.0, 38.0],
          [-2.0, 42.0],
          [-6.0, 42.0],
        ] as Array<[number, number]>,
        isOcean: false,
      },
    ];

    const regionMeans: Record<string, number> = {};
    for (const loc of globalTestRegions) {
      const rRes = await fetch(`${baseUrl}/api/data/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: 'nasa-power',
          variableId: 'T2M',
          region: {
            id: loc.name,
            name: loc.name,
            displayName: loc.name,
            country: 'Global Test',
            lat: loc.lat,
            lon: loc.lon,
            bbox: loc.bbox ?? [loc.lon - 0.3, loc.lat - 0.3, loc.lon + 0.3, loc.lat + 0.3],
            polygon: loc.polygon,
            isOcean: loc.isOcean,
          },
          startDate: '2020-01-01',
          endDate: '2024-12-31',
          aggregation: 'monthly',
          mode: 'live',
        }),
      });
      assert.equal(rRes.status, 200, `Live retrieval HTTP 200 failed for ${loc.name}`);
      const rJson = (await rRes.json()) as {
        retrievalStatus: string;
        validObservations: number;
        summary: { mean: number | null };
        spatialSampling?: { method: string; sampleCount: number };
      };
      assert.equal(rJson.retrievalStatus, 'success', `Expected live NASA POWER T2M success for ${loc.name}`);
      assert.ok(rJson.validObservations >= 48, `Expected >=48 valid monthly points for ${loc.name}`);
      assert.ok(rJson.summary.mean !== null, `Mean must be populated for ${loc.name}`);
      regionMeans[loc.name] = rJson.summary.mean!;
      if (loc.polygon) {
        assert.equal(rJson.spatialSampling?.method, 'polygon-mean', 'Polygon region must use polygon-mean sampling');
        assert.ok((rJson.spatialSampling?.sampleCount ?? 0) > 1, 'Polygon should sample multiple points');
      }
      console.log(`  - ${loc.name}: ${rJson.validObservations} live pts, mean T2M = ${rJson.summary.mean!.toFixed(2)} °C (${rJson.spatialSampling?.method})`);
    }

    // Verify coordinates actually drive distinct NASA data (e.g. Amazon > 24°C while London < 14°C)
    assert.ok(
      regionMeans['Amazon Rainforest, Brazil'] - regionMeans['London, UK'] > 10,
      `Amazon (${regionMeans['Amazon Rainforest, Brazil']}) must be significantly warmer than London (${regionMeans['London, UK']})`,
    );

    console.log('✓ Global Worldwide Location Tests Passed (8+ regions verified).');
    console.log('4. Testing Phase 2 Scientific Validation, All 7 NASA Datasets, Aggregations & Grounded AI...');

    // 4A. Verify all 7 NASA datasets expose productVersion, apiEndpoint, CMR metadata & granule counts
    const auditDsRes = await fetch(`${baseUrl}/api/datasets`);
    const auditDsJson = (await auditDsRes.json()) as {
      datasets: Array<{
        id: string;
        productId: string;
        productVersion: string;
        apiEndpoint: string;
        status: string;
        cmrConceptId?: string;
        cmrGranuleCount?: number;
      }>;
    };
    for (const ds of auditDsJson.datasets) {
      assert.ok(Boolean(ds.productVersion), `${ds.id} must declare productVersion`);
      assert.ok(Boolean(ds.apiEndpoint), `${ds.id} must declare apiEndpoint`);
      if (ds.id === 'nasa-power') {
        assert.equal(ds.status, 'operational', 'NASA POWER live endpoint must be operational');
      } else {
        assert.ok(Boolean(ds.cmrConceptId), `${ds.id} (${ds.productId}) must resolve live CMR conceptId`);
        assert.ok((ds.cmrGranuleCount ?? 0) > 0, `${ds.id} (${ds.productId}) must discover >0 CMR granules`);
      }
      console.log(
        `  - Audited ${ds.id} (${ds.productId} v${ds.productVersion}): status=${ds.status}, granules=${ds.cmrGranuleCount ?? 'Direct API'}`,
      );
    }

    // 4B. Verify all 6 Earthdata CMR collections return real CMR granule provenance + honest auth-required when no token
    const cmrCollectionsToTest: Array<{ datasetId: string; variableId: string }> = [
      { datasetId: 'merra2', variableId: 'MERRA2_T2M' },
      { datasetId: 'gpm-imerg', variableId: 'GPM_PRECIP' },
      { datasetId: 'modis', variableId: 'MODIS_NDVI' },
      { datasetId: 'airs', variableId: 'AIRS_TSURF' },
      { datasetId: 'omi', variableId: 'OMI_O3' },
      { datasetId: 'gldas', variableId: 'GLDAS_SOILM' },
    ];
    for (const spec of cmrCollectionsToTest) {
      const cRes = await fetch(`${baseUrl}/api/data/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: spec.datasetId,
          variableId: spec.variableId,
          region: regJson.regions[0],
          startDate: '2023-01-01',
          endDate: '2023-12-31',
          aggregation: 'monthly',
          mode: 'live',
        }),
      });
      assert.equal(cRes.status, 200);
      const cJson = (await cRes.json()) as {
        retrievalStatus: string;
        productVersion?: string;
        endpointUrl?: string;
        coverageStatus?: { granulesDiscovered?: number; sampleGranules?: Array<{ title: string }> };
      };
      assert.equal(cJson.retrievalStatus, 'auth-required', `${spec.datasetId} must enforce auth-required honestly`);
      assert.ok(Boolean(cJson.productVersion), `${spec.datasetId} must carry productVersion`);
      assert.ok(
        (cJson.coverageStatus?.sampleGranules?.length ?? 0) > 0,
        `${spec.datasetId} CMR search must discover real sampleGranules in 2023`,
      );
    }

    // 4C. Invalid geographic coordinates validation (must return 400)
    const badCoordRet = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'nasa-power',
        variableId: 'T2M',
        region: { name: 'OutOfBounds', displayName: 'OutOfBounds', country: 'X', lat: 95, lon: 200 },
        startDate: '2020-01-01',
        endDate: '2023-12-31',
        aggregation: 'monthly',
        mode: 'live',
      }),
    });
    assert.equal(badCoordRet.status, 400, 'Invalid lat=95, lon=200 must return HTTP 400');

    const badRevRes = await fetch(`${baseUrl}/api/regions/reverse?lat=-120&lon=10`);
    assert.equal(badRevRes.status, 400, 'Invalid reverse geocode latitude must return HTTP 400');

    // 4D. Daily and Annual aggregations & additional live NASA POWER variables (PRECTOTCORR, RH2M)
    const dailyRes = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'nasa-power',
        variableId: 'PRECTOTCORR',
        region: regJson.regions[0],
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        aggregation: 'daily',
        mode: 'live',
      }),
    });
    assert.equal(dailyRes.status, 200);
    const dailyJson = (await dailyRes.json()) as {
      retrievalStatus: string;
      validObservations: number;
      endpointUrl?: string;
    };
    assert.equal(dailyJson.retrievalStatus, 'success');
    assert.ok(dailyJson.validObservations >= 360, `Expected >=360 daily precip obs, got ${dailyJson.validObservations}`);
    assert.ok(dailyJson.endpointUrl?.includes('/temporal/daily/point'));

    const annualRes = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'nasa-power',
        variableId: 'RH2M',
        region: regJson.regions[0],
        startDate: '2010-01-01',
        endDate: '2024-12-31',
        aggregation: 'annual',
        mode: 'live',
      }),
    });
    assert.equal(annualRes.status, 200);
    const annualJson = (await annualRes.json()) as {
      retrievalStatus: string;
      validObservations: number;
    };
    assert.equal(annualJson.retrievalStatus, 'success');
    assert.ok(annualJson.validObservations >= 14, `Expected >=14 annual RH2M points, got ${annualJson.validObservations}`);

    // 4E. Regional BBox cosine-latitude area-weighted multi-point sampling
    const highLatBboxRes = await fetch(`${baseUrl}/api/data/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'nasa-power',
        variableId: 'T2M',
        region: {
          id: 'svalbard-bbox',
          name: 'Svalbard Box',
          displayName: 'Svalbard Box',
          country: 'Norway',
          lat: 78.0,
          lon: 15.5,
          bbox: [14.0, 77.0, 17.0, 79.0],
          isOcean: false,
        },
        startDate: '2021-01-01',
        endDate: '2024-12-31',
        aggregation: 'monthly',
        mode: 'live',
      }),
    });
    assert.equal(highLatBboxRes.status, 200);
    const highLatBboxJson = (await highLatBboxRes.json()) as {
      retrievalStatus: string;
      endpointUrl?: string;
      productVersion?: string;
      spatialSampling?: {
        weightingMethod: string;
        sampleCount: number;
        sampledCoordinates: Array<{ meanValue?: number | null; weight?: number }>;
      };
    };
    assert.equal(highLatBboxJson.retrievalStatus, 'success');
    assert.equal(highLatBboxJson.spatialSampling?.weightingMethod, 'cosine-latitude-area-weighted');
    assert.ok((highLatBboxJson.spatialSampling?.sampleCount ?? 0) >= 5);
    assert.ok(highLatBboxJson.spatialSampling?.sampledCoordinates.every((c) => typeof c.meanValue === 'number'));

    // 4F. Grounded AI Assistant & Comparison Context
    const aiRes = await fetch(`${baseUrl}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Summarize what is changing and compare seasonal patterns with the Svalbard Box.',
        context: {
          retrieved: retJson,
          trend: trJson,
          comparisons: [
            {
              region: {
                id: 'svalbard-bbox',
                name: 'Svalbard Box',
                displayName: 'Svalbard Box',
                country: 'Norway',
                lat: 78.0,
                lon: 15.5,
                isOcean: false,
              },
              retrieved: highLatBboxJson,
              trend: trJson,
            },
          ],
        },
      }),
    });
    assert.equal(aiRes.status, 200);
    const aiJson = (await aiRes.json()) as {
      reply: string;
      mode: string;
      citations: string[];
      hasActiveContext: boolean;
    };
    assert.equal(aiJson.mode, 'evidence-based');
    assert.equal(aiJson.hasActiveContext, true);
    assert.ok(aiJson.citations.some((c) => c.includes('POWER_LARC_AG_RE_v9')));
    assert.ok(aiJson.reply.includes('Shivamogga') && aiJson.reply.includes('Svalbard Box'));

    // 4G. Verify CSV & HTML reports carry full Phase 2 provenance & seasonal visualizations
    assert.ok(csv.includes('# Product Version,'));
    assert.ok(csv.includes('# API Endpoint,'));
    assert.ok(csv.includes('# Seasonal Breakdown,'));
    assert.ok(html.includes('single-point') || html.includes('cosine-latitude-area-weighted'));
    assert.ok(html.includes('Seasonal Cycle'));
    const bboxHtml = generateHtmlReport({ retrieved: highLatBboxJson as never, trend: trJson as never });
    assert.ok(bboxHtml.includes('cosine-latitude-area-weighted'));

    console.log('✓ Phase 2 Scientific Validation, All 7 NASA Datasets, Aggregations & Grounded AI Tests Passed.');
  } finally {
    server.close();
  }
}

runUnitTests()
  .then(runApiTests)
  .then(() => {
    console.log('ALL TESTS PASSED SUCCESSFULLY.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('TEST FAILURE:', err);
    process.exit(1);
  });
