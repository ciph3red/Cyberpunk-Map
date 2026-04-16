import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WiFiNetwork } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { parseWigleCsvFileToNetworks } from "@/lib/parse-wigle-csv";
import {
  applyUserApiSettings,
  loadUserApiSettings,
  saveUserApiSettings,
  UserApiSettings,
} from "@/lib/user-api-settings";
import { fetchCsvImportById, saveCsvImportToServer } from "@/lib/csv-imports-api";
import { MAX_MARKERS_PER_CLUSTER } from "@/lib/import-limits";

interface SidebarProps {
  onSearch: (params: any) => void;
  onScanArea: () => void;
  results: WiFiNetwork[];
  totalResults: number;
  onSelectResult: (net: WiFiNetwork) => void;
  isLoading: boolean;
  onImportNetworks: (networks: WiFiNetwork[], fileName: string) => void;
  onClearImported: () => void;
  importedFileName: string | null;
  importedCount: number;
  isImportedMode: boolean;
  onApiSettingsChanged: () => void;
  onSetTriangulationNetworks: (networks: WiFiNetwork[]) => void;
  onSetTriangulationEstimate: (estimate: [number, number] | null) => void;
  selectedNetwork: WiFiNetwork | null;
}

interface TriangulationInput {
  id: number;
  networkName: string;
  signalStrength: string;
}

interface TriangulationSample {
  network: WiFiNetwork;
  targetSignal: number;
  apSignal: number | null;
}

const RSSI_AT_1_METER_DBM = -41;
const PATH_LOSS_EXPONENT = 2.6;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateDistanceMetersFromSignal(signalDbm: number): number {
  const normalizedSignal = clampNumber(signalDbm, -120, -20);
  const distance = 10 ** ((RSSI_AT_1_METER_DBM - normalizedSignal) / (10 * PATH_LOSS_EXPONENT));
  return Math.max(1, Math.min(5000, distance));
}

function estimateDistanceMetersFromTargetAndApSignal(
  targetSignal: number,
  apSignal: number | null,
): number {
  const baseDistance = estimateDistanceMetersFromSignal(targetSignal);
  if (apSignal === null) return baseDistance;

  // If AP-listed signal is stronger than target-detected signal, target is likely farther.
  const delta = apSignal - targetSignal;
  const calibrationFactor = clampNumber(1 + delta * 0.015, 0.6, 1.8);

  return clampNumber(baseDistance * calibrationFactor, 1, 5000);
}

function estimateSampleWeight(targetSignal: number, apSignal: number | null): number {
  const targetWeight = Math.max(1, 120 + targetSignal);
  if (apSignal === null) return targetWeight * 0.75;

  const apStrengthFactor = clampNumber((120 + apSignal) / 100, 0.35, 1.25);
  const consistencyFactor = clampNumber(1 - Math.abs(targetSignal - apSignal) / 90, 0.35, 1);

  return targetWeight * apStrengthFactor * consistencyFactor;
}

function estimateTriangulatedLocation(samples: TriangulationSample[]): [number, number] | null {
  if (samples.length < 3) return null;

  const lat0 = samples.reduce((sum, sample) => sum + sample.network.trilat, 0) / samples.length;
  const lng0 = samples.reduce((sum, sample) => sum + sample.network.trilong, 0) / samples.length;

  const metersPerDegLat = 111_132;
  const metersPerDegLng = Math.max(1, Math.cos((lat0 * Math.PI) / 180) * 111_320);

  const points = samples.map((sample) => {
    const x = (sample.network.trilong - lng0) * metersPerDegLng;
    const y = (sample.network.trilat - lat0) * metersPerDegLat;
    const distance = estimateDistanceMetersFromTargetAndApSignal(
      sample.targetSignal,
      sample.apSignal,
    );
    const weight = estimateSampleWeight(sample.targetSignal, sample.apSignal);

    return { x, y, distance, weight };
  });

  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  const fallbackX = points.reduce((sum, point) => sum + point.x * point.weight, 0) / totalWeight;
  const fallbackY = points.reduce((sum, point) => sum + point.y * point.weight, 0) / totalWeight;

  // Closed-form weighted least-squares initialization works reliably for 4+ APs.
  const base = points[0];
  let jtj00 = 0;
  let jtj01 = 0;
  let jtj11 = 0;
  let jtb0 = 0;
  let jtb1 = 0;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const ax = 2 * (point.x - base.x);
    const ay = 2 * (point.y - base.y);
    const b =
      (point.x * point.x + point.y * point.y - point.distance * point.distance) -
      (base.x * base.x + base.y * base.y - base.distance * base.distance);

    const weight = (point.weight + base.weight) / 2;
    jtj00 += weight * ax * ax;
    jtj01 += weight * ax * ay;
    jtj11 += weight * ay * ay;
    jtb0 += weight * ax * b;
    jtb1 += weight * ay * b;
  }

  const det = jtj00 * jtj11 - jtj01 * jtj01;
  let x = fallbackX;
  let y = fallbackY;

  if (Number.isFinite(det) && Math.abs(det) > 1e-9) {
    x = (jtj11 * jtb0 - jtj01 * jtb1) / det;
    y = (-jtj01 * jtb0 + jtj00 * jtb1) / det;
  }

  for (let i = 0; i < 8; i++) {
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    let g0 = 0;
    let g1 = 0;

    for (const point of points) {
      const dx = x - point.x;
      const dy = y - point.y;
      const range = Math.max(1e-3, Math.hypot(dx, dy));
      const residual = range - point.distance;
      const jx = dx / range;
      const jy = dy / range;

      h00 += point.weight * jx * jx;
      h01 += point.weight * jx * jy;
      h11 += point.weight * jy * jy;
      g0 += point.weight * jx * residual;
      g1 += point.weight * jy * residual;
    }

    const hDet = h00 * h11 - h01 * h01;
    if (!Number.isFinite(hDet) || Math.abs(hDet) < 1e-9) break;

    const stepX = (h11 * g0 - h01 * g1) / hDet;
    const stepY = (-h01 * g0 + h00 * g1) / hDet;

    x -= stepX;
    y -= stepY;

    if (Math.hypot(stepX, stepY) < 0.05) break;
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    x = fallbackX;
    y = fallbackY;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));

  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(minY, Math.min(maxY, y));

  const estimatedLat = lat0 + y / metersPerDegLat;
  const estimatedLng = lng0 + x / metersPerDegLng;

  if (!Number.isFinite(estimatedLat) || !Number.isFinite(estimatedLng)) {
    return null;
  }

  return [estimatedLat, estimatedLng];
}

const CELL_TYPES = ["GSM", "UMTS", "LTE", "CDMA", "WCDMA", "NR"];

function typeColor(type?: string) {
  if (!type || type === "WiFi") return "primary";
  if (type === "BT" || type === "BLE") return "blue-400";
  return "yellow-400";
}

function typeBadgeLabel(net: WiFiNetwork) {
  if (net.type && net.type !== "WiFi") return net.type;
  return net.encryption || "UNK";
}

export function Sidebar({
  onSearch,
  onScanArea,
  results,
  totalResults,
  onSelectResult,
  isLoading,
  onImportNetworks,
  onClearImported,
  importedFileName,
  importedCount,
  isImportedMode,
  onApiSettingsChanged,
  onSetTriangulationNetworks,
  onSetTriangulationEstimate,
  selectedNetwork,
}: SidebarProps) {
  const [ssid, setSsid] = useState("");
  const [netid, setNetid] = useState("");
  const [netType, setNetType] = useState("any");
  const [encryption, setEncryption] = useState("any");
  const [freenet, setFreenet] = useState(false);
  const [centerLat, setCenterLat] = useState("");
  const [centerLng, setCenterLng] = useState("");
  const [variance, setVariance] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [apiSettings, setApiSettings] = useState<UserApiSettings>(() =>
    loadUserApiSettings(),
  );
  const [apiSettingsNotice, setApiSettingsNotice] = useState<string | null>(null);
  const [triangulationInputs, setTriangulationInputs] = useState<TriangulationInput[]>([
    { id: 1, networkName: "", signalStrength: "" },
    { id: 2, networkName: "", signalStrength: "" },
    { id: 3, networkName: "", signalStrength: "" },
  ]);
  const [triangulationNotice, setTriangulationNotice] = useState<string | null>(null);
  const [triangulationError, setTriangulationError] = useState<string | null>(null);

  const isWifi = netType === "any" || netType === "WiFi";
  const isBluetooth = netType === "BT" || netType === "BLE";
  const isCell = CELL_TYPES.includes(netType);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params: Record<string, any> = {};
    if (ssid) params.ssid = ssid;
    if (netid) params.netid = netid;
    if (netType !== "any") params.type = netType;
    if (isWifi && encryption !== "any") params.encryption = encryption;
    if (freenet) params.freenet = true;

    if (centerLat && centerLng) {
      const lat = parseFloat(centerLat);
      const lng = parseFloat(centerLng);
      const v = parseFloat(variance) || 0.05;
      if (!isNaN(lat) && !isNaN(lng)) {
        params.latrange1 = lat - v;
        params.latrange2 = lat + v;
        params.longrange1 = lng - v;
        params.longrange2 = lng + v;
      }
    }

    onSearch(params);
  };

  const handleReset = () => {
    setSsid("");
    setNetid("");
    setNetType("any");
    setEncryption("any");
    setFreenet(false);
    setCenterLat("");
    setCenterLng("");
    setVariance("");
    setTriangulationNotice(null);
    setTriangulationError(null);
    onSetTriangulationNetworks([]);
    onSetTriangulationEstimate(null);
    onSearch({});
  };

  const updateTriangulationInput = (
    id: number,
    field: "networkName" | "signalStrength",
    value: string,
  ) => {
    setTriangulationNotice(null);
    setTriangulationError(null);
    setTriangulationInputs((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const addTriangulationInput = () => {
    setTriangulationNotice(null);
    setTriangulationError(null);
    setTriangulationInputs((prev) => {
      const nextId = prev.length ? Math.max(...prev.map((row) => row.id)) + 1 : 1;
      return [...prev, { id: nextId, networkName: "", signalStrength: "" }];
    });
  };

  const removeTriangulationInput = (id: number) => {
    setTriangulationNotice(null);
    setTriangulationError(null);
    setTriangulationInputs((prev) => {
      if (prev.length <= 3) return prev;
      return prev.filter((row) => row.id !== id);
    });
  };

  const clearTriangulation = () => {
    setTriangulationNotice(null);
    setTriangulationError(null);
    setTriangulationInputs((prev) =>
      prev.map((row) => ({ ...row, networkName: "", signalStrength: "" })),
    );
    onSetTriangulationNetworks([]);
    onSetTriangulationEstimate(null);
  };

  const addSelectedNetworkToTriangulation = () => {
    if (!selectedNetwork) return;

    setTriangulationNotice(null);
    setTriangulationError(null);

    const networkLabel = (selectedNetwork.ssid || "").trim() || selectedNetwork.netid;
    const signalValue =
      selectedNetwork.signal !== undefined && Number.isFinite(selectedNetwork.signal)
        ? String(Math.round(selectedNetwork.signal))
        : "";

    setTriangulationInputs((prev) => {
      const emptyIndex = prev.findIndex((row) => row.networkName.trim() === "");

      if (emptyIndex !== -1) {
        return prev.map((row, index) =>
          index === emptyIndex
            ? { ...row, networkName: networkLabel, signalStrength: signalValue }
            : row,
        );
      }

      const nextId = prev.length ? Math.max(...prev.map((row) => row.id)) + 1 : 1;
      return [...prev, { id: nextId, networkName: networkLabel, signalStrength: signalValue }];
    });

    setTriangulationNotice(`Added ${networkLabel} to triangulation list.`);
  };

  const handleTriangulate = () => {
    setTriangulationNotice(null);
    setTriangulationError(null);

    const requested = triangulationInputs.filter((row) => row.networkName.trim().length > 0);
    if (requested.length < 3) {
      setTriangulationError("Add at least 3 network names for triangulation.");
      onSetTriangulationNetworks([]);
      onSetTriangulationEstimate(null);
      return;
    }

    if (results.length === 0) {
      setTriangulationError("No AP results available in current view.");
      onSetTriangulationNetworks([]);
      onSetTriangulationEstimate(null);
      return;
    }

    const selected: WiFiNetwork[] = [];
    const samples: TriangulationSample[] = [];
    const usedResultIndexes = new Set<number>();

    for (const row of requested) {
      const query = row.networkName.trim().toLowerCase();
      const targetSignalRaw = row.signalStrength.trim();
      if (targetSignalRaw === "") {
        setTriangulationError(`Signal strength is required for \"${row.networkName}\".`);
        onSetTriangulationNetworks([]);
        onSetTriangulationEstimate(null);
        return;
      }

      const targetSignal = Number.parseInt(targetSignalRaw, 10);
      if (!Number.isFinite(targetSignal) || targetSignal > -20 || targetSignal < -120) {
        setTriangulationError(`Signal strength for \"${row.networkName}\" must be between -120 and -20 dBm.`);
        onSetTriangulationNetworks([]);
        onSetTriangulationEstimate(null);
        return;
      }

      const candidates = results
        .map((net, index) => ({ net, index }))
        .filter(({ net }) => {
          const ssid = (net.ssid || "").toLowerCase();
          const netid = net.netid.toLowerCase();
          return ssid.includes(query) || netid.includes(query);
        })
        .sort((a, b) => {
          const aSignal = a.net.signal ?? Number.NEGATIVE_INFINITY;
          const bSignal = b.net.signal ?? Number.NEGATIVE_INFINITY;
          const aDiff = Number.isFinite(aSignal)
            ? Math.abs(aSignal - targetSignal)
            : Number.POSITIVE_INFINITY;
          const bDiff = Number.isFinite(bSignal)
            ? Math.abs(bSignal - targetSignal)
            : Number.POSITIVE_INFINITY;
          if (aDiff !== bDiff) return aDiff - bDiff;

          return bSignal - aSignal;
        });

      if (candidates.length === 0) {
        setTriangulationError(`No AP matched \"${row.networkName}\".`);
        onSetTriangulationNetworks([]);
        onSetTriangulationEstimate(null);
        return;
      }

      const uniqueMatch = candidates.find((candidate) => !usedResultIndexes.has(candidate.index));
      const chosen = uniqueMatch ?? candidates[0];
      usedResultIndexes.add(chosen.index);
      selected.push(chosen.net);
      samples.push({
        network: chosen.net,
        targetSignal,
        apSignal:
          chosen.net.signal !== undefined && Number.isFinite(chosen.net.signal)
            ? chosen.net.signal
            : null,
      });
    }

    if (selected.length < 3) {
      setTriangulationError("Triangulation requires at least 3 matched APs.");
      onSetTriangulationNetworks([]);
      onSetTriangulationEstimate(null);
      return;
    }

    const estimate = estimateTriangulatedLocation(samples);
    if (!estimate) {
      setTriangulationError("Unable to compute triangulation estimate from provided signals.");
      onSetTriangulationNetworks([]);
      onSetTriangulationEstimate(null);
      return;
    }

    onSetTriangulationNetworks(selected);
    onSetTriangulationEstimate(estimate);
    setTriangulationNotice(`Triangulation estimated location from ${selected.length} APs.`);
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportError(null);
    setImportNotice(null);

    try {
      const networks = await parseWigleCsvFileToNetworks(file);

      if (networks.length === 0) {
        setImportError("CSV parsed but no valid coordinates were found.");
        return;
      }

      onImportNetworks(networks, file.name);

      try {
        const persisted = await saveCsvImportToServer(file.name, networks);
        try {
          const refinedImport = await fetchCsvImportById(persisted.importId);
          if (refinedImport.networks.length > 0) {
            onImportNetworks(refinedImport.networks, refinedImport.fileName || file.name);
          }
        } catch {
          // Keep local parsed data active if refined import fetch fails.
        }

        setImportNotice(
          `Saved to server database (${persisted.networkCount} signals, ID: ${persisted.importId.slice(0, 8)}).`,
        );
      } catch (persistErr) {
        const message =
          persistErr instanceof Error
            ? persistErr.message
            : "Failed to save import on server.";
        setImportError(`Imported locally, but server save failed: ${message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read CSV file.";
      setImportError(message);
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  const handleApplyApiSettings = () => {
    const normalized = saveUserApiSettings(apiSettings);
    setApiSettings(normalized);

    applyUserApiSettings(
      normalized,
      typeof import.meta.env.VITE_API_BASE_URL === "string"
        ? import.meta.env.VITE_API_BASE_URL
        : null,
    );

    setApiSettingsNotice("API settings saved and applied.");
    onApiSettingsChanged();
  };

  const handleResetApiSettings = () => {
    const cleared: UserApiSettings = {
      databaseApiUrl: "",
      wigleApiName: "",
      wigleApiToken: "",
    };

    saveUserApiSettings(cleared);
    setApiSettings(cleared);

    applyUserApiSettings(
      cleared,
      typeof import.meta.env.VITE_API_BASE_URL === "string"
        ? import.meta.env.VITE_API_BASE_URL
        : null,
    );

    setApiSettingsNotice("API settings reset to deployment defaults.");
    onApiSettingsChanged();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 pb-2 uppercase font-bold text-xl border-b border-primary flex justify-between items-end cyber-glow shrink-0">
        <span>WiGLE.net</span>
        <span className="text-xs blink-cursor">SYS.ACTIVE_</span>
      </div>

      <ScrollArea className="flex-1">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">

          {/* Network Type */}
          <div className="space-y-1">
            <label className="text-xs uppercase text-primary/70">Network Type</label>
            <Select value={netType} onValueChange={setNetType}>
              <SelectTrigger className="bg-black border-primary rounded-none font-mono text-sm">
                <SelectValue placeholder="ANY" />
              </SelectTrigger>
              <SelectContent className="bg-black border-primary rounded-none font-mono">
                <SelectItem value="any">ANY</SelectItem>
                <SelectItem value="WiFi">WiFi</SelectItem>
                <SelectItem value="BT">Bluetooth (BT)</SelectItem>
                <SelectItem value="BLE">Bluetooth LE (BLE)</SelectItem>
                <SelectItem value="GSM">Cell · GSM</SelectItem>
                <SelectItem value="UMTS">Cell · UMTS (3G)</SelectItem>
                <SelectItem value="LTE">Cell · LTE (4G)</SelectItem>
                <SelectItem value="CDMA">Cell · CDMA</SelectItem>
                <SelectItem value="WCDMA">Cell · WCDMA</SelectItem>
                <SelectItem value="NR">Cell · NR (5G)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* SSID — WiFi only */}
          {isWifi && (
            <div className="space-y-1">
              <label className="text-xs uppercase text-primary/70">SSID</label>
              <Input
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder="ANY"
                className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-sm cyber-glow"
              />
            </div>
          )}

          {/* Encryption — WiFi only */}
          {isWifi && (
            <div className="space-y-1">
              <label className="text-xs uppercase text-primary/70">Encryption</label>
              <Select value={encryption} onValueChange={setEncryption}>
                <SelectTrigger className="bg-black border-primary rounded-none font-mono text-sm">
                  <SelectValue placeholder="ANY" />
                </SelectTrigger>
                <SelectContent className="bg-black border-primary rounded-none font-mono">
                  <SelectItem value="any">ANY</SelectItem>
                  <SelectItem value="None">OPEN (None)</SelectItem>
                  <SelectItem value="WPA3">WPA3</SelectItem>
                  <SelectItem value="WPA2">WPA2</SelectItem>
                  <SelectItem value="WPA">WPA</SelectItem>
                  <SelectItem value="WEP">WEP</SelectItem>
                  <SelectItem value="Unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* BSSID / MAC */}
          <div className="space-y-1">
            <label className="text-xs uppercase text-primary/70">
              {isBluetooth ? "MAC Address" : isCell ? "Cell ID / MCC-MNC" : "BSSID (MAC)"}
            </label>
            <Input
              value={netid}
              onChange={(e) => setNetid(e.target.value)}
              placeholder="XX:XX:XX:XX:XX:XX"
              className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-sm"
            />
          </div>

          {/* Open networks toggle — WiFi only */}
          {isWifi && (
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <div
                onClick={() => setFreenet(!freenet)}
                className={`w-8 h-4 border transition-colors cursor-pointer flex items-center ${freenet ? "border-accent bg-accent/20" : "border-primary/50 bg-black"}`}
              >
                {freenet && <div className="w-2 h-2 bg-accent mx-auto" />}
              </div>
              <span className="text-xs uppercase text-primary/70 group-hover:text-primary transition-colors">
                Open Networks Only
              </span>
            </label>
          )}

          {/* Center Coordinates + Variance */}
          <div className="space-y-1">
            <label className="text-xs uppercase text-primary/70">Center Coords (overrides map)</label>
            <div className="flex gap-2">
              <Input
                value={centerLat}
                onChange={(e) => setCenterLat(e.target.value)}
                placeholder="Lat"
                className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-sm flex-1 min-w-0"
              />
              <Input
                value={centerLng}
                onChange={(e) => setCenterLng(e.target.value)}
                placeholder="Lng"
                className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-sm flex-1 min-w-0"
              />
            </div>
            {(centerLat || centerLng) && (
              <div className="flex items-center gap-2 mt-1">
                <label className="text-xs uppercase text-primary/70 shrink-0">Radius ±</label>
                <Input
                  value={variance}
                  onChange={(e) => setVariance(e.target.value)}
                  placeholder="0.05°"
                  className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-sm"
                />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              variant="outline"
              className="flex-1 rounded-none border-primary hover:bg-primary hover:text-black font-bold uppercase transition-colors text-xs"
            >
              Filter
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onScanArea}
              className="flex-1 rounded-none border-accent text-accent hover:bg-accent hover:text-black font-bold uppercase transition-colors cyber-glow-accent text-xs"
            >
              Scan Area
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
            className="w-full rounded-none text-primary/40 hover:text-primary/70 font-mono text-xs uppercase"
          >
            Reset Filters
          </Button>

          <div className="pt-2 mt-2 border-t border-primary/30 space-y-2">
            <label className="text-xs uppercase text-primary/70">Triangulation</label>

            <div className="flex items-center justify-between gap-2 border border-[#ff5a1f]/40 bg-[#ff5a1f]/10 px-2 py-1 text-xs">
              <span className="text-[#ff5a1f] truncate">
                {selectedNetwork
                  ? `Selected: ${selectedNetwork.ssid || selectedNetwork.netid}`
                  : "Select an AP from map/results"}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={addSelectedNetworkToTriangulation}
                disabled={!selectedNetwork}
                className="h-7 px-2 rounded-none text-[#ff5a1f] hover:text-black hover:bg-[#ff5a1f] disabled:text-primary/40 disabled:hover:bg-transparent"
              >
                Add Selected
              </Button>
            </div>

            {triangulationInputs.map((row) => (
              <div key={row.id} className="flex gap-2 items-center">
                <Input
                  value={row.networkName}
                  onChange={(event) =>
                    updateTriangulationInput(row.id, "networkName", event.target.value)
                  }
                  placeholder="Network name / BSSID"
                  className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-xs flex-1 min-w-0"
                />
                <Input
                  value={row.signalStrength}
                  onChange={(event) =>
                    updateTriangulationInput(row.id, "signalStrength", event.target.value)
                  }
                  placeholder="Target -65"
                  className="w-24 bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-xs"
                />
                {triangulationInputs.length > 3 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeTriangulationInput(row.id)}
                    className="h-8 px-2 rounded-none text-primary/70 hover:text-red-400 hover:bg-black text-xs"
                  >
                    X
                  </Button>
                )}
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTriangulate}
                className="flex-1 rounded-none border-[#ff5a1f] text-[#ff5a1f] hover:bg-[#ff5a1f] hover:text-black font-bold uppercase transition-colors text-xs"
              >
                Triangulate
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={addTriangulationInput}
                className="rounded-none text-primary/70 hover:text-primary hover:bg-black text-xs uppercase"
              >
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={clearTriangulation}
                className="rounded-none text-primary/70 hover:text-primary hover:bg-black text-xs uppercase"
              >
                Clear
              </Button>
            </div>

            {triangulationError && (
              <div className="text-xs text-red-400 border border-red-500/40 bg-red-900/10 px-2 py-1">
                {triangulationError}
              </div>
            )}

            {triangulationNotice && (
              <div className="text-xs text-[#ff5a1f] border border-[#ff5a1f]/40 bg-[#ff5a1f]/10 px-2 py-1">
                {triangulationNotice}
              </div>
            )}
          </div>

          <div className="pt-2 mt-2 border-t border-primary/30 space-y-2">
            <label className="text-xs uppercase text-primary/70">Import CSV</label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvImport}
              disabled={isImporting}
              className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-xs"
            />

            <div className="text-[11px] text-primary/60 uppercase leading-relaxed">
              TEMPLATE: [BSSID],[SSID],[Capabilities],[First timestamp seen],[Channel],[Frequency],[RSSI],[Latitude],[Longitude],[Altitude],[Accuracy],[RCOIs],[MfgrId],[Type]
            </div>

            <div className="text-[11px] text-primary/60 uppercase leading-relaxed">
              MAX DISPLAYED PER CLUSTER: {MAX_MARKERS_PER_CLUSTER}
            </div>

            {isImportedMode && (
              <div className="flex items-center justify-between gap-2 border border-accent/40 bg-accent/10 px-2 py-1 text-xs uppercase">
                <span className="text-accent truncate">
                  CSV: {importedFileName || "import.csv"} ({importedCount})
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClearImported}
                  className="h-6 px-2 rounded-none text-primary hover:text-accent hover:bg-black"
                >
                  Use API
                </Button>
              </div>
            )}

            {importError && (
              <div className="text-xs text-red-400 border border-red-500/40 bg-red-900/10 px-2 py-1">
                {importError}
              </div>
            )}

            {importNotice && (
              <div className="text-xs text-accent border border-accent/40 bg-accent/10 px-2 py-1">
                {importNotice}
              </div>
            )}
          </div>

          <div className="pt-2 mt-2 border-t border-primary/30 space-y-2">
            <label className="text-xs uppercase text-primary/70">API Settings</label>

            <div className="space-y-1">
              <label className="text-[11px] uppercase text-primary/60">Database API URL</label>
              <Input
                value={apiSettings.databaseApiUrl}
                onChange={(e) => {
                  setApiSettingsNotice(null);
                  setApiSettings((prev) => ({ ...prev, databaseApiUrl: e.target.value }));
                }}
                placeholder="https://api.example.com"
                className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase text-primary/60">WiGLE API Name</label>
              <Input
                value={apiSettings.wigleApiName}
                onChange={(e) => {
                  setApiSettingsNotice(null);
                  setApiSettings((prev) => ({ ...prev, wigleApiName: e.target.value }));
                }}
                placeholder="YOUR_WIGLE_NAME"
                className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase text-primary/60">WiGLE API Token</label>
              <Input
                type="password"
                value={apiSettings.wigleApiToken}
                onChange={(e) => {
                  setApiSettingsNotice(null);
                  setApiSettings((prev) => ({ ...prev, wigleApiToken: e.target.value }));
                }}
                placeholder="YOUR_WIGLE_TOKEN"
                className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-xs"
              />
            </div>

            <div className="text-[11px] text-primary/60 uppercase leading-relaxed">
              WI-GLE credentials are sent to backend headers X-WIGLE-API-NAME and X-WIGLE-API-TOKEN.
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleApplyApiSettings}
                className="flex-1 rounded-none border-primary hover:bg-primary hover:text-black font-bold uppercase transition-colors text-xs"
              >
                Apply APIs
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleResetApiSettings}
                className="flex-1 rounded-none text-primary/70 hover:text-primary hover:bg-black text-xs uppercase"
              >
                Clear
              </Button>
            </div>

            {apiSettingsNotice && (
              <div className="text-xs text-accent border border-accent/40 bg-accent/10 px-2 py-1">
                {apiSettingsNotice}
              </div>
            )}
          </div>
        </form>

        {/* Results list */}
        <div className="px-4 pb-4">
          <div className="border-t border-primary/50 pt-2 mb-2 flex justify-between items-center text-xs uppercase">
            <span>Results: {totalResults}</span>
            {isLoading && <span className="text-accent animate-pulse">Scanning...</span>}
          </div>

          <div className="border border-primary/30 p-2 bg-black/50">
            <div className="flex flex-col gap-2 pr-1">
              {results.map((net, i) => (
                <div
                  key={`${net.netid}-${i}`}
                  onClick={() => onSelectResult(net)}
                  className="p-2 border border-primary/30 hover:border-primary hover:bg-primary/10 cursor-pointer transition-colors group flex flex-col gap-1"
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-bold text-sm truncate group-hover:text-white flex-1 min-w-0">
                      {net.ssid || (net.type && net.type !== "WiFi" ? `[${net.type}]` : "<HIDDEN>")}
                    </span>
                    <Badge
                      variant="outline"
                      className={`rounded-none text-[10px] uppercase shrink-0 border-${typeColor(net.type)}`}
                    >
                      {typeBadgeLabel(net)}
                    </Badge>
                  </div>
                  <div className="text-xs text-primary/60 flex justify-between">
                    <span className="truncate">{net.netid}</span>
                    {net.channel != null && <span className="shrink-0">CH:{net.channel}</span>}
                  </div>
                  {net.signal != null && (
                    <div className="flex items-center gap-1 mt-1">
                      <div className="h-1 bg-primary/20 flex-1">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min(100, Math.max(0, 100 + (net.signal || -100)))}%` }}
                        />
                      </div>
                      <span className="text-[10px] w-8 text-right shrink-0">{net.signal}dB</span>
                    </div>
                  )}
                </div>
              ))}
              {results.length === 0 && !isLoading && (
                <div className="text-center p-4 text-primary/50 text-sm">
                  NO_NETWORKS_FOUND
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
