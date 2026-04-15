import type { WiFiNetwork } from "@workspace/api-client-react";

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

export function parseWigleCsv(text: string): WigleCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const header = findHeader(lines);
  if (!header) return [];

  const rows: WigleCsvRow[] = [];

  for (let i = header.headerIdx + 1; i < lines.length; i++) {
    const columns = parseCsvLine(lines[i]);
    if (columns.length === 0) continue;

    const latitude = parseNumber(
      getByAliases(columns, header.indexByHeader, HEADER_ALIASES.latitude),
    );
    const longitude = parseNumber(
      getByAliases(columns, header.indexByHeader, HEADER_ALIASES.longitude),
    );

    if (latitude === null || longitude === null) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;

    const bssid = getByAliases(columns, header.indexByHeader, HEADER_ALIASES.bssid).toUpperCase();
    if (!bssid) continue;

    rows.push({
      bssid,
      ssid: getByAliases(columns, header.indexByHeader, HEADER_ALIASES.ssid),
      capabilities: getByAliases(columns, header.indexByHeader, HEADER_ALIASES.capabilities),
      firstTimestampSeen: getByAliases(
        columns,
        header.indexByHeader,
        HEADER_ALIASES.firstTimestampSeen,
      ),
      channel: parseInteger(getByAliases(columns, header.indexByHeader, HEADER_ALIASES.channel)),
      frequency: parseInteger(getByAliases(columns, header.indexByHeader, HEADER_ALIASES.frequency)),
      rssi: parseInteger(getByAliases(columns, header.indexByHeader, HEADER_ALIASES.rssi)),
      latitude,
      longitude,
      altitude: parseNumber(getByAliases(columns, header.indexByHeader, HEADER_ALIASES.altitude)),
      accuracy: parseNumber(getByAliases(columns, header.indexByHeader, HEADER_ALIASES.accuracy)),
      rcois: getByAliases(columns, header.indexByHeader, HEADER_ALIASES.rcois),
      mfgrId: getByAliases(columns, header.indexByHeader, HEADER_ALIASES.mfgrId),
      type: getByAliases(columns, header.indexByHeader, HEADER_ALIASES.type) || "WiFi",
    });
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
