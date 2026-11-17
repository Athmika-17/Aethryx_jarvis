import type {
  AggregationPeriod,
  DatasetConnectorId,
  RegionLocation,
  TimeSeriesPoint,
} from '../src/types/earth.ts';

/**
 * Generates a clearly labeled DEMO / SIMULATED reference time series
 * calibrated dynamically to the selected geographical coordinates, latitude band,
 * and surface type (land vs. ocean) ONLY when Demo Mode is explicitly selected.
 * Never presented as live NASA observations.
 */
export function buildDemoTimeSeries(params: {
  datasetId: DatasetConnectorId;
  variableId: string;
  units: string;
  region: RegionLocation;
  startDate: string;
  endDate: string;
  aggregation: AggregationPeriod;
}): TimeSeriesPoint[] {
  const start = new Date(`${params.startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${params.endDate.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  let seed =
    Math.abs(Math.round(params.region.lat * 1000)) * 31 +
    Math.abs(Math.round(params.region.lon * 1000)) * 17 +
    params.variableId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const gaussian = () => {
    const u1 = Math.max(1e-6, nextRand());
    const u2 = nextRand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const absLat = Math.abs(params.region.lat);
  const latFactor = Math.cos((absLat * Math.PI) / 180);
  const isNorth = params.region.lat >= 0;
  const isTropics = absLat < 23.5;
  const isAridHint =
    /sahara|desert|arabia|atacama|gobi/i.test(params.region.displayName) ||
    params.region.featureType === 'desert';
  const points: TimeSeriesPoint[] = [];

  const cur = new Date(start.getTime());
  const maxPoints = params.aggregation === 'daily' ? 730 : 480;

  while (cur <= end && points.length < maxPoints) {
    const yr = cur.getUTCFullYear();
    const mo = cur.getUTCMonth() + 1;
    const dd = cur.getUTCDate();
    const tYr = yr + (mo - 1) / 12 - 2005;
    // Northern Hemisphere warmest in Jul, Southern Hemisphere warmest in Jan
    const warmPhase = isNorth ? 7 : 1;
    const seasonAngle = ((mo - warmPhase) / 12) * 2 * Math.PI;
    const wetSeason = isTropics
      ? Math.exp(-Math.pow((mo - (isNorth ? 7 : 2)) / 1.8, 2))
      : 0.5 + 0.5 * Math.cos(((mo - (isNorth ? 11 : 5)) / 12) * 2 * Math.PI);

    let val = 0;
    const noise = gaussian();

    switch (params.variableId) {
      case 'T2M':
      case 'T2M_MERRA2':
      case 'AIRS_TSURF':
      case 'GLDAS_TSURF': {
        const base = -8 + 35 * Math.pow(latFactor, 1.25);
        const amp = params.region.isOcean ? 2.5 : 3.5 + (absLat / 90) * 14;
        const polarAmpTrend = 0.025 + (absLat / 90) * 0.04;
        val = base + amp * Math.cos(seasonAngle) + polarAmpTrend * tYr + noise * 0.85;
        break;
      }
      case 'PRECTOTCORR': {
        const baseRain = isAridHint ? 0.15 : isTropics ? 4.8 : 2.2;
        const ampRain = isAridHint ? 0.25 : isTropics ? 6.5 : 1.6;
        val = Math.max(0.0, baseRain + ampRain * wetSeason + noise * (0.4 + 0.35 * ampRain));
        break;
      }
      case 'IMERG_PRECIP': {
        const baseMm = isAridHint ? 4 : isTropics ? 130 : 65;
        const ampMm = isAridHint ? 8 : isTropics ? 190 : 45;
        val = Math.max(0.0, baseMm + ampMm * wetSeason + noise * (12 + 0.2 * ampMm));
        break;
      }
      case 'MODIS_NDVI': {
        const baseNdvi = isAridHint ? 0.11 : isTropics ? 0.62 : 0.44;
        val = Math.max(
          0.02,
          Math.min(0.94, baseNdvi + 0.16 * Math.cos(seasonAngle) + 0.0018 * tYr + noise * 0.03),
        );
        break;
      }
      case 'MODIS_EVI': {
        const baseEvi = isAridHint ? 0.08 : isTropics ? 0.45 : 0.31;
        val = Math.max(
          0.02,
          Math.min(0.88, baseEvi + 0.13 * Math.cos(seasonAngle) + 0.0014 * tYr + noise * 0.025),
        );
        break;
      }
      case 'RH2M':
      case 'AIRS_RH': {
        const baseRh = params.region.isOcean ? 79 : isAridHint ? 28 : 62;
        val = Math.max(12, Math.min(98, baseRh + 14 * wetSeason + noise * 3.8));
        break;
      }
      case 'QV2M_MERRA2': {
        const baseQ = 3 + 14 * latFactor * (isAridHint ? 0.45 : 1.0);
        val = Math.max(1, baseQ + 3.5 * wetSeason + 0.04 * tYr + noise * 0.75);
        break;
      }
      case 'WS10M':
      case 'U10M_V10M': {
        const baseWind = params.region.isOcean ? 6.4 : 2.9;
        val = Math.max(0.5, baseWind + 1.4 * Math.cos(seasonAngle + Math.PI) + noise * 0.45);
        break;
      }
      case 'GWETROOT': {
        const baseWet = isAridHint ? 0.18 : 0.52;
        val = Math.max(0.08, Math.min(0.96, baseWet + 0.22 * wetSeason + noise * 0.04));
        break;
      }
      case 'GLDAS_SOIL_M': {
        const baseSm = isAridHint ? 95 : 260;
        val = Math.max(40, baseSm + 95 * wetSeason - 0.3 * tYr + noise * 14);
        break;
      }
      case 'GLDAS_EVAP': {
        const baseEv = isAridHint ? 12 : 75;
        val = Math.max(2, baseEv + 42 * wetSeason + 0.25 * tYr + noise * 6);
        break;
      }
      case 'OMI_OZONE': {
        const baseO3 = 255 + (absLat / 90) * 65;
        val = Math.max(180, baseO3 + 22 * Math.sin(((mo - 3) / 12) * 2 * Math.PI) + noise * 6.5);
        break;
      }
      case 'ALLSKY_SFC_SW_DWN': {
        const baseSol = 9 + 14 * latFactor;
        val = Math.max(1.5, baseSol + 5.5 * Math.cos(seasonAngle) + noise * 0.9);
        break;
      }
      case 'PS':
      case 'PS_MERRA2': {
        val = params.variableId === 'PS' ? 100.8 + 0.35 * Math.cos(seasonAngle) + noise * 0.14 : 1008 + 3.5 * Math.cos(seasonAngle) + noise * 1.4;
        break;
      }
      default: {
        val = 20 + 5 * Math.cos(seasonAngle) + noise;
      }
    }

    const isMissing = nextRand() < 0.02;
    const rounded = isMissing ? null : Number(val.toFixed(4));
    const dateStr =
      params.aggregation === 'daily'
        ? `${yr}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
        : params.aggregation === 'annual'
          ? `${yr}-01`
          : `${yr}-${String(mo).padStart(2, '0')}`;

    points.push({
      date: dateStr,
      timestamp: cur.getTime(),
      value: rounded,
      rawValue: rounded,
      unit: params.units,
      isMissing,
    });

    if (params.aggregation === 'daily') {
      cur.setUTCDate(cur.getUTCDate() + 1);
    } else if (params.aggregation === 'annual') {
      cur.setUTCFullYear(cur.getUTCFullYear() + 1);
    } else {
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  return points;
}
