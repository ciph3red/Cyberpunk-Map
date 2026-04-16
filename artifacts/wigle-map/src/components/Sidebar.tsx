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
}

interface TriangulationInput {
  id: number;
  networkName: string;
  signalStrength: string;
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
  };

  const handleTriangulate = () => {
    setTriangulationNotice(null);
    setTriangulationError(null);

    const requested = triangulationInputs.filter((row) => row.networkName.trim().length > 0);
    if (requested.length < 3) {
      setTriangulationError("Add at least 3 network names for triangulation.");
      onSetTriangulationNetworks([]);
      return;
    }

    if (results.length === 0) {
      setTriangulationError("No AP results available in current view.");
      onSetTriangulationNetworks([]);
      return;
    }

    const selected: WiFiNetwork[] = [];
    const usedResultIndexes = new Set<number>();

    for (const row of requested) {
      const query = row.networkName.trim().toLowerCase();
      const targetSignal = row.signalStrength.trim() === ""
        ? null
        : Number.parseInt(row.signalStrength.trim(), 10);

      const candidates = results
        .map((net, index) => ({ net, index }))
        .filter(({ net }) => {
          const ssid = (net.ssid || "").toLowerCase();
          const netid = net.netid.toLowerCase();
          return ssid.includes(query) || netid.includes(query);
        })
        .sort((a, b) => {
          if (targetSignal !== null && Number.isFinite(targetSignal)) {
            const aSignal = a.net.signal ?? Number.NEGATIVE_INFINITY;
            const bSignal = b.net.signal ?? Number.NEGATIVE_INFINITY;
            const aDiff = Number.isFinite(aSignal)
              ? Math.abs(aSignal - targetSignal)
              : Number.POSITIVE_INFINITY;
            const bDiff = Number.isFinite(bSignal)
              ? Math.abs(bSignal - targetSignal)
              : Number.POSITIVE_INFINITY;
            if (aDiff !== bDiff) return aDiff - bDiff;
          }

          const aSignal = a.net.signal ?? Number.NEGATIVE_INFINITY;
          const bSignal = b.net.signal ?? Number.NEGATIVE_INFINITY;
          return bSignal - aSignal;
        });

      if (candidates.length === 0) {
        setTriangulationError(`No AP matched \"${row.networkName}\".`);
        onSetTriangulationNetworks([]);
        return;
      }

      const uniqueMatch = candidates.find((candidate) => !usedResultIndexes.has(candidate.index));
      const chosen = uniqueMatch ?? candidates[0];
      usedResultIndexes.add(chosen.index);
      selected.push(chosen.net);
    }

    if (selected.length < 3) {
      setTriangulationError("Triangulation requires at least 3 matched APs.");
      onSetTriangulationNetworks([]);
      return;
    }

    onSetTriangulationNetworks(selected);
    setTriangulationNotice(`Triangulation linked ${selected.length} APs.`);
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
                  placeholder="-65 dBm"
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
