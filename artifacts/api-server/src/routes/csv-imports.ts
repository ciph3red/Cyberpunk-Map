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

let csvTableReady: Promise<void> | null = null;

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

    if (inputNetworks.length > 50000) {
      res.status(413).json({ success: false, error: "Too many networks in a single import (max 50000)" });
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

    const importId = crypto.randomUUID();
    const fileName = sanitizeFileName(body.fileName);
    const createdAt = new Date().toISOString();

    await pool.query(
      `
        INSERT INTO csv_imports (id, file_name, networks, network_count, created_at)
        VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
      `,
      [importId, fileName, JSON.stringify(networks), networks.length, createdAt],
    );

    res.status(201).json({
      success: true,
      importId,
      fileName,
      networkCount: networks.length,
      createdAt,
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
