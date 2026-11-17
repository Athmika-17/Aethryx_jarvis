import type {
  AnomalyDetectionResult,
  ForecastResult,
  RetrievedDatasetResult,
  TrendAnalysisResult,
} from '../src/types/earth.ts';

function escapeCsv(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateCsvReport(payload: {
  retrieved: RetrievedDatasetResult;
  trend?: TrendAnalysisResult | null;
  anomalies?: AnomalyDetectionResult | null;
}): string {
  const r = payload.retrieved;
  const t = payload.trend;
  const lines: string[] = [
    `# Project,AETHRYX JARVIS — Your Voice. Earth's Intelligence.`,
    `# Region,${escapeCsv(r.region.displayName)} (Lat ${r.region.lat}, Lon ${r.region.lon})`,
    `# Domain,${r.region.isOcean ? 'Ocean / Marine' : 'Land / Terrestrial'}`,
    `# Spatial Sampling,${r.spatialSampling ? `${r.spatialSampling.method} | ${r.spatialSampling.weightingMethod} (${r.spatialSampling.sampleCount} points)` : 'point'}`,
    ...(r.region.bbox ? [`# Bounding Box,${r.region.bbox.map((v) => v.toFixed(4)).join(';')}`] : []),
    ...(r.region.polygon?.length ? [`# Custom Polygon Vertices,${r.region.polygon.length}`] : []),
    `# Dataset,${escapeCsv(r.dataset.officialName)} (${escapeCsv(r.dataset.productId)})`,
    `# Product Version,${escapeCsv(r.productVersion ?? r.dataset.productVersion)}`,
    `# Source,${escapeCsv(r.dataset.nasaSource)} (${escapeCsv(r.dataset.officialSourceUrl)})`,
    `# API Endpoint,${escapeCsv(r.endpointUrl ?? r.dataset.apiEndpoint)}`,
    `# Variable,${escapeCsv(r.variable.name)} (${escapeCsv(r.variable.id)}) [${escapeCsv(r.variable.units)}]`,
    `# Data Mode,${r.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA RETRIEVAL'}`,
    `# Retrieval Timestamp,${escapeCsv(r.retrievalTimestamp)}`,
    `# Period,${escapeCsv(r.actualAvailablePeriod?.startDate ?? r.requestedPeriod.startDate)} to ${escapeCsv(r.actualAvailablePeriod?.endDate ?? r.requestedPeriod.endDate)}`,
    `# Valid / Missing Observations,${r.validObservations} / ${r.missingObservations}`,
  ];

  if (t) {
    lines.push(
      `# Trend Classification,${t.classification} (alpha=${t.alpha})`,
      `# OLS Slope (${t.units}/yr),${t.linearRegression.slopePerYear} (95% CI: ${t.linearRegression.ci95LowerPerYear} to ${t.linearRegression.ci95UpperPerYear})`,
      `# OLS R-squared / p-value,${t.linearRegression.rSquared} / ${t.linearRegression.pValue}`,
      `# Mann-Kendall (${t.mannKendall.method}),S=${t.mannKendall.sStatistic} Z=${t.mannKendall.zStatistic} p=${t.mannKendall.pValue} tau=${t.mannKendall.tau}`,
      `# Sen's Slope (${t.units}/yr),${t.sensSlope.slopePerYear} (95% CI: ${t.sensSlope.ci95LowerPerYear} to ${t.sensSlope.ci95UpperPerYear})`,
    );
    if (t.seasonalBreakdown?.quarters?.length) {
      const qLine = t.seasonalBreakdown.quarters
        .filter((q) => q.validObs > 0)
        .map((q) => `${q.season}:mean=${q.mean}(slope=${q.slopePerYear ?? 'NA'}/yr)`)
        .join('; ');
      lines.push(`# Seasonal Breakdown,${escapeCsv(qLine)}`);
    }
  }

  lines.push('');
  lines.push('date,value,unit,is_missing,seasonal_baseline,deseasonalized_value,regression_fit,ci_95_lower,ci_95_upper,anomaly_flag,anomaly_zscore');

  const anomMap = new Map(
    (payload.anomalies?.anomalies ?? []).map((a) => [a.date, a]),
  );
  const series = t?.series ?? r.points;
  for (const pt of series) {
    const anom = anomMap.get(pt.date);
    lines.push(
      [
        escapeCsv(pt.date),
        pt.value ?? '',
        escapeCsv(pt.unit),
        pt.isMissing ? 'true' : 'false',
        pt.seasonalBaseline ?? '',
        pt.deseasonalizedValue ?? '',
        pt.regressionFit ?? '',
        pt.ciLower ?? '',
        pt.ciUpper ?? '',
        anom ? anom.severity : 'normal',
        anom?.zScore ?? '',
      ].join(','),
    );
  }

  return lines.join('\n');
}

function buildInlineSvgChart(series: RetrievedDatasetResult['points'], trend?: TrendAnalysisResult | null): string {
  const pts = (trend?.series ?? series).filter((p) => !p.isMissing && p.value !== null);
  if (pts.length < 2) {
    return '<p style="color:#64748b">Insufficient valid points to render time-series plot.</p>';
  }
  const W = 860;
  const H = 260;
  const pad = { l: 58, r: 24, t: 20, b: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const vals = pts.map((p) => p.value as number);
  const fits = pts.map((p) => p.regressionFit).filter((v): v is number => typeof v === 'number');
  const minV = Math.min(...vals, ...fits);
  const maxV = Math.max(...vals, ...fits);
  const span = maxV - minV || 1;

  const xAt = (i: number) => pad.l + (i / (pts.length - 1)) * innerW;
  const yAt = (v: number) => pad.t + innerH - ((v - minV) / span) * innerH;

  const obsPath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.value as number).toFixed(1)}`)
    .join(' ');
  const fitPath =
    fits.length === pts.length
      ? pts
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.regressionFit as number).toFixed(1)}`)
          .join(' ')
      : '';

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#0b1120;border:1px solid #1e293b;border-radius:8px;display:block">
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}" stroke="#334155" stroke-width="1"/>
    <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#334155" stroke-width="1"/>
    <text x="10" y="${pad.t + 10}" fill="#94a3b8" font-size="11" font-family="monospace">${maxV.toFixed(2)}</text>
    <text x="10" y="${H - pad.b}" fill="#94a3b8" font-size="11" font-family="monospace">${minV.toFixed(2)}</text>
    <text x="${pad.l}" y="${H - 12}" fill="#94a3b8" font-size="11" font-family="monospace">${escapeHtml(pts[0].date)}</text>
    <text x="${W - pad.r - 65}" y="${H - 12}" fill="#94a3b8" font-size="11" font-family="monospace">${escapeHtml(pts[pts.length - 1].date)}</text>
    <path d="${obsPath}" fill="none" stroke="#06b6d4" stroke-width="1.8"/>
    ${fitPath ? `<path d="${fitPath}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5,4"/>` : ''}
  </svg>`;
}

function buildSeasonalSvgChart(trend?: TrendAnalysisResult | null): string {
  const monthly = (trend?.seasonalBreakdown?.monthly ?? []).filter((m) => m.mean !== null);
  if (monthly.length < 3) return '';
  const W = 860;
  const H = 200;
  const pad = { l: 58, r: 20, t: 18, b: 32 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const vals = monthly.map((m) => m.mean as number);
  const minV = Math.min(0, ...vals);
  const maxV = Math.max(...vals);
  const span = maxV - minV || 1;
  const barW = Math.max(18, innerW / monthly.length - 10);

  const bars = monthly
    .map((m, i) => {
      const x = pad.l + (i + 0.5) * (innerW / monthly.length) - barW / 2;
      const val = m.mean as number;
      const y = pad.t + innerH - ((val - minV) / span) * innerH;
      const h = Math.max(2, H - pad.b - y);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#38bdf8" rx="2"/>
        <text x="${(x + barW / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="monospace">${escapeHtml(m.label)}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#0b1120;border:1px solid #1e293b;border-radius:8px;display:block;margin-top:10px">
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}" stroke="#334155" stroke-width="1"/>
    <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#334155" stroke-width="1"/>
    <text x="10" y="${pad.t + 10}" fill="#94a3b8" font-size="11" font-family="monospace">${maxV.toFixed(2)}</text>
    <text x="10" y="${H - pad.b}" fill="#94a3b8" font-size="11" font-family="monospace">${minV.toFixed(2)}</text>
    ${bars}
  </svg>`;
}

export function generateHtmlReport(payload: {
  retrieved: RetrievedDatasetResult;
  trend?: TrendAnalysisResult | null;
  anomalies?: AnomalyDetectionResult | null;
  forecast?: ForecastResult | null;
  aiExplanation?: string;
}): string {
  const r = payload.retrieved;
  const t = payload.trend;
  const a = payload.anomalies;
  const f = payload.forecast;
  const svgChart = buildInlineSvgChart(r.points, t);
  const seasonalSvg = buildSeasonalSvgChart(t);

  const seasonalQuarterRows = (t?.seasonalBreakdown?.quarters ?? [])
    .filter((q) => q.validObs > 0)
    .map(
      (q) => `<tr>
        <td>${escapeHtml(q.season)} — ${escapeHtml(q.label)}</td>
        <td class="mono">${q.validObs}</td>
        <td class="mono">${q.mean?.toFixed(3) ?? 'N/A'} ${escapeHtml(r.variable.units)}</td>
        <td class="mono">${q.min?.toFixed(3) ?? 'N/A'} to ${q.max?.toFixed(3) ?? 'N/A'}</td>
        <td class="mono">${q.slopePerYear !== null ? `${q.slopePerYear >= 0 ? '+' : ''}${q.slopePerYear.toFixed(4)} ${escapeHtml(r.variable.units)}/yr` : 'N/A'}</td>
      </tr>`,
    )
    .join('');

  const anomalyRows = (a?.anomalies ?? [])
    .slice(0, 25)
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.date)}</td>
        <td>${item.observed.toFixed(3)} ${escapeHtml(r.variable.units)}</td>
        <td>${item.expectedBaseline.toFixed(3)} ${escapeHtml(r.variable.units)}</td>
        <td>${item.deviation >= 0 ? '+' : ''}${item.deviation.toFixed(3)}</td>
        <td>${item.zScore !== null ? item.zScore.toFixed(2) : 'N/A'}</td>
        <td>${escapeHtml(item.severity)}</td>
        <td>${escapeHtml(item.reason)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AETHRYX JARVIS Scientific Report — ${escapeHtml(r.region.name)} (${escapeHtml(r.variable.id)})</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #060913; color: #e2e8f0; margin: 0; padding: 32px; line-height: 1.6; }
    .container { max-width: 960px; margin: 0 auto; }
    .banner { border: 1px solid ${r.isSimulated ? '#f59e0b' : '#0891b2'}; background: #0c1222; padding: 16px 20px; border-radius: 8px; margin-bottom: 24px; }
    h1, h2, h3 { color: #f8fafc; margin-top: 28px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .card { background: #0c1222; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
    .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border: 1px solid #1e293b; padding: 8px 10px; text-align: left; }
    th { background: #111a2e; color: #cbd5e1; }
    a { color: #38bdf8; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <div class="banner">
      <div class="mono" style="color:${r.isSimulated ? '#fbbf24' : '#22d3ee'}">
        AETHRYX JARVIS — SCIENTIFIC EARTH OBSERVATION REPORT · ${r.isSimulated ? 'DEMO / SIMULATED DATA' : 'LIVE NASA DATA RETRIEVAL'}
      </div>
      <h1 style="margin:6px 0 4px">${escapeHtml(r.variable.name)} (${escapeHtml(r.variable.id)}) — ${escapeHtml(r.region.displayName)}</h1>
      <div class="mono" style="color:#94a3b8">Generated: ${escapeHtml(new Date().toISOString())} · Retrieved: ${escapeHtml(r.retrievalTimestamp)}</div>
    </div>

    <h2>1. Dataset, Region &amp; NASA Provenance</h2>
    <div class="grid">
      <div class="card">
        <div><strong>Region:</strong> ${escapeHtml(r.region.displayName)}</div>
        <div class="mono">Coordinates: ${r.region.lat}° N, ${r.region.lon}° E · Domain: ${r.region.isOcean ? 'Ocean / Marine' : 'Land / Terrestrial'}</div>
        <div class="mono">Sampling &amp; Weighting: ${escapeHtml(r.spatialSampling?.method ?? 'point')} (${escapeHtml(r.spatialSampling?.weightingMethod ?? 'single-point')}, ${r.spatialSampling?.sampleCount ?? 1} pts)${r.region.polygon?.length ? ` · Polygon (${r.region.polygon.length} vertices)` : ''}</div>
        <div><strong>Time Range:</strong> ${escapeHtml(r.actualAvailablePeriod?.startDate ?? r.requestedPeriod.startDate)} to ${escapeHtml(r.actualAvailablePeriod?.endDate ?? r.requestedPeriod.endDate)}</div>
        <div><strong>Aggregation:</strong> ${escapeHtml(r.aggregation)}</div>
      </div>
      <div class="card">
        <div><strong>Dataset:</strong> ${escapeHtml(r.dataset.officialName)}</div>
        <div class="mono">Product ID: ${escapeHtml(r.dataset.productId)} · Version: ${escapeHtml(r.productVersion ?? r.dataset.productVersion)}</div>
        <div><strong>NASA Source:</strong> ${escapeHtml(r.dataset.nasaSource)}</div>
        <div class="mono">Endpoint Invoked: <a href="${escapeHtml(r.endpointUrl ?? r.dataset.officialSourceUrl)}">${escapeHtml(r.endpointUrl ?? r.dataset.apiEndpoint)}</a></div>
        <div><strong>Documentation:</strong> <a href="${escapeHtml(r.dataset.officialSourceUrl)}">${escapeHtml(r.dataset.officialSourceUrl)}</a></div>
      </div>
    </div>

    <h2>2. Data Quality &amp; Summary Statistics</h2>
    <div class="card mono">
      Valid Observations: ${r.validObservations} · Missing Observations: ${r.missingObservations} · Units: ${escapeHtml(r.variable.units)}<br/>
      Mean: ${r.summary.mean ?? 'N/A'} · Median: ${r.summary.median ?? 'N/A'} · Min: ${r.summary.min ?? 'N/A'} · Max: ${r.summary.max ?? 'N/A'} · StdDev: ${r.summary.stdDev ?? 'N/A'}
    </div>

    <h2>3. Time-Series Visualization</h2>
    <p style="font-size:13px;color:#94a3b8">Dataset: ${escapeHtml(r.dataset.officialName)} (${escapeHtml(r.dataset.productId)}) · Variable: ${escapeHtml(r.variable.name)} (${escapeHtml(r.variable.units)}) · Region: ${escapeHtml(r.region.name)} · Period: ${escapeHtml(r.actualAvailablePeriod?.startDate ?? r.requestedPeriod.startDate)} to ${escapeHtml(r.actualAvailablePeriod?.endDate ?? r.requestedPeriod.endDate)} · Solid Cyan: Observed · Dashed Amber: OLS Linear Fit</p>
    ${svgChart}

    ${
      t
        ? `<h2>4. Trend Detective Statistical Evaluation (alpha = ${t.alpha})</h2>
    <div class="card">
      <p><strong>Classification:</strong> ${escapeHtml(t.classification.toUpperCase())}</p>
      <p>${escapeHtml(t.diagnostics.scientificSummary)}</p>
      <table>
        <tr><th>Method</th><th>Estimate</th><th>Statistic / Uncertainty</th><th>p-value</th></tr>
        <tr>
          <td>Ordinary Least Squares</td>
          <td class="mono">${t.linearRegression.slopePerYear} ${escapeHtml(t.units)}/yr</td>
          <td class="mono">R² = ${t.linearRegression.rSquared} · t = ${t.linearRegression.tStatistic} · 95% CI [${t.linearRegression.ci95LowerPerYear}, ${t.linearRegression.ci95UpperPerYear}]</td>
          <td class="mono">${t.linearRegression.pValue}</td>
        </tr>
        <tr>
          <td>Mann-Kendall (${escapeHtml(t.mannKendall.method)})</td>
          <td class="mono">tau = ${t.mannKendall.tau}</td>
          <td class="mono">S = ${t.mannKendall.sStatistic} · Z = ${t.mannKendall.zStatistic} · Lag-1 r = ${t.mannKendall.lag1Autocorrelation}</td>
          <td class="mono">${t.mannKendall.pValue}</td>
        </tr>
        <tr>
          <td>Sen's Slope (Theil-Sen)</td>
          <td class="mono">${t.sensSlope.slopePerYear} ${escapeHtml(t.units)}/yr</td>
          <td class="mono">95% CI [${t.sensSlope.ci95LowerPerYear}, ${t.sensSlope.ci95UpperPerYear}]</td>
          <td class="mono">Non-parametric</td>
        </tr>
      </table>
    </div>`
        : ''
    }

    ${
      seasonalQuarterRows
        ? `<h2>5. Seasonal Cycle &amp; Seasonal Trend Breakdown</h2>
    <div class="card">
      <p style="font-size:13px;color:#94a3b8">Monthly climatological cycle and seasonal Sen&apos;s slopes for ${escapeHtml(r.variable.name)} (${escapeHtml(r.variable.units)}) at ${escapeHtml(r.region.name)}.</p>
      ${seasonalSvg}
      <table>
        <tr><th>Meteorological Season</th><th>Valid Obs</th><th>Seasonal Mean</th><th>Observed Range</th><th>Within-Season Sen&apos;s Slope</th></tr>
        ${seasonalQuarterRows}
      </table>
    </div>`
        : ''
    }

    <h2>6. Anomaly Findings</h2>
    ${
      a && a.anomalies.length > 0
        ? `<p>Method: <span class="mono">${escapeHtml(a.method)}</span> (threshold = ${a.threshold}). Flagged ${a.anomalyCount} anomalies (${a.positiveCount} positive, ${a.negativeCount} negative).</p>
      <table>
        <tr><th>Date</th><th>Observed</th><th>Baseline</th><th>Deviation</th><th>Z-Score</th><th>Severity</th><th>Explanation</th></tr>
        ${anomalyRows}
      </table>`
        : '<div class="card">No statistical anomalies flagged above the selected threshold, or anomaly analysis not run.</div>'
    }

    ${
      f
        ? `<h2>7. Statistical Forecast Assessment</h2>
    <div class="card">
      ${
        f.available
          ? `<p><strong>Model:</strong> ${escapeHtml(f.modelName)} · <strong>Horizon:</strong> ${escapeHtml(f.horizonLabel)}</p>
             <p class="mono">Holdout Validation (n=${f.validationMetrics?.holdoutObservations}): MAE = ${f.validationMetrics?.mae}, RMSE = ${f.validationMetrics?.rmse}</p>
             <p style="color:#fbbf24">${escapeHtml(f.disclaimer)}</p>`
          : `<p>Forecasting unavailable: ${escapeHtml(f.reasonUnavailable)}</p>`
      }
    </div>`
        : ''
    }

    ${
      payload.aiExplanation
        ? `<h2>8. AI-Generated Scientific Interpretation (Clearly Distinguished from Observations)</h2><div class="card"><p style="font-size:12px;color:#94a3b8;margin-top:0">Generated by AETHRYX JARVIS AI Assistant grounded strictly on the above retrieved metrics. Statistical interpretation does not alter underlying NASA observations.</p>${escapeHtml(payload.aiExplanation).replace(/\n/g, '<br/>')}</div>`
        : ''
    }

    <h2>9. Methods, Limitations &amp; Reproducibility</h2>
    <div class="card">
      <ul>
        ${(t?.diagnostics.assumptions ?? ['Standard time-series aggregation and missing-value filtering applied.']).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}
        ${(t?.diagnostics.limitations ?? ['Trend analysis does not establish physical causation.']).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}
      </ul>
      <p class="mono">Reproducibility Parameters: dataset=${escapeHtml(r.dataset.id)}, product=${escapeHtml(r.dataset.productId)}, version=${escapeHtml(r.productVersion ?? r.dataset.productVersion)}, variable=${escapeHtml(r.variable.id)}, lat=${r.region.lat}, lon=${r.region.lon}, weighting=${escapeHtml(r.spatialSampling?.weightingMethod ?? 'single-point')}, start=${escapeHtml(r.requestedPeriod.startDate)}, end=${escapeHtml(r.requestedPeriod.endDate)}, aggregation=${escapeHtml(r.aggregation)}, mode=${escapeHtml(r.mode)}</p>
    </div>
  </div>
</body>
</html>`;
}
