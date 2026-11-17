import { jsPDF } from 'jspdf';
import type {
  AnomalyDetectionResult,
  ForecastResult,
  RetrievedDatasetResult,
  TrendAnalysisResult,
} from '../types/earth';

function drawTimeSeriesToCanvas(
  retrieved: RetrievedDatasetResult,
  trend?: TrendAnalysisResult | null,
): string | null {
  const pts = (trend?.series ?? retrieved.points).filter((p) => !p.isMissing && p.value !== null);
  if (pts.length < 2) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 340;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pad = { l: 75, r: 30, t: 30, b: 48 };
  const w = canvas.width - pad.l - pad.r;
  const h = canvas.height - pad.t - pad.b;

  const vals = pts.map((p) => p.value as number);
  const fits = pts.map((p) => p.regressionFit).filter((v): v is number => typeof v === 'number');
  const minV = Math.min(...vals, ...fits);
  const maxV = Math.max(...vals, ...fits);
  const span = maxV - minV || 1;

  const xAt = (i: number) => pad.l + (i / (pts.length - 1)) * w;
  const yAt = (v: number) => pad.t + h - ((v - minV) / span) * h;

  // Grid & Axes
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = pad.t + (g / 4) * h;
    ctx.beginPath();
    ctx.moveTo(pad.l, gy);
    ctx.lineTo(pad.l + w, gy);
    ctx.stroke();
    const labelVal = maxV - (g / 4) * span;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(labelVal.toFixed(2), 10, gy + 4);
  }

  // Observed line
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.value as number);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Regression fit line
  if (fits.length === pts.length) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.regressionFit as number);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '13px monospace';
  ctx.fillText(pts[0].date, pad.l, canvas.height - 16);
  ctx.fillText(pts[pts.length - 1].date, canvas.width - pad.r - 80, canvas.height - 16);
  ctx.fillText(
    `${retrieved.variable.shortLabel} (${retrieved.variable.units})`,
    pad.l,
    18,
  );

  return canvas.toDataURL('image/png');
}

export function exportPdfReport(payload: {
  retrieved: RetrievedDatasetResult;
  trend?: TrendAnalysisResult | null;
  anomalies?: AnomalyDetectionResult | null;
  forecast?: ForecastResult | null;
  aiExplanation?: string;
}): void {
  const { retrieved: r, trend: t, anomalies: a, forecast: f, aiExplanation } = payload;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentW = pageWidth - margin * 2;
  let y = 48;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 48;
    }
  };

  const addHeading = (text: string) => {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(14, 116, 144);
    doc.text(text, margin, y);
    y += 16;
  };

  const addParagraph = (text: string, fontSize = 9.5, mono = false) => {
    doc.setFont(mono ? 'courier' : 'helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    ensureSpace(lines.length * (fontSize + 3.5) + 6);
    doc.text(lines, margin, y);
    y += lines.length * (fontSize + 3.5) + 6;
  };

  // Header Banner
  doc.setFillColor(6, 9, 19);
  doc.rect(0, 0, pageWidth, 86, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(34, 211, 238);
  doc.text('AETHRYX JARVIS — SCIENTIFIC EARTH OBSERVATION REPORT', margin, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(226, 232, 240);
  doc.text(
    `${r.region.displayName}  |  ${r.variable.name} (${r.variable.id})  |  ${r.isSimulated ? 'DEMO / SIMULATED DATA' : 'LIVE NASA DATA'}`,
    margin,
    54,
  );
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Generated: ${new Date().toISOString()}   |   Retrieved: ${r.retrievalTimestamp}`,
    margin,
    70,
  );
  y = 108;

  addHeading('1. Region, Dataset & NASA Provenance');
  addParagraph(
    `Region: ${r.region.displayName} (Latitude ${r.region.lat}°, Longitude ${r.region.lon}°)\n` +
      `Domain & Spatial Averaging: ${r.region.isOcean ? 'Ocean / Marine' : 'Land / Terrestrial'} | ${r.spatialSampling?.method ?? 'point'} (${r.spatialSampling?.weightingMethod ?? 'single-point'}, ${r.spatialSampling?.sampleCount ?? 1} sample point${(r.spatialSampling?.sampleCount ?? 1) > 1 ? 's' : ''})${r.region.polygon?.length ? ` | Custom Polygon (${r.region.polygon.length} vertices)` : ''}\n` +
      `Dataset: ${r.dataset.officialName} [${r.dataset.productId}] (Version: ${r.productVersion ?? r.dataset.productVersion})\n` +
      `NASA Source: ${r.dataset.nasaSource} (${r.dataset.officialSourceUrl})\n` +
      `Endpoint Invoked: ${r.endpointUrl ?? r.dataset.apiEndpoint}\n` +
      `Variable: ${r.variable.name} (${r.variable.units}) | Aggregation: ${r.aggregation}\n` +
      `Available Period: ${r.actualAvailablePeriod?.startDate ?? 'N/A'} to ${r.actualAvailablePeriod?.endDate ?? 'N/A'}\n` +
      `Data Mode: ${r.isSimulated ? 'DEMO / SIMULATED REFERENCE SERIES' : 'LIVE RETRIEVED NASA OBSERVATIONS'}`,
  );

  addHeading('2. Data Quality & Summary Statistics');
  addParagraph(
    `Valid Observations: ${r.validObservations} | Missing Observations: ${r.missingObservations}\n` +
      `Mean: ${r.summary.mean ?? 'N/A'} ${r.variable.units} | Median: ${r.summary.median ?? 'N/A'} | Min: ${r.summary.min ?? 'N/A'} | Max: ${r.summary.max ?? 'N/A'} | StdDev: ${r.summary.stdDev ?? 'N/A'}`,
    9.5,
    true,
  );

  const chartPng = drawTimeSeriesToCanvas(r, t);
  if (chartPng) {
    ensureSpace(190);
    addHeading('3. Time-Series & Regression Visualization');
    doc.addImage(chartPng, 'PNG', margin, y, contentW, contentW * 0.34);
    y += contentW * 0.34 + 14;
  }

  if (t) {
    addHeading(`4. Trend Detective Statistical Evaluation (alpha = ${t.alpha})`);
    addParagraph(
      `Classification: ${t.classification.toUpperCase()}\n` +
        `${t.diagnostics.scientificSummary}\n` +
        `OLS Linear Regression: slope = ${t.linearRegression.slopePerYear} ${t.units}/yr (95% CI [${t.linearRegression.ci95LowerPerYear}, ${t.linearRegression.ci95UpperPerYear}]), R² = ${t.linearRegression.rSquared}, t = ${t.linearRegression.tStatistic}, p = ${t.linearRegression.pValue}\n` +
        `Mann-Kendall (${t.mannKendall.method}): S = ${t.mannKendall.sStatistic}, Z = ${t.mannKendall.zStatistic}, tau = ${t.mannKendall.tau}, p = ${t.mannKendall.pValue}\n` +
        `Sen's Slope: ${t.sensSlope.slopePerYear} ${t.units}/yr (95% CI [${t.sensSlope.ci95LowerPerYear}, ${t.sensSlope.ci95UpperPerYear}])`,
    );

    if (t.seasonalBreakdown?.quarters?.some((q) => q.validObs > 0)) {
      addHeading('5. Seasonal Cycle & Within-Season Trend Breakdown');
      const qLines = t.seasonalBreakdown.quarters
        .filter((q) => q.validObs > 0)
        .map(
          (q) =>
            `• ${q.season} (${q.label}): mean = ${q.mean?.toFixed(3)} ${t.units} (range ${q.min?.toFixed(2)}–${q.max?.toFixed(2)}, n=${q.validObs}, Sen's slope = ${q.slopePerYear !== null ? `${q.slopePerYear >= 0 ? '+' : ''}${q.slopePerYear.toFixed(4)} ${t.units}/yr` : 'N/A'})`,
        )
        .join('\n');
      addParagraph(qLines, 8.5, true);
    }
  }

  addHeading('6. Anomaly Detection Summary');
  if (a && a.anomalies.length > 0) {
    addParagraph(
      `Method: ${a.method} (threshold = ${a.threshold}). Flagged ${a.anomalyCount} anomalies (${a.positiveCount} positive, ${a.negativeCount} negative).`,
    );
    const top = a.anomalies
      .slice(0, 8)
      .map(
        (x) =>
          `• ${x.date}: Observed ${x.observed} vs Baseline ${x.expectedBaseline} ${r.variable.units} (Z=${x.zScore ?? 'N/A'}, ${x.severity})`,
      )
      .join('\n');
    addParagraph(top, 8.5, true);
  } else {
    addParagraph('No statistical anomalies flagged for the active configuration.');
  }

  if (f) {
    addHeading('7. Forecasting Assessment');
    if (f.available) {
      addParagraph(
        `Model: ${f.modelName} | Horizon: ${f.horizonLabel}\n` +
          `Holdout Metrics (n=${f.validationMetrics?.holdoutObservations}): MAE = ${f.validationMetrics?.mae}, RMSE = ${f.validationMetrics?.rmse}\n` +
          `${f.disclaimer}`,
      );
    } else {
      addParagraph(`Forecasting unavailable: ${f.reasonUnavailable}`);
    }
  }

  if (aiExplanation) {
    addHeading('8. AI-Generated Scientific Interpretation (Distinct from NASA Observations)');
    addParagraph(aiExplanation);
  }

  addHeading('9. Methods, Limitations & Reproducibility');
  addParagraph(
    [
      ...(t?.diagnostics.assumptions ?? []),
      ...(t?.diagnostics.limitations ?? ['Correlation/trends do not establish physical causation.']),
      `Reproducibility: dataset=${r.dataset.id}, product=${r.dataset.productId}, version=${r.productVersion ?? r.dataset.productVersion}, variable=${r.variable.id}, lat=${r.region.lat}, lon=${r.region.lon}, weighting=${r.spatialSampling?.weightingMethod ?? 'single-point'}, start=${r.requestedPeriod.startDate}, end=${r.requestedPeriod.endDate}, aggregation=${r.aggregation}, mode=${r.mode}`,
    ].join('\n'),
    8.5,
  );

  const slug = `${r.region.name}-${r.variable.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`aethryx-${slug}.pdf`);
}
