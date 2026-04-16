import { Router } from "express";

const router = Router();

type JsonRecord = Record<string, unknown>;

interface PersistedNetwork {
  netid: string;
  ssid: string;
  trilat: number;
  trilong: number;
  signal?: number;
  channel?: number;
  encryption?: string;
  firsttime?: string;
  type?: string;
  country?: string;
  city?: string;
}

interface QueryResultRow {
  [key: string]: unknown;
}

interface QueryResult {
  rows: QueryResultRow[];
  rowCount: number | null;
}

interface PgPoolLike {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
}

interface LatestImportSnapshot {
  importId: string;
  networks: PersistedNetwork[];
}

interface NetworkAccumulator {
  netid: string;
  ssid: string;
  encryption: string | undefined;
  type: string | undefined;
  country: string | undefined;
  city: string | undefined;
  firsttime: string | undefined;
  weightedLatSum: number;
  weightedLngSum: number;
  weightSum: number;
  strongest: PersistedNetwork;
}

let csvTableReady: Promise<void> | null = null;

const HISTORICAL_SOURCE_BOOST = 1;
const INCOMING_SOURCE_BOOST = 1.35;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\u0000/g, "");
  return trimmed ? trimmed : undefined;
}

function normalizeNetwork(input: unknown): PersistedNetwork | null {
  if (!input || typeof input !== "object") return null;
  const row = input as JsonRecord;

  const netid = toOptionalString(row.netid);
  const ssid = typeof row.ssid === "string" ? row.ssid.replace(/\u0000/g, "") : "";
  const trilat = row.trilat;
  const trilong = row.trilong;

  if (!netid || !isFiniteNumber(trilat) || !isFiniteNumber(trilong)) {
    return null;
  }

  if (trilat < -90 || trilat > 90 || trilong < -180 || trilong > 180) {
    return null;
  }

  const signal = isFiniteNumber(row.signal) ? Math.trunc(row.signal) : undefined;
  const channel = isFiniteNumber(row.channel) ? Math.trunc(row.channel) : undefined;

  return {
    netid,
    ssid,
    trilat,
    trilong,
    signal,
    channel,
    encryption: toOptionalString(row.encryption),
    firsttime: toOptionalString(row.firsttime),
    type: toOptionalString(row.type),
    country: toOptionalString(row.country),
    city: toOptionalString(row.city),
  };
}

function sanitizeFileName(value: unknown): string {
  const fallback = `import-${new Date().toISOString()}.csv`;
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  if (!trimmed) return fallback;

  return trimmed.slice(0, 255);
}

function parseLimit(value: unknown): number {
  if (typeof value !== "string") return 20;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
}

function clampLat(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

function clampLng(value: number): number {
  return Math.max(-180, Math.min(180, value));
}

function getSignalWeight(signal: number | undefined): number {
  if (!isFiniteNumber(signal)) {
    return 20;
  }

  return Math.max(5, Math.min(120, signal + 130));
}

function pickString(
  current: string | undefined,
  candidate: string | undefined,
  preferCandidate: boolean,
): string | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  return preferCandidate ? candidate : current;
}

function parsePersistedNetworks(value: unknown): PersistedNetwork[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeNetwork)
    .filter((row): row is PersistedNetwork => row !== null);
}

function upsertAccumulator(
  accumulators: Map<string, NetworkAccumulator>,
  row: PersistedNetwork,
  sourceBoost: number,
  preferCandidateText: boolean,
): void {
  const existing = accumulators.get(row.netid);
  const rowWeight = getSignalWeight(row.signal) * sourceBoost;

  if (!existing) {
    accumulators.set(row.netid, {
      netid: row.netid,
      ssid: row.ssid,
      encryption: row.encryption,
      type: row.type,
      country: row.country,
      city: row.city,
      firsttime: row.firsttime,
      weightedLatSum: row.trilat * rowWeight,
      weightedLngSum: row.trilong * rowWeight,
      weightSum: rowWeight,
      strongest: row,
    });
    return;
  }

  existing.weightedLatSum += row.trilat * rowWeight;
  existing.weightedLngSum += row.trilong * rowWeight;
  existing.weightSum += rowWeight;

  existing.ssid = pickString(existing.ssid, row.ssid, preferCandidateText) ?? "";
  existing.encryption = pickString(existing.encryption, row.encryption, preferCandidateText);
  existing.type = pickString(existing.type, row.type, preferCandidateText);
  existing.country = pickString(existing.country, row.country, preferCandidateText);
  existing.city = pickString(existing.city, row.city, preferCandidateText);
  existing.firsttime = pickString(existing.firsttime, row.firsttime, preferCandidateText);

  const existingSignal = existing.strongest.signal;
  const candidateSignal = row.signal;
  const shouldReplaceStrongest =
    isFiniteNumber(candidateSignal) &&
    (!isFiniteNumber(existingSignal) || candidateSignal > existingSignal);

  if (shouldReplaceStrongest) {
    existing.strongest = row;
  }
}

function mergeNetworkSnapshots(
  historical: PersistedNetwork[],
  incoming: PersistedNetwork[],
): PersistedNetwork[] {
  const accumulators = new Map<string, NetworkAccumulator>();

  for (const row of historical) {
    upsertAccumulator(accumulators, row, HISTORICAL_SOURCE_BOOST, false);
  }

  for (const row of incoming) {
    upsertAccumulator(accumulators, row, INCOMING_SOURCE_BOOST, true);
  }

  const merged = Array.from(accumulators.values()).map((acc) => {
    const weight = acc.weightSum > 0 ? acc.weightSum : 1;
    const strongest = acc.strongest;

    return {
      netid: acc.netid,
      ssid: acc.ssid ?? "",
      trilat: clampLat(acc.weightedLatSum / weight),
      trilong: clampLng(acc.weightedLngSum / weight),
      signal: strongest.signal,
      channel: strongest.channel,
      encryption: acc.encryption,
      firsttime: acc.firsttime,
      type: acc.type,
      country: acc.country,
      city: acc.city,
    } as PersistedNetwork;
  });

  merged.sort((a, b) => {
    const signalA = isFiniteNumber(a.signal) ? a.signal : Number.NEGATIVE_INFINITY;
    const signalB = isFiniteNumber(b.signal) ? b.signal : Number.NEGATIVE_INFINITY;
    return signalB - signalA;
  });

  return merged;
}

async function fetchLatestImportSnapshot(pool: PgPoolLike): Promise<LatestImportSnapshot | null> {
  const latestResult = await pool.query(
    `
      SELECT id, networks
      FROM csv_imports
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );

  const row = latestResult.rows[0];
  if (!row || typeof row.id !== "string") {
    return null;
  }

  const networks = parsePersistedNetworks((row as JsonRecord).networks);
  if (networks.length === 0) {
    return null;
  }

  return {
    importId: row.id,
    networks,
  };
}

function resolveErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }

  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    const code = (err as { code: string }).code;
    return `Database operation failed (${code}).`;
  }

  return "Internal server error";
}

async function getPool(): Promise<PgPoolLike> {
  try {
    const dbModule = await import("@workspace/db");
    return dbModule.pool as unknown as PgPoolLike;
  } catch {
    throw new Error(
      "Database is not configured on this server. Set DATABASE_URL for api-server.",
    );
  }
}

async function ensureCsvTable(pool: PgPoolLike): Promise<void> {
  if (!csvTableReady) {
    csvTableReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS csv_imports (
          id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          networks JSONB NOT NULL,
          network_count INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS csv_imports_created_at_idx
        ON csv_imports (created_at DESC)
      `);
    })();
  }

  await csvTableReady;
}

router.post("/csv/imports", async (req, res) => {
  try {
    const body = (req.body ?? {}) as JsonRecord;
    const inputNetworks = Array.isArray(body.networks) ? body.networks : null;

    if (!inputNetworks) {
      res.status(400).json({ success: false, error: "networks array is required" });
      return;
    }

    if (inputNetworks.length === 0) {
      res.status(400).json({ success: false, error: "networks cannot be empty" });
      return;
    }

    if (inputNetworks.length > 250000) {
      res.status(413).json({ success: false, error: "Too many networks in a single import (max 250000)" });
      return;
    }

    const networks = inputNetworks
      .map(normalizeNetwork)
      .filter((row): row is PersistedNetwork => row !== null);

    if (networks.length === 0) {
      res.status(400).json({ success: false, error: "No valid networks found in payload" });
      return;
    }

    const pool = await getPool();
    await ensureCsvTable(pool);

    const previousSnapshot = await fetchLatestImportSnapshot(pool);
    const refinedNetworks = previousSnapshot
      ? mergeNetworkSnapshots(previousSnapshot.networks, networks)
      : networks;

    const importId = crypto.randomUUID();
    const fileName = sanitizeFileName(body.fileName);
    const createdAt = new Date().toISOString();

    await pool.query(
      `
        INSERT INTO csv_imports (id, file_name, networks, network_count, created_at)
        VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
      `,
      [importId, fileName, JSON.stringify(refinedNetworks), refinedNetworks.length, createdAt],
    );

    res.status(201).json({
      success: true,
      importId,
      fileName,
      networkCount: refinedNetworks.length,
      createdAt,
      mergedWithImportId: previousSnapshot?.importId,
    });
  } catch (err) {
    req.log.error({ err }, "CSV import persistence failed");
    const message = resolveErrorMessage(err);
    const status = message.startsWith("Database is not configured") ? 500 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.get("/csv/imports", async (req, res) => {
  try {
    const pool = await getPool();
    await ensureCsvTable(pool);

    const limit = parseLimit(req.query.limit);
    const result = await pool.query(
      `
        SELECT id, file_name, network_count, created_at
        FROM csv_imports
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    res.json({
      success: true,
      imports: result.rows.map((row) => ({
        importId: row.id,
        fileName: row.file_name,
        networkCount: row.network_count,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "CSV imports listing failed");
    const message = resolveErrorMessage(err);
    res.status(500).json({ success: false, error: message });
  }
});

router.get("/csv/imports/:importId", async (req, res) => {
  try {
    const importId = req.params.importId;
    const pool = await getPool();
    await ensureCsvTable(pool);

    const result = await pool.query(
      `
        SELECT id, file_name, network_count, created_at, networks
        FROM csv_imports
        WHERE id = $1
        LIMIT 1
      `,
      [importId],
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ success: false, error: "Import not found" });
      return;
    }

    const networks = Array.isArray(row.networks)
      ? (row.networks as PersistedNetwork[])
      : [];

    res.json({
      success: true,
      importId: row.id,
      fileName: row.file_name,
      networkCount: row.network_count,
      createdAt: row.created_at,
      totalResults: networks.length,
      resultCount: networks.length,
      results: networks,
    });
  } catch (err) {
    req.log.error({ err }, "CSV import fetch failed");
    const message = resolveErrorMessage(err);
    res.status(500).json({ success: false, error: message });
  }
});

router.delete("/csv/imports/:importId", async (req, res) => {
  try {
    const importId = req.params.importId;
    const pool = await getPool();
    await ensureCsvTable(pool);

    const result = await pool.query(`DELETE FROM csv_imports WHERE id = $1`, [
      importId,
    ]);

    if (!result.rowCount) {
      res.status(404).json({ success: false, error: "Import not found" });
      return;
    }

    res.json({ success: true, importId });
  } catch (err) {
    req.log.error({ err }, "CSV import delete failed");
    const message = resolveErrorMessage(err);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
