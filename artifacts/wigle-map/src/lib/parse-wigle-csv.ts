export interface WigleCsvRow {
  mac: string;
  ssid: string;
  authMode: string;
  firstSeen: string;
  channel: number;
  rssi: number;
  lat: number;
  lng: number;
  altitude: number;
  accuracy: number;
  type: string;
}

export function parseWigleCsv(text: string): WigleCsvRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.startsWith("mac,") || lower.startsWith('"mac",')) {
      headers = lines[i].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return [];

  const get = (row: string[], name: string): string => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] ?? "").trim().replace(/^"|"$/g, "") : "";
  };

  const rows: WigleCsvRow[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 8) continue;

    const lat = parseFloat(get(cols, "currentlatitude"));
    const lng = parseFloat(get(cols, "currentlongitude"));
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const rssiRaw = parseInt(get(cols, "rssi"), 10);

    rows.push({
      mac: get(cols, "mac"),
      ssid: get(cols, "ssid"),
      authMode: get(cols, "authmode"),
      firstSeen: get(cols, "firstseen"),
      channel: parseInt(get(cols, "channel"), 10) || 0,
      rssi: isNaN(rssiRaw) ? -100 : rssiRaw,
      lat,
      lng,
      altitude: parseFloat(get(cols, "altitudemeters")) || 0,
      accuracy: parseFloat(get(cols, "accuracymeters")) || 0,
      type: get(cols, "type") || "WiFi",
    });
  }

  return rows;
}

export interface BssidGroup {
  mac: string;
  ssid: string;
  authMode: string;
  type: string;
  observations: WigleCsvRow[];
  bestRssi: number;
}

export function groupByBssid(rows: WigleCsvRow[]): BssidGroup[] {
  const map = new Map<string, BssidGroup>();
  for (const row of rows) {
    const key = row.mac.toUpperCase();
    if (!map.has(key)) {
      map.set(key, { mac: key, ssid: row.ssid, authMode: row.authMode, type: row.type, observations: [], bestRssi: -999 });
    }
    const g = map.get(key)!;
    g.observations.push(row);
    if (row.rssi > g.bestRssi) g.bestRssi = row.rssi;
  }
  return Array.from(map.values()).sort((a, b) => b.observations.length - a.observations.length);
}
