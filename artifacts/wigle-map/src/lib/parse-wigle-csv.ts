import type { WiFiNetwork } from "@workspace/api-client-react";
import { MAX_LOADED_NETWORKS } from "@/lib/import-limits";

export interface WigleCsvRow {
  bssid: string;
  ssid: string;
  capabilities: string;
  firstTimestampSeen: string;
  channel: number | null;
  frequency: number | null;
  rssi: number | null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  rcois: string;
  mfgrId: string;
  type: string;
}

export interface BssidGroup {
  bssid: string;
  ssid: string;
  capabilities: string;
  type: string;
  observations: WigleCsvRow[];
  bestRssi: number | null;
}

export interface ParseWigleCsvFileOptions {
  chunkSizeBytes?: number;
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  maxNetworks?: number;
}

interface BssidAggregate {
  bssid: string;
  ssid: string;
  capabilities: string;
  type: string;
  strongest: WigleCsvRow;
}

const DEFAULT_CHUNK_SIZE_BYTES = 1024 * 1024;

const HEADER_ALIASES = {
  bssid: ["bssid", "mac", "netid"],
  ssid: ["ssid"],
  capabilities: ["capabilities", "authmode", "encryption"],
  firstTimestampSeen: ["firsttimestampseen", "firstseen", "firsttime"],
  channel: ["channel"],
  frequency: ["frequency"],
  rssi: ["rssi", "signal"],
  latitude: ["latitude", "currentlatitude", "trilat"],
  longitude: ["longitude", "currentlongitude", "trilong"],
  altitude: ["altitude", "altitudemeters"],
  accuracy: ["accuracy", "accuracymeters"],
  rcois: ["rcois"],
  mfgrId: ["mfgrid", "manufacturerid"],
  type: ["type"],
} as const;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/^"|"$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function unquote(value: string): string {
  return value.trim().replace(/^"|"$/g, "").replace(/""/g, '"');
}

function getByAliases(
  columns: string[],
  indexByHeader: Map<string, number>,
  aliases: readonly string[],
): string {
  for (const alias of aliases) {
    const idx = indexByHeader.get(alias);
    if (idx === undefined) continue;
    return unquote(columns[idx] ?? "");
  }
  return "";
}

function findHeader(lines: string[]): { headerIdx: number; indexByHeader: Map<string, number> } | null {
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const headers = parseCsvLine(lines[i]).map(normalizeHeader);
    const indexByHeader = new Map<string, number>();

    headers.forEach((header, idx) => {
      if (!indexByHeader.has(header)) {
        indexByHeader.set(header, idx);
      }
    });

    const hasBssid = HEADER_ALIASES.bssid.some((alias) => indexByHeader.has(alias));
    const hasLat = HEADER_ALIASES.latitude.some((alias) => indexByHeader.has(alias));
    const hasLng = HEADER_ALIASES.longitude.some((alias) => indexByHeader.has(alias));

    if (hasBssid && hasLat && hasLng) {
      return { headerIdx: i, indexByHeader };
    }
  }

  return null;
}

function parseDataRow(
  line: string,
  indexByHeader: Map<string, number>,
): WigleCsvRow | null {
  const columns = parseCsvLine(line);
  if (columns.length === 0) return null;

  const latitude = parseNumber(
    getByAliases(columns, indexByHeader, HEADER_ALIASES.latitude),
  );
  const longitude = parseNumber(
    getByAliases(columns, indexByHeader, HEADER_ALIASES.longitude),
  );

  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const bssid = getByAliases(columns, indexByHeader, HEADER_ALIASES.bssid).toUpperCase();
  if (!bssid) return null;

  return {
    bssid,
    ssid: getByAliases(columns, indexByHeader, HEADER_ALIASES.ssid),
    capabilities: getByAliases(columns, indexByHeader, HEADER_ALIASES.capabilities),
    firstTimestampSeen: getByAliases(
      columns,
      indexByHeader,
      HEADER_ALIASES.firstTimestampSeen,
    ),
    channel: parseInteger(getByAliases(columns, indexByHeader, HEADER_ALIASES.channel)),
    frequency: parseInteger(getByAliases(columns, indexByHeader, HEADER_ALIASES.frequency)),
    rssi: parseInteger(getByAliases(columns, indexByHeader, HEADER_ALIASES.rssi)),
    latitude,
    longitude,
    altitude: parseNumber(getByAliases(columns, indexByHeader, HEADER_ALIASES.altitude)),
    accuracy: parseNumber(getByAliases(columns, indexByHeader, HEADER_ALIASES.accuracy)),
    rcois: getByAliases(columns, indexByHeader, HEADER_ALIASES.rcois),
    mfgrId: getByAliases(columns, indexByHeader, HEADER_ALIASES.mfgrId),
    type: getByAliases(columns, indexByHeader, HEADER_ALIASES.type) || "WiFi",
  };
}

function shouldReplaceStrongest(current: WigleCsvRow, candidate: WigleCsvRow): boolean {
  const currentRssi = current.rssi;
  const candidateRssi = candidate.rssi;

  if (candidateRssi === null) return false;
  if (currentRssi === null) return true;

  return candidateRssi > currentRssi;
}

function updateAggregate(aggregates: Map<string, BssidAggregate>, row: WigleCsvRow): void {
  const existing = aggregates.get(row.bssid);

  if (!existing) {
    aggregates.set(row.bssid, {
      bssid: row.bssid,
      ssid: row.ssid,
      capabilities: row.capabilities,
      type: row.type,
      strongest: row,
    });
    return;
  }

  if (!existing.ssid && row.ssid) existing.ssid = row.ssid;
  if (!existing.capabilities && row.capabilities) existing.capabilities = row.capabilities;
  if (!existing.type && row.type) existing.type = row.type;

  if (shouldReplaceStrongest(existing.strongest, row)) {
    existing.strongest = row;
  }
}

function aggregatesToNetworks(aggregates: Map<string, BssidAggregate>): WiFiNetwork[] {
  return Array.from(aggregates.values())
    .map((aggregate): WiFiNetwork => {
      const strongest = aggregate.strongest;

      return {
        netid: aggregate.bssid,
        ssid: aggregate.ssid || "",
        trilat: strongest.latitude,
        trilong: strongest.longitude,
        signal: strongest.rssi ?? undefined,
        channel: strongest.channel ?? undefined,
        encryption: aggregate.capabilities || "Unknown",
        firsttime: strongest.firstTimestampSeen || undefined,
        type: aggregate.type || "WiFi",
      };
    })
    .sort((a, b) => {
      const aSignal = a.signal ?? Number.NEGATIVE_INFINITY;
      const bSignal = b.signal ?? Number.NEGATIVE_INFINITY;
      return bSignal - aSignal;
    });
}

export function parseWigleCsv(text: string): WigleCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const header = findHeader(lines);
  if (!header) return [];

  const rows: WigleCsvRow[] = [];

  for (let i = header.headerIdx + 1; i < lines.length; i++) {
    const row = parseDataRow(lines[i], header.indexByHeader);
    if (!row) continue;
    rows.push(row);
  }

  return rows;
}

export function groupByBssid(rows: WigleCsvRow[]): BssidGroup[] {
  const groups = new Map<string, BssidGroup>();

  for (const row of rows) {
    const key = row.bssid;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        bssid: key,
        ssid: row.ssid,
        capabilities: row.capabilities,
        type: row.type,
        observations: [row],
        bestRssi: row.rssi,
      });
      continue;
    }

    existing.observations.push(row);
    if (!existing.ssid && row.ssid) existing.ssid = row.ssid;
    if (!existing.capabilities && row.capabilities) existing.capabilities = row.capabilities;
    if (!existing.type && row.type) existing.type = row.type;

    if (
      row.rssi !== null &&
      (existing.bestRssi === null || row.rssi > existing.bestRssi)
    ) {
      existing.bestRssi = row.rssi;
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.observations.length - a.observations.length,
  );
}

export function csvRowsToNetworks(rows: WigleCsvRow[]): WiFiNetwork[] {
  return groupByBssid(rows)
    .map((group): WiFiNetwork => {
      const strongest = group.observations.reduce((best, current) => {
        if (!best) return current;
        const bestRssi = best.rssi ?? Number.NEGATIVE_INFINITY;
        const currentRssi = current.rssi ?? Number.NEGATIVE_INFINITY;
        return currentRssi > bestRssi ? current : best;
      }, group.observations[0]);

      return {
        netid: group.bssid,
        ssid: group.ssid || "",
        trilat: strongest.latitude,
        trilong: strongest.longitude,
        signal: strongest.rssi ?? undefined,
        channel: strongest.channel ?? undefined,
        encryption: group.capabilities || "Unknown",
        firsttime: strongest.firstTimestampSeen || undefined,
        type: group.type || "WiFi",
      };
    })
    .sort((a, b) => {
      const aSignal = a.signal ?? Number.NEGATIVE_INFINITY;
      const bSignal = b.signal ?? Number.NEGATIVE_INFINITY;
      return bSignal - aSignal;
    });
}

export function parseWigleCsvToNetworks(text: string): WiFiNetwork[] {
  return csvRowsToNetworks(parseWigleCsv(text));
}

export async function parseWigleCsvFileToNetworks(
  file: File,
  options: ParseWigleCsvFileOptions = {},
): Promise<WiFiNetwork[]> {
  const chunkSizeBytes =
    typeof options.chunkSizeBytes === "number" && options.chunkSizeBytes > 0
      ? options.chunkSizeBytes
      : DEFAULT_CHUNK_SIZE_BYTES;

  const decoder = new TextDecoder();
  const maxNetworks =
    typeof options.maxNetworks === "number" && options.maxNetworks > 0
      ? Math.trunc(options.maxNetworks)
      : MAX_LOADED_NETWORKS;
  const aggregates = new Map<string, BssidAggregate>();
  const headerScanLines: string[] = [];
  let headerIndexByName: Map<string, number> | null = null;

  let offset = 0;
  let carry = "";

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;

    if (!headerIndexByName) {
      headerScanLines.push(line);
      const header = findHeader(headerScanLines);

      if (!header) {
        return;
      }

      headerIndexByName = header.indexByHeader;

      for (let i = header.headerIdx + 1; i < headerScanLines.length; i++) {
        const row = parseDataRow(headerScanLines[i], headerIndexByName);
        if (row) {
          updateAggregate(aggregates, row);
        }
      }

      headerScanLines.length = 0;
      return;
    }

    const row = parseDataRow(line, headerIndexByName);
    if (!row) return;

    if (!aggregates.has(row.bssid) && aggregates.size >= maxNetworks) {
      return;
    }

    updateAggregate(aggregates, row);
  };

  while (offset < file.size) {
    const end = Math.min(offset + chunkSizeBytes, file.size);
    const chunk = await file.slice(offset, end).arrayBuffer();

    carry += decoder.decode(chunk, { stream: end < file.size });

    let newlineIndex = carry.indexOf("\n");
    while (newlineIndex !== -1) {
      const rawLine = carry.slice(0, newlineIndex).replace(/\r$/, "");
      processLine(rawLine);

      carry = carry.slice(newlineIndex + 1);
      newlineIndex = carry.indexOf("\n");
    }

    offset = end;
    options.onProgress?.(offset, file.size);

    if (!headerIndexByName && headerScanLines.length >= 30) {
      return [];
    }
  }

  carry += decoder.decode();
  if (carry) {
    processLine(carry.replace(/\r$/, ""));
  }

  if (!headerIndexByName && headerScanLines.length >= 30) {
    return [];
  }

  return aggregatesToNetworks(aggregates).slice(0, maxNetworks);
}
