import type {
  AggregationPeriod,
  AnomalyDetectionResult,
  AnomalyFinding,
  AnomalyMethod,
  DataMode,
  ForecastPoint,
  ForecastResult,
  SeasonalMonthStat,
  SeasonalQuarterStat,
  TimeSeriesPoint,
  TrendAnalysisResult,
  TrendClassification,
  YearOverYearRow,
} from '../src/types/earth.ts';

// --- Mathematical Distribution Helpers (Normal & Student's t) ---

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function twoTailedNormalP(z: number): number {
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return Math.max(0, Math.min(1, p));
}

function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zm1 = z - 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (zm1 + i);
  }
  const t = zm1 + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-10;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function twoTailedStudentTP(tStat: number, df: number): number {
  if (!Number.isFinite(tStat) || df <= 0) return 1;
  const x = df / (df + tStat * tStat);
  return Math.max(0, Math.min(1, regularizedIncompleteBeta(x, 0.5 * df, 0.5)));
}

export function tCritical95(df: number): number {
  if (df <= 1) return 12.706;
  if (df >= 120) return 1.96;
  // Bisection on twoTailedStudentTP(t, df) === 0.05
  let lo = 1.9;
  let hi = 13.0;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const p = twoTailedStudentTP(mid, df);
    if (p > 0.05) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// --- Summary & Helper Calculations ---

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function computeSummaryStats(points: TimeSeriesPoint[]) {
  const valid = points.filter((p) => !p.isMissing && p.value !== null && Number.isFinite(p.value));
  if (valid.length === 0) {
    return {
      latestValue: null,
      latestDate: null,
      mean: null,
      median: null,
      min: null,
      max: null,
      stdDev: null,
    };
  }
  const values = valid.map((p) => p.value as number);
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = values.reduce((acc, v) => acc + v, 0) / n;
  const variance =
    n > 1 ? values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (n - 1) : 0;
  const latest = valid[valid.length - 1];
  return {
    latestValue: Number(latest.value!.toFixed(4)),
    latestDate: latest.date,
    mean: Number(mean.toFixed(4)),
    median: Number(quantile(sorted, 0.5).toFixed(4)),
    min: Number(sorted[0].toFixed(4)),
    max: Number(sorted[n - 1].toFixed(4)),
    stdDev: Number(Math.sqrt(variance).toFixed(4)),
  };
}

function computeLag1Autocorrelation(values: number[]): number {
  if (values.length < 4) return 0;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    den += d * d;
    if (i > 0) {
      num += d * (values[i - 1] - mean);
    }
  }
  if (den === 0) return 0;
  return num / den;
}

function mannKendallBlock(values: number[]): { s: number; varS: number; n: number } {
  const n = values.length;
  if (n < 3) return { s: 0, varS: 0, n };
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i];
      if (diff > 0) s += 1;
      else if (diff < 0) s -= 1;
    }
  }

  // Tie correction
  const counts = new Map<number, number>();
  for (const v of values) {
    const rounded = Math.round(v * 1e6) / 1e6;
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  let tieTerm = 0;
  for (const t of counts.values()) {
    if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  return { s, varS, n };
}

function extractYearMonth(dateStr: string): { year: number; month: number } {
  const parts = dateStr.split('-').map((p) => Number.parseInt(p, 10));
  return {
    year: parts[0] || 2000,
    month: parts[1] || 1,
  };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTER_DEFS: Array<{ season: 'DJF' | 'MAM' | 'JJA' | 'SON'; label: string; months: number[] }> = [
  { season: 'DJF', label: 'Dec–Feb (Boreal Winter / Austral Summer)', months: [12, 1, 2] },
  { season: 'MAM', label: 'Mar–May (Boreal Spring / Pre-Monsoon)', months: [3, 4, 5] },
  { season: 'JJA', label: 'Jun–Aug (Boreal Summer / SW Monsoon)', months: [6, 7, 8] },
  { season: 'SON', label: 'Sep–Nov (Boreal Autumn / Post-Monsoon)', months: [9, 10, 11] },
];

function computeGroupSenSlope(pairs: Array<{ t: number; v: number }>): number | null {
  if (pairs.length < 3) return null;
  const slopes: number[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const dt = pairs[j].t - pairs[i].t;
      if (dt > 0.25) {
        slopes.push((pairs[j].v - pairs[i].v) / dt);
      }
    }
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  return Number(quantile(slopes, 0.5).toFixed(5));
}

function computeSeasonalBreakdown(
  valid: TimeSeriesPoint[],
  t0: number,
  msPerYear: number,
  aggregation: AggregationPeriod,
): { monthly: SeasonalMonthStat[]; quarters: SeasonalQuarterStat[] } {
  if (aggregation === 'annual') {
    return { monthly: [], quarters: [] };
  }

  const byMonth = new Map<number, Array<{ t: number; v: number; year: number }>>();
  for (const p of valid) {
    const { year, month } = extractYearMonth(p.date);
    const arr = byMonth.get(month) ?? [];
    arr.push({ t: (p.timestamp - t0) / msPerYear, v: p.value as number, year });
    byMonth.set(month, arr);
  }

  const monthly: SeasonalMonthStat[] = MONTH_LABELS.map((label, idx) => {
    const month = idx + 1;
    const entries = byMonth.get(month) ?? [];
    if (entries.length === 0) {
      return {
        month,
        label,
        validYears: 0,
        mean: null,
        min: null,
        max: null,
        stdDev: null,
        slopePerYear: null,
      };
    }
    const vals = entries.map((e) => e.v);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.length > 1 ? vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1) : 0;
    const distinctYears = new Set(entries.map((e) => e.year)).size;

    // Average per year first if daily aggregation so Sen slope compares annual month means cleanly
    const yearlyBuckets = new Map<number, { tSum: number; vSum: number; count: number }>();
    for (const e of entries) {
      const b = yearlyBuckets.get(e.year) ?? { tSum: 0, vSum: 0, count: 0 };
      b.tSum += e.t;
      b.vSum += e.v;
      b.count += 1;
      yearlyBuckets.set(e.year, b);
    }
    const yearlyPairs = Array.from(yearlyBuckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => ({ t: b.tSum / b.count, v: b.vSum / b.count }));

    return {
      month,
      label,
      validYears: distinctYears,
      mean: Number(mean.toFixed(4)),
      min: Number(Math.min(...vals).toFixed(4)),
      max: Number(Math.max(...vals).toFixed(4)),
      stdDev: Number(Math.sqrt(variance).toFixed(4)),
      slopePerYear: computeGroupSenSlope(yearlyPairs),
    };
  });

  const quarters: SeasonalQuarterStat[] = QUARTER_DEFS.map((qDef) => {
    const entries: Array<{ t: number; v: number; climYear: number }> = [];
    for (const p of valid) {
      const { year, month } = extractYearMonth(p.date);
      if (!qDef.months.includes(month)) continue;
      // Group Dec with Jan-Feb of the following year for coherent seasonal winter tracking
      const climYear = qDef.season === 'DJF' && month === 12 ? year + 1 : year;
      entries.push({ t: (p.timestamp - t0) / msPerYear, v: p.value as number, climYear });
    }
    if (entries.length === 0) {
      return {
        season: qDef.season,
        label: qDef.label,
        validObs: 0,
        mean: null,
        min: null,
        max: null,
        stdDev: null,
        slopePerYear: null,
      };
    }
    const vals = entries.map((e) => e.v);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.length > 1 ? vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1) : 0;

    const seasonYearBuckets = new Map<number, { tSum: number; vSum: number; count: number }>();
    for (const e of entries) {
      const b = seasonYearBuckets.get(e.climYear) ?? { tSum: 0, vSum: 0, count: 0 };
      b.tSum += e.t;
      b.vSum += e.v;
      b.count += 1;
      seasonYearBuckets.set(e.climYear, b);
    }
    const seasonPairs = Array.from(seasonYearBuckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => ({ t: b.tSum / b.count, v: b.vSum / b.count }));

    return {
      season: qDef.season,
      label: qDef.label,
      validObs: entries.length,
      mean: Number(mean.toFixed(4)),
      min: Number(Math.min(...vals).toFixed(4)),
      max: Number(Math.max(...vals).toFixed(4)),
      stdDev: Number(Math.sqrt(variance).toFixed(4)),
      slopePerYear: computeGroupSenSlope(seasonPairs),
    };
  });

  return { monthly, quarters };
}

// --- Core Trend Detective Engine ---

export function runTrendAnalysis(params: {
  points: TimeSeriesPoint[];
  variableId: string;
  variableName: string;
  units: string;
  datasetName: string;
  productId: string;
  aggregation: AggregationPeriod;
  mode: DataMode;
  isSimulated: boolean;
  alpha?: number;
}): TrendAnalysisResult {
  const alpha = params.alpha ?? 0.05;
  const allPoints = params.points;
  const valid = allPoints.filter((p) => !p.isMissing && p.value !== null && Number.isFinite(p.value));
  const missingObservations = allPoints.length - valid.length;

  const startDate = valid[0]?.date ?? allPoints[0]?.date ?? '';
  const endDate = valid[valid.length - 1]?.date ?? allPoints[allPoints.length - 1]?.date ?? '';

  if (valid.length < 6) {
    return {
      variableId: params.variableId,
      variableName: params.variableName,
      units: params.units,
      datasetName: params.datasetName,
      productId: params.productId,
      mode: params.mode,
      isSimulated: params.isSimulated,
      alpha,
      nObservations: allPoints.length,
      validObservations: valid.length,
      missingObservations,
      startDate,
      endDate,
      durationYears: 0,
      linearRegression: {
        slopePerYear: 0,
        slopePerStep: 0,
        intercept: 0,
        rSquared: 0,
        standardErrorPerYear: 0,
        tStatistic: 0,
        pValue: 1,
        ci95LowerPerYear: 0,
        ci95UpperPerYear: 0,
      },
      mannKendall: {
        sStatistic: 0,
        varianceS: 0,
        zStatistic: 0,
        pValue: 1,
        tau: 0,
        method: 'standard',
        significant: false,
        lag1Autocorrelation: 0,
        autocorrelationNote: null,
      },
      sensSlope: {
        slopePerYear: 0,
        intercept: 0,
        ci95LowerPerYear: 0,
        ci95UpperPerYear: 0,
      },
      classification: 'insufficient-evidence',
      seasonalAdjusted: false,
      yearOverYear: [],
      diagnostics: {
        outliersDetected: 0,
        missingFraction: allPoints.length > 0 ? missingObservations / allPoints.length : 1,
        assumptions: ['Minimum 6 valid observations (and >= 12 for long-term trend inference) required.'],
        limitations: ['Sample size is too small to perform reliable regression or Mann-Kendall testing.'],
        scientificSummary: `Insufficient evidence: only ${valid.length} valid observation(s) available.`,
      },
      series: allPoints,
    };
  }

  // Time coordinate in fractional years since first valid observation
  const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;
  const t0 = valid[0].timestamp;
  const tYears = valid.map((p) => (p.timestamp - t0) / MS_PER_YEAR);
  const durationYears = Math.max(0.01, tYears[tYears.length - 1] - tYears[0]);
  const rawValues = valid.map((p) => p.value as number);

  // Seasonal baseline by calendar month when monthly/daily & duration >= 2 years
  const useSeasonal = params.aggregation !== 'annual' && durationYears >= 2 && valid.length >= 24;
  const monthGroups = new Map<number, number[]>();
  if (useSeasonal) {
    for (const p of valid) {
      const { month } = extractYearMonth(p.date);
      const arr = monthGroups.get(month) ?? [];
      arr.push(p.value as number);
      monthGroups.set(month, arr);
    }
  }
  const monthMeans = new Map<number, number>();
  for (const [m, arr] of monthGroups.entries()) {
    monthMeans.set(m, arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  const globalMean = rawValues.reduce((a, b) => a + b, 0) / rawValues.length;

  // Deseasonalized series preserves long-term mean while removing monthly climatology
  const analysisValues = valid.map((p) => {
    const v = p.value as number;
    if (!useSeasonal) return v;
    const { month } = extractYearMonth(p.date);
    const mMean = monthMeans.get(month) ?? globalMean;
    return v - mMean + globalMean;
  });

  // --- 1. Ordinary Least Squares Linear Regression on (tYears, analysisValues) ---
  const n = valid.length;
  const meanX = tYears.reduce((a, b) => a + b, 0) / n;
  const meanY = analysisValues.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = tYears[i] - meanX;
    const dy = analysisValues[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const slopePerYear = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slopePerYear * meanX;

  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slopePerYear * tYears[i];
    const resid = analysisValues[i] - pred;
    sse += resid * resid;
  }

  const rSquared = syy > 0 ? Math.max(0, Math.min(1, 1 - sse / syy)) : 0;
  const df = Math.max(1, n - 2);
  const sResidual = Math.sqrt(sse / df);
  const seSlope = sxx > 0 ? sResidual / Math.sqrt(sxx) : 0;
  const tStatistic = seSlope > 0 ? slopePerYear / seSlope : 0;
  const regPValue = twoTailedStudentTP(tStatistic, df);
  const tCrit = tCritical95(df);
  const ci95LowerPerYear = slopePerYear - tCrit * seSlope;
  const ci95UpperPerYear = slopePerYear + tCrit * seSlope;

  // --- 2. Mann-Kendall Test (Seasonal when monthly >= 24 obs, else Standard) ---
  let mkS = 0;
  let mkVarS = 0;
  let mkMethod: 'standard' | 'seasonal' = 'standard';
  let totalPairs = (n * (n - 1)) / 2;

  if (useSeasonal && params.aggregation === 'monthly') {
    mkMethod = 'seasonal';
    const byMonth = new Map<number, number[]>();
    for (const p of valid) {
      const { month } = extractYearMonth(p.date);
      const arr = byMonth.get(month) ?? [];
      arr.push(p.value as number);
      byMonth.set(month, arr);
    }
    let seasonalPairs = 0;
    for (const arr of byMonth.values()) {
      if (arr.length >= 3) {
        const block = mannKendallBlock(arr);
        mkS += block.s;
        mkVarS += block.varS;
        seasonalPairs += (arr.length * (arr.length - 1)) / 2;
      }
    }
    if (seasonalPairs > 0) totalPairs = seasonalPairs;
  } else {
    const block = mannKendallBlock(analysisValues);
    mkS = block.s;
    mkVarS = block.varS;
  }

  let mkZ = 0;
  if (mkVarS > 0) {
    if (mkS > 0) mkZ = (mkS - 1) / Math.sqrt(mkVarS);
    else if (mkS < 0) mkZ = (mkS + 1) / Math.sqrt(mkVarS);
  }
  const mkPValue = twoTailedNormalP(mkZ);
  const mkTau = totalPairs > 0 ? mkS / totalPairs : 0;
  const mkSignificant = mkPValue < alpha && valid.length >= 10;

  // Autocorrelation check on residuals
  const residuals = analysisValues.map((y, i) => y - (intercept + slopePerYear * tYears[i]));
  const lag1Ac = computeLag1Autocorrelation(residuals);
  const acThreshold = 1.96 / Math.sqrt(n);
  const autocorrelationNote =
    Math.abs(lag1Ac) > acThreshold
      ? `Significant lag-1 residual autocorrelation (r₁ = ${lag1Ac.toFixed(3)}) detected; unadjusted p-values may overstate significance.`
      : null;

  // --- 3. Sen's Slope Estimator (and 95% CI) ---
  const pairwiseSlopes: number[] = [];
  if (mkMethod === 'seasonal') {
    const byMonthPts = new Map<number, Array<{ t: number; v: number }>>();
    for (let i = 0; i < valid.length; i++) {
      const { month } = extractYearMonth(valid[i].date);
      const arr = byMonthPts.get(month) ?? [];
      arr.push({ t: tYears[i], v: rawValues[i] });
      byMonthPts.set(month, arr);
    }
    for (const arr of byMonthPts.values()) {
      for (let i = 0; i < arr.length - 1; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const dt = arr[j].t - arr[i].t;
          if (dt > 0.001) {
            pairwiseSlopes.push((arr[j].v - arr[i].v) / dt);
          }
        }
      }
    }
  } else {
    // Subsample evenly if extremely large daily dataset (>800 pts) to keep O(N^2) fast & bounded
    const step = n > 800 ? Math.ceil(n / 800) : 1;
    for (let i = 0; i < n - 1; i += step) {
      for (let j = i + 1; j < n; j += step) {
        const dt = tYears[j] - tYears[i];
        if (dt > 0.0001) {
          pairwiseSlopes.push((analysisValues[j] - analysisValues[i]) / dt);
        }
      }
    }
  }

  pairwiseSlopes.sort((a, b) => a - b);
  const mSlopes = pairwiseSlopes.length;
  const sensSlopePerYear = mSlopes > 0 ? quantile(pairwiseSlopes, 0.5) : slopePerYear;
  const sensIntercept =
    quantile(
      analysisValues.map((y, i) => y - sensSlopePerYear * tYears[i]).sort((a, b) => a - b),
      0.5,
    ) || intercept;

  const cAlpha = 1.96 * Math.sqrt(Math.max(0, mkVarS));
  let sensCiLow = ci95LowerPerYear;
  let sensCiHigh = ci95UpperPerYear;
  if (mSlopes >= 10 && cAlpha > 0) {
    const m1 = Math.max(0, Math.floor((mSlopes - cAlpha) / 2));
    const m2 = Math.min(mSlopes - 1, Math.ceil((mSlopes + cAlpha) / 2));
    sensCiLow = pairwiseSlopes[m1];
    sensCiHigh = pairwiseSlopes[m2];
  }

  // --- 4. Classification (Strict Scientific Honesty) ---
  let classification: TrendClassification = 'no-significant-trend';
  if (valid.length < 12 || durationYears < 1) {
    classification = 'insufficient-evidence';
  } else if (mkSignificant) {
    classification = sensSlopePerYear > 0 ? 'increasing' : sensSlopePerYear < 0 ? 'decreasing' : 'no-significant-trend';
  } else {
    classification = 'no-significant-trend';
  }

  // --- 5. Year-over-Year Summary ---
  const byYear = new Map<number, number[]>();
  for (const p of valid) {
    const { year } = extractYearMonth(p.date);
    const arr = byYear.get(year) ?? [];
    arr.push(p.value as number);
    byYear.set(year, arr);
  }
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => a - b);
  const yearOverYear: YearOverYearRow[] = sortedYears.map((yr, idx) => {
    const arr = byYear.get(yr)!;
    const yrMean = arr.reduce((a, b) => a + b, 0) / arr.length;
    let changeFromPrevious: number | null = null;
    let percentChange: number | null = null;
    if (idx > 0) {
      const prevArr = byYear.get(sortedYears[idx - 1])!;
      const prevMean = prevArr.reduce((a, b) => a + b, 0) / prevArr.length;
      changeFromPrevious = Number((yrMean - prevMean).toFixed(4));
      if (Math.abs(prevMean) > 1e-6) {
        percentChange = Number((((yrMean - prevMean) / Math.abs(prevMean)) * 100).toFixed(2));
      }
    }
    return {
      year: yr,
      mean: Number(yrMean.toFixed(4)),
      validMonths: arr.length,
      changeFromPrevious,
      percentChange,
    };
  });

  // --- 6. Outlier Diagnostic ---
  const sortedAnalysis = [...analysisValues].sort((a, b) => a - b);
  const q1 = quantile(sortedAnalysis, 0.25);
  const q3 = quantile(sortedAnalysis, 0.75);
  const iqr = q3 - q1;
  const outliersDetected = analysisValues.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;

  // --- 7. Enrich Full Series with Regression Fit & 95% Mean Confidence Band ---
  const enrichedSeries: TimeSeriesPoint[] = allPoints.map((pt) => {
    const tYr = (pt.timestamp - t0) / MS_PER_YEAR;
    const fit = intercept + slopePerYear * tYr;
    const seMeanFit =
      sResidual * Math.sqrt(1 / n + (sxx > 0 ? Math.pow(tYr - meanX, 2) / sxx : 0));
    const band = tCrit * seMeanFit;
    const { month } = extractYearMonth(pt.date);
    const seasonalBaseline = useSeasonal ? (monthMeans.get(month) ?? globalMean) : null;
    const deseasonalizedValue =
      !pt.isMissing && pt.value !== null && useSeasonal && seasonalBaseline !== null
        ? Number((pt.value - seasonalBaseline + globalMean).toFixed(4))
        : pt.value;

    return {
      ...pt,
      seasonalBaseline: seasonalBaseline !== null ? Number(seasonalBaseline.toFixed(4)) : null,
      deseasonalizedValue,
      regressionFit: Number(fit.toFixed(4)),
      ciLower: Number((fit - band).toFixed(4)),
      ciUpper: Number((fit + band).toFixed(4)),
    };
  });

  const avgStepYears = durationYears / Math.max(1, n - 1);
  const slopePerStep = slopePerYear * avgStepYears;

  const missingFraction = allPoints.length > 0 ? missingObservations / allPoints.length : 0;
  const assumptions = [
    mkMethod === 'seasonal'
      ? 'Seasonal Mann-Kendall (Hirsch-Slack) evaluates monotonic trends within each calendar month separately to control for annual seasonality.'
      : 'Standard Mann-Kendall evaluates monotonic rank correlation across the full series.',
    'Sen\'s slope provides a non-parametric median rate of change resistant to isolated extreme values.',
    `Significance threshold set at alpha = ${alpha} (two-tailed).`,
  ];
  const limitations: string[] = [];
  if (missingFraction > 0.05) {
    limitations.push(`${(missingFraction * 100).toFixed(1)}% of requested timestamps have missing observations.`);
  }
  if (autocorrelationNote) limitations.push(autocorrelationNote);
  if (durationYears < 10) {
    limitations.push(`Record length (${durationYears.toFixed(1)} years) is shorter than a standard 30-year climate normal; interannual variability (e.g., ENSO/monsoon cycles) can influence slope.`);
  }
  limitations.push('Statistical trend detection establishes historical change, not physical causation.');

  let scientificSummary = '';
  if (classification === 'insufficient-evidence') {
    scientificSummary = `Insufficient evidence to establish a multi-year trend (${valid.length} valid observations over ${durationYears.toFixed(1)} years).`;
  } else if (classification === 'no-significant-trend') {
    scientificSummary = `No statistically significant monotonic trend detected at alpha = ${alpha} (Mann-Kendall p = ${mkPValue.toFixed(4)}, Sen's slope = ${sensSlopePerYear >= 0 ? '+' : ''}${sensSlopePerYear.toFixed(4)} ${params.units}/yr). Absence of statistical significance does not prove zero physical change.`;
  } else {
    scientificSummary = `Statistically significant ${classification} trend detected at alpha = ${alpha} (Mann-Kendall Z = ${mkZ.toFixed(2)}, p = ${mkPValue < 0.0001 ? '< 0.0001' : mkPValue.toFixed(4)}). Sen's slope estimates ${sensSlopePerYear >= 0 ? '+' : ''}${sensSlopePerYear.toFixed(4)} ${params.units}/yr (95% CI: [${sensCiLow.toFixed(4)}, ${sensCiHigh.toFixed(4)}]).`;
  }

  return {
    variableId: params.variableId,
    variableName: params.variableName,
    units: params.units,
    datasetName: params.datasetName,
    productId: params.productId,
    mode: params.mode,
    isSimulated: params.isSimulated,
    alpha,
    nObservations: allPoints.length,
    validObservations: valid.length,
    missingObservations,
    startDate,
    endDate,
    durationYears: Number(durationYears.toFixed(2)),
    linearRegression: {
      slopePerYear: Number(slopePerYear.toFixed(5)),
      slopePerStep: Number(slopePerStep.toFixed(5)),
      intercept: Number(intercept.toFixed(4)),
      rSquared: Number(rSquared.toFixed(4)),
      standardErrorPerYear: Number(seSlope.toFixed(5)),
      tStatistic: Number(tStatistic.toFixed(3)),
      pValue: Number(regPValue.toFixed(6)),
      ci95LowerPerYear: Number(ci95LowerPerYear.toFixed(5)),
      ci95UpperPerYear: Number(ci95UpperPerYear.toFixed(5)),
    },
    mannKendall: {
      sStatistic: mkS,
      varianceS: Number(mkVarS.toFixed(2)),
      zStatistic: Number(mkZ.toFixed(3)),
      pValue: Number(mkPValue.toFixed(6)),
      tau: Number(mkTau.toFixed(4)),
      method: mkMethod,
      significant: mkSignificant,
      lag1Autocorrelation: Number(lag1Ac.toFixed(4)),
      autocorrelationNote,
    },
    sensSlope: {
      slopePerYear: Number(sensSlopePerYear.toFixed(5)),
      intercept: Number(sensIntercept.toFixed(4)),
      ci95LowerPerYear: Number(sensCiLow.toFixed(5)),
      ci95UpperPerYear: Number(sensCiHigh.toFixed(5)),
    },
    classification,
    seasonalAdjusted: useSeasonal,
    yearOverYear,
    seasonalBreakdown: computeSeasonalBreakdown(valid, t0, MS_PER_YEAR, params.aggregation),
    diagnostics: {
      outliersDetected,
      missingFraction: Number(missingFraction.toFixed(4)),
      assumptions,
      limitations,
      scientificSummary,
    },
    series: enrichedSeries,
  };
}

// --- Transparent Anomaly Detection Engine ---

export function detectAnomalies(params: {
  points: TimeSeriesPoint[];
  units: string;
  method?: AnomalyMethod;
  threshold?: number;
  mode: DataMode;
  isSimulated: boolean;
}): AnomalyDetectionResult {
  const method = params.method ?? 'seasonal-z-score';
  const threshold = params.threshold ?? (method === 'iqr' ? 1.5 : 2.0);
  const valid = params.points.filter((p) => !p.isMissing && p.value !== null && Number.isFinite(p.value));

  if (valid.length < 8) {
    return {
      method,
      threshold,
      units: params.units,
      mode: params.mode,
      isSimulated: params.isSimulated,
      totalValidObservations: valid.length,
      anomalyCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      anomalies: [],
      baselineSeries: [],
      limitations: ['At least 8 valid observations are required to compute statistical anomaly baselines.'],
    };
  }

  const values = valid.map((p) => p.value as number);
  const globalMean = values.reduce((a, b) => a + b, 0) / values.length;
  const globalSd = Math.sqrt(
    values.reduce((a, b) => a + (b - globalMean) ** 2, 0) / Math.max(1, values.length - 1),
  );

  // Month climatology for seasonal-z-score
  const byMonth = new Map<number, number[]>();
  for (const p of valid) {
    const { month } = extractYearMonth(p.date);
    const arr = byMonth.get(month) ?? [];
    arr.push(p.value as number);
    byMonth.set(month, arr);
  }
  const monthStats = new Map<number, { mean: number; sd: number; n: number }>();
  for (const [m, arr] of byMonth.entries()) {
    const mMean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const mSd =
      arr.length > 1
        ? Math.sqrt(arr.reduce((a, b) => a + (b - mMean) ** 2, 0) / (arr.length - 1))
        : globalSd;
    monthStats.set(m, { mean: mMean, sd: mSd > 1e-6 ? mSd : globalSd, n: arr.length });
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const medianVal = quantile(sorted, 0.5);

  const anomalies: AnomalyFinding[] = [];
  const baselineSeries: AnomalyDetectionResult['baselineSeries'] = [];

  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const obs = p.value as number;
    let baseline = globalMean;
    let upperBand = globalMean + threshold * globalSd;
    let lowerBand = globalMean - threshold * globalSd;
    let zScore: number | null = globalSd > 1e-6 ? (obs - globalMean) / globalSd : 0;
    let isFlagged = false;
    let reason = '';
    let confidenceNote = '';

    if (method === 'seasonal-z-score') {
      const { month } = extractYearMonth(p.date);
      const st = monthStats.get(month) ?? { mean: globalMean, sd: globalSd, n: valid.length };
      baseline = st.mean;
      const effSd = st.sd > 1e-6 ? st.sd : Math.max(1e-4, globalSd);
      zScore = (obs - baseline) / effSd;
      upperBand = baseline + threshold * effSd;
      lowerBand = baseline - threshold * effSd;
      isFlagged = Math.abs(zScore) >= threshold;
      reason = `Observed ${obs.toFixed(2)} ${params.units} deviated by ${(obs - baseline >= 0 ? '+' : '')}${(obs - baseline).toFixed(2)} ${params.units} (${zScore.toFixed(2)}σ) from the month-${String(month).padStart(2, '0')} historical baseline (${baseline.toFixed(2)} ${params.units}).`;
      confidenceNote = st.n < 5 ? `Low climatology sample size for month ${month} (n=${st.n}).` : `Based on ${st.n} historical observations for calendar month ${month}.`;
    } else if (method === 'z-score') {
      baseline = globalMean;
      zScore = globalSd > 1e-6 ? (obs - globalMean) / globalSd : 0;
      isFlagged = Math.abs(zScore) >= threshold;
      reason = `Observed ${obs.toFixed(2)} ${params.units} stands ${zScore.toFixed(2)} standard deviations from the series mean (${globalMean.toFixed(2)} ${params.units}).`;
      confidenceNote = 'Global Z-score assumes approximate normality and does not separate seasonal cycles.';
    } else if (method === 'iqr') {
      baseline = medianVal;
      upperBand = q3 + threshold * iqr;
      lowerBand = q1 - threshold * iqr;
      zScore = iqr > 1e-6 ? (obs - medianVal) / (iqr / 1.349) : null;
      isFlagged = obs > upperBand || obs < lowerBand;
      reason = `Observed ${obs.toFixed(2)} ${params.units} lies outside the [${lowerBand.toFixed(2)}, ${upperBand.toFixed(2)}] ${params.units} Tukey IQR fence (Q1=${q1.toFixed(2)}, Q3=${q3.toFixed(2)}).`;
      confidenceNote = 'Non-parametric IQR fence is resistant to skewed tails.';
    } else {
      // moving-average (window of 12 observations)
      const wStart = Math.max(0, i - 6);
      const wEnd = Math.min(valid.length - 1, i + 6);
      const winVals: number[] = [];
      for (let k = wStart; k <= wEnd; k++) {
        if (k !== i) winVals.push(valid[k].value as number);
      }
      baseline = winVals.length > 0 ? winVals.reduce((a, b) => a + b, 0) / winVals.length : globalMean;
      const winSd =
        winVals.length > 1
          ? Math.sqrt(winVals.reduce((a, b) => a + (b - baseline) ** 2, 0) / (winVals.length - 1))
          : globalSd;
      const effSd = winSd > 1e-6 ? winSd : Math.max(1e-4, globalSd);
      zScore = (obs - baseline) / effSd;
      upperBand = baseline + threshold * effSd;
      lowerBand = baseline - threshold * effSd;
      isFlagged = Math.abs(zScore) >= threshold;
      reason = `Observed ${obs.toFixed(2)} ${params.units} diverged by ${zScore.toFixed(2)}σ from the local ${winVals.length}-point centered moving average (${baseline.toFixed(2)} ${params.units}).`;
      confidenceNote = 'Local moving average adapts to regime shifts but can reflect seasonal peaks in sub-annual data.';
    }

    baselineSeries.push({
      date: p.date,
      observed: Number(obs.toFixed(4)),
      baseline: Number(baseline.toFixed(4)),
      upperBand: Number(upperBand.toFixed(4)),
      lowerBand: Number(lowerBand.toFixed(4)),
      isAnomaly: isFlagged,
    });

    if (isFlagged) {
      const absZ = Math.abs(zScore ?? 0);
      const severity: AnomalyFinding['severity'] =
        absZ >= threshold + 1.25 ? 'extreme' : absZ >= threshold + 0.5 ? 'notable' : 'moderate';
      const deviation = obs - baseline;
      const percentDeviation = Math.abs(baseline) > 1e-6 ? (deviation / Math.abs(baseline)) * 100 : null;

      anomalies.push({
        date: p.date,
        observed: Number(obs.toFixed(4)),
        expectedBaseline: Number(baseline.toFixed(4)),
        deviation: Number(deviation.toFixed(4)),
        percentDeviation: percentDeviation !== null ? Number(percentDeviation.toFixed(1)) : null,
        zScore: zScore !== null ? Number(zScore.toFixed(2)) : null,
        severity,
        method,
        reason,
        confidenceNote,
      });
    }
  }

  anomalies.sort((a, b) => Math.abs(b.zScore ?? b.deviation) - Math.abs(a.zScore ?? a.deviation));

  return {
    method,
    threshold,
    units: params.units,
    mode: params.mode,
    isSimulated: params.isSimulated,
    totalValidObservations: valid.length,
    anomalyCount: anomalies.length,
    positiveCount: anomalies.filter((a) => a.deviation > 0).length,
    negativeCount: anomalies.filter((a) => a.deviation < 0).length,
    anomalies,
    baselineSeries,
    limitations: [
      'Statistical anomalies identify numerical departures from baseline; physical attribution requires meteorological or land-use corroboration.',
      'Not every statistical outlier indicates an extreme weather disaster or permanent climate regime shift.',
    ],
  };
}

// --- Validated Statistical Forecasting Engine ---

export function generateForecast(params: {
  points: TimeSeriesPoint[];
  units: string;
  aggregation: AggregationPeriod;
  horizonSteps?: number;
}): ForecastResult {
  const valid = params.points.filter((p) => !p.isMissing && p.value !== null && Number.isFinite(p.value));
  const minRequired = params.aggregation === 'annual' ? 10 : params.aggregation === 'monthly' ? 36 : 90;
  const defaultHorizon = params.aggregation === 'annual' ? 5 : params.aggregation === 'monthly' ? 24 : 30;
  const horizonSteps = Math.min(60, Math.max(3, params.horizonSteps ?? defaultHorizon));

  if (valid.length < minRequired) {
    return {
      available: false,
      reasonUnavailable: `Forecasting requires at least ${minRequired} valid ${params.aggregation} observations for holdout validation (${valid.length} available).`,
      modelName: 'Seasonal Linear + Additive Climatology',
      horizonSteps,
      horizonLabel: `${horizonSteps} ${params.aggregation} steps`,
      units: params.units,
      assumptions: [],
      points: [],
      disclaimer: 'Forecasts are statistical estimates and never represent actual NASA observations.',
    };
  }

  const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;
  const holdoutSize = Math.max(
    params.aggregation === 'annual' ? 2 : 6,
    Math.min(24, Math.floor(valid.length * 0.2)),
  );
  const train = valid.slice(0, valid.length - holdoutSize);
  const test = valid.slice(valid.length - holdoutSize);

  const fitAndPredict = (subset: TimeSeriesPoint[], targets: number[]) => {
    const t0 = subset[0].timestamp;
    const vals = subset.map((p) => p.value as number);
    const meanVal = vals.reduce((a, b) => a + b, 0) / vals.length;

    const mMap = new Map<number, number[]>();
    if (params.aggregation !== 'annual') {
      for (const p of subset) {
        const { month } = extractYearMonth(p.date);
        const arr = mMap.get(month) ?? [];
        arr.push(p.value as number);
        mMap.set(month, arr);
      }
    }
    const mOffsets = new Map<number, number>();
    for (const [m, arr] of mMap.entries()) {
      mOffsets.set(m, arr.reduce((a, b) => a + b, 0) / arr.length - meanVal);
    }

    const xs = subset.map((p) => (p.timestamp - t0) / MS_PER_YEAR);
    const ys = subset.map((p) => {
      const v = p.value as number;
      if (params.aggregation === 'annual') return v;
      const { month } = extractYearMonth(p.date);
      return v - (mOffsets.get(month) ?? 0);
    });

    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;

    const predictAt = (timestamp: number, month: number) => {
      const tYr = (timestamp - t0) / MS_PER_YEAR;
      const seasonal = params.aggregation === 'annual' ? 0 : (mOffsets.get(month) ?? 0);
      return intercept + slope * tYr + seasonal;
    };

    const inSampleResiduals = subset.map((p) => {
      const { month } = extractYearMonth(p.date);
      return (p.value as number) - predictAt(p.timestamp, month);
    });
    const rmseIn = Math.sqrt(
      inSampleResiduals.reduce((a, r) => a + r * r, 0) / Math.max(1, inSampleResiduals.length - 2),
    );

    const preds = targets.map((ts) => {
      const d = new Date(ts);
      return predictAt(ts, d.getUTCMonth() + 1);
    });

    return { preds, rmseIn, slope, intercept, mOffsets, t0 };
  };

  // Holdout validation
  const holdoutFit = fitAndPredict(
    train,
    test.map((p) => p.timestamp),
  );
  let absErrSum = 0;
  let sqErrSum = 0;
  let pctErrSum = 0;
  let pctCount = 0;
  for (let i = 0; i < test.length; i++) {
    const actual = test[i].value as number;
    const err = actual - holdoutFit.preds[i];
    absErrSum += Math.abs(err);
    sqErrSum += err * err;
    if (Math.abs(actual) > 1e-4) {
      pctErrSum += Math.abs(err / actual) * 100;
      pctCount++;
    }
  }
  const mae = absErrSum / test.length;
  const rmse = Math.sqrt(sqErrSum / test.length);
  const mape = pctCount > 0 ? pctErrSum / pctCount : null;

  // Refit on full valid history to project forward
  const fullFit = fitAndPredict(valid, []);
  const lastPoint = valid[valid.length - 1];
  const lastDate = new Date(lastPoint.timestamp);
  const combinedSigma = Math.max(rmse, fullFit.rmseIn);

  const forecastPoints: ForecastPoint[] = [];
  for (let h = 1; h <= horizonSteps; h++) {
    const nextDate = new Date(lastDate.getTime());
    if (params.aggregation === 'annual') {
      nextDate.setUTCFullYear(lastDate.getUTCFullYear() + h);
    } else if (params.aggregation === 'monthly') {
      nextDate.setUTCMonth(lastDate.getUTCMonth() + h);
    } else {
      nextDate.setUTCDate(lastDate.getUTCDate() + h);
    }

    const yyyy = nextDate.getUTCFullYear();
    const mm = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(nextDate.getUTCDate()).padStart(2, '0');
    const dateStr =
      params.aggregation === 'annual'
        ? `${yyyy}-01`
        : params.aggregation === 'monthly'
          ? `${yyyy}-${mm}`
          : `${yyyy}-${mm}-${dd}`;

    const tYr = (nextDate.getTime() - fullFit.t0) / MS_PER_YEAR;
    const seasonal =
      params.aggregation === 'annual'
        ? 0
        : (fullFit.mOffsets.get(nextDate.getUTCMonth() + 1) ?? 0);
    const pred = fullFit.intercept + fullFit.slope * tYr + seasonal;

    // Prediction interval widens slowly with horizon step
    const horizonFactor = Math.sqrt(1 + h / Math.max(12, valid.length * 0.5));
    const sigmaH = combinedSigma * horizonFactor;

    forecastPoints.push({
      date: dateStr,
      predicted: Number(pred.toFixed(4)),
      lower80: Number((pred - 1.282 * sigmaH).toFixed(4)),
      upper80: Number((pred + 1.282 * sigmaH).toFixed(4)),
      lower95: Number((pred - 1.96 * sigmaH).toFixed(4)),
      upper95: Number((pred + 1.96 * sigmaH).toFixed(4)),
      isEstimate: true,
    });
  }

  return {
    available: true,
    modelName:
      params.aggregation === 'annual'
        ? 'Linear Trend Extrapolation'
        : 'Additive Seasonal Climatology + Linear Trend',
    horizonSteps,
    horizonLabel: `${horizonSteps} ${params.aggregation} steps`,
    units: params.units,
    assumptions: [
      'Assumes historical linear rate of change and seasonal cycle persist over the forecast horizon.',
      'Does not model abrupt non-linear tipping points, volcanic aerosols, or policy interventions.',
      'Prediction intervals (80% and 95%) incorporate holdout validation RMSE and horizon expansion.',
    ],
    validationMetrics: {
      holdoutObservations: test.length,
      mae: Number(mae.toFixed(4)),
      rmse: Number(rmse.toFixed(4)),
      mape: mape !== null ? Number(mape.toFixed(2)) : null,
      skillNote: `Evaluated on the final ${test.length} historical ${params.aggregation} observations held out from fitting.`,
    },
    points: forecastPoints,
    disclaimer:
      'ESTIMATE ONLY — Projected values are statistical extrapolations based on historical data and are NOT NASA satellite or model observations.',
  };
}
