import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AssistantMessage,
  RegionLocation,
  SavedInvestigation,
} from '../src/types/earth.ts';
import { PRESET_REGIONS } from './nasaDatasets.ts';

export interface UserPreferences {
  defaultMode: 'live' | 'demo';
  alpha: number;
  voiceName: string;
  autoSpeak: boolean;
  wakeWordEnabled: boolean;
  defaultRegionName: string;
}

const DEFAULT_PREFS: UserPreferences = {
  defaultMode: 'live',
  alpha: 0.05,
  voiceName: '',
  autoSpeak: true,
  wakeWordEnabled: false,
  defaultRegionName: 'Shivamogga, Karnataka, India',
};

let dbInstance: DatabaseSync | null = null;
let activeDbPath = '';

export function getDatabasePath(): string {
  return activeDbPath;
}

export function initDatabase(customPath?: string): DatabaseSync {
  if (dbInstance) return dbInstance;

  const targetPath = customPath || process.env.DB_PATH || './data/aethryx.db';
  try {
    if (targetPath !== ':memory:') {
      const dir = path.dirname(path.resolve(targetPath));
      fs.mkdirSync(dir, { recursive: true });
    }
    dbInstance = new DatabaseSync(targetPath);
    activeDbPath = targetPath;
  } catch {
    const fallback = '/tmp/aethryx.db';
    dbInstance = new DatabaseSync(fallback);
    activeDbPath = fallback;
  }

  dbInstance.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS investigations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      region_name TEXT NOT NULL,
      region_json TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      dataset_name TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variable_id TEXT NOT NULL,
      variable_name TEXT NOT NULL,
      units TEXT NOT NULL,
      aggregation TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      trend_classification TEXT,
      slope_per_year REAL,
      mann_kendall_p REAL,
      anomaly_count INTEGER,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS favorite_regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      country TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      bbox_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      mode TEXT,
      citations_json TEXT,
      has_active_context INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed Shivamogga as initial favorite region if empty
  const countRow = dbInstance.prepare('SELECT COUNT(*) as cnt FROM favorite_regions').get() as { cnt: number };
  if (countRow.cnt === 0) {
    const shivamogga = PRESET_REGIONS[0];
    dbInstance
      .prepare(
        `INSERT OR IGNORE INTO favorite_regions (id, name, display_name, country, lat, lon, bbox_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        shivamogga.id ?? 'shivamogga',
        shivamogga.name,
        shivamogga.displayName,
        shivamogga.country,
        shivamogga.lat,
        shivamogga.lon,
        JSON.stringify(shivamogga.bbox),
        new Date().toISOString(),
      );
  }

  return dbInstance;
}

export function listInvestigations(): SavedInvestigation[] {
  const db = initDatabase();
  const rows = db
    .prepare(
      `SELECT id, title, created_at, region_json, dataset_id, dataset_name, product_id,
              variable_id, variable_name, units, aggregation, mode, is_simulated,
              start_date, end_date, trend_classification, slope_per_year, mann_kendall_p,
              anomaly_count, payload_json
       FROM investigations
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    createdAt: String(r.created_at),
    region: JSON.parse(String(r.region_json)) as RegionLocation,
    datasetId: r.dataset_id as SavedInvestigation['datasetId'],
    datasetName: String(r.dataset_name),
    productId: String(r.product_id),
    variableId: String(r.variable_id),
    variableName: String(r.variable_name),
    units: String(r.units),
    aggregation: r.aggregation as SavedInvestigation['aggregation'],
    mode: r.mode as SavedInvestigation['mode'],
    isSimulated: Boolean(r.is_simulated),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    trendClassification: (r.trend_classification as SavedInvestigation['trendClassification']) ?? undefined,
    slopePerYear: r.slope_per_year !== null ? Number(r.slope_per_year) : undefined,
    mannKendallP: r.mann_kendall_p !== null ? Number(r.mann_kendall_p) : undefined,
    anomalyCount: r.anomaly_count !== null ? Number(r.anomaly_count) : undefined,
    payloadJson: r.payload_json ? String(r.payload_json) : undefined,
  }));
}

export function saveInvestigation(item: SavedInvestigation): SavedInvestigation {
  const db = initDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO investigations (
      id, title, created_at, region_name, region_json, dataset_id, dataset_name, product_id,
      variable_id, variable_name, units, aggregation, mode, is_simulated,
      start_date, end_date, trend_classification, slope_per_year, mann_kendall_p,
      anomaly_count, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.title,
    item.createdAt,
    item.region.displayName,
    JSON.stringify(item.region),
    item.datasetId,
    item.datasetName,
    item.productId,
    item.variableId,
    item.variableName,
    item.units,
    item.aggregation,
    item.mode,
    item.isSimulated ? 1 : 0,
    item.startDate,
    item.endDate,
    item.trendClassification ?? null,
    item.slopePerYear ?? null,
    item.mannKendallP ?? null,
    item.anomalyCount ?? null,
    item.payloadJson ?? null,
  );
  return item;
}

export function deleteInvestigation(id: string): boolean {
  const db = initDatabase();
  const res = db.prepare('DELETE FROM investigations WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function listFavoriteRegions(): RegionLocation[] {
  const db = initDatabase();
  const rows = db
    .prepare('SELECT id, name, display_name, country, lat, lon, bbox_json FROM favorite_regions ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    displayName: String(r.display_name),
    country: String(r.country),
    lat: Number(r.lat),
    lon: Number(r.lon),
    bbox: r.bbox_json ? (JSON.parse(String(r.bbox_json)) as [number, number, number, number]) : undefined,
    isFavorite: true,
  }));
}

export function addFavoriteRegion(region: RegionLocation): RegionLocation {
  const db = initDatabase();
  const id = region.id || `fav-${region.lat.toFixed(3)}-${region.lon.toFixed(3)}`;
  db.prepare(
    `INSERT OR REPLACE INTO favorite_regions (id, name, display_name, country, lat, lon, bbox_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    region.name,
    region.displayName,
    region.country,
    region.lat,
    region.lon,
    region.bbox ? JSON.stringify(region.bbox) : null,
    new Date().toISOString(),
  );
  return { ...region, id, isFavorite: true };
}

export function deleteFavoriteRegion(id: string): boolean {
  const db = initDatabase();
  const res = db.prepare('DELETE FROM favorite_regions WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function listConversations(): AssistantMessage[] {
  const db = initDatabase();
  const rows = db
    .prepare('SELECT id, role, content, created_at, mode, citations_json, has_active_context FROM conversations ORDER BY created_at ASC LIMIT 200')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    role: r.role as 'user' | 'assistant',
    content: String(r.content),
    createdAt: String(r.created_at),
    mode: (r.mode as AssistantMessage['mode']) ?? undefined,
    citations: r.citations_json ? (JSON.parse(String(r.citations_json)) as string[]) : undefined,
    hasActiveContext: Boolean(r.has_active_context),
  }));
}

export function saveConversationMessage(msg: AssistantMessage): void {
  const db = initDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO conversations (id, role, content, created_at, mode, citations_json, has_active_context)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.role,
    msg.content,
    msg.createdAt,
    msg.mode ?? null,
    msg.citations ? JSON.stringify(msg.citations) : null,
    msg.hasActiveContext ? 1 : 0,
  );
}

export function clearConversations(): void {
  const db = initDatabase();
  db.prepare('DELETE FROM conversations').run();
}

export function getPreferences(): UserPreferences {
  const db = initDatabase();
  const row = db.prepare('SELECT value_json FROM preferences WHERE key = ?').get('user_prefs') as { value_json?: string } | undefined;
  if (!row?.value_json) return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(row.value_json) as Partial<UserPreferences>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function updatePreferences(partial: Partial<UserPreferences>): UserPreferences {
  const db = initDatabase();
  const next = { ...getPreferences(), ...partial };
  db.prepare(
    `INSERT OR REPLACE INTO preferences (key, value_json, updated_at) VALUES (?, ?, ?)`,
  ).run('user_prefs', JSON.stringify(next), new Date().toISOString());
  return next;
}
