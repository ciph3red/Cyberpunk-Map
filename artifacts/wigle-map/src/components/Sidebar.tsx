import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WiFiNetwork } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  onSearch: (params: any) => void;
  onScanArea: () => void;
  results: WiFiNetwork[];
  totalResults: number;
  onSelectResult: (net: WiFiNetwork) => void;
  isLoading: boolean;
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

export function Sidebar({ onSearch, onScanArea, results, totalResults, onSelectResult, isLoading }: SidebarProps) {
  const [ssid, setSsid] = useState("");
  const [netid, setNetid] = useState("");
  const [netType, setNetType] = useState("any");
  const [encryption, setEncryption] = useState("any");
  const [freenet, setFreenet] = useState(false);
  const [centerLat, setCenterLat] = useState("");
  const [centerLng, setCenterLng] = useState("");
  const [variance, setVariance] = useState("");

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
    onSearch({});
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
