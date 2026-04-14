import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WiFiNetwork } from "@workspace/api-client-react/src/generated/api.schemas";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  onSearch: (params: any) => void;
  onScanArea: () => void;
  results: WiFiNetwork[];
  totalResults: number;
  onSelectResult: (net: WiFiNetwork) => void;
  isLoading: boolean;
}

export function Sidebar({ onSearch, onScanArea, results, totalResults, onSelectResult, isLoading }: SidebarProps) {
  const [ssid, setSsid] = useState("");
  const [encryption, setEncryption] = useState("all");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({ 
      ssid: ssid || undefined, 
      encryption: encryption !== "all" ? encryption : undefined 
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4">
      <div className="uppercase font-bold text-xl border-b border-primary pb-2 flex justify-between items-end cyber-glow">
        <span>WiGLE.net</span>
        <span className="text-xs blink-cursor">SYS.ACTIVE_</span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-2">
          <label className="text-xs uppercase text-primary/70">Target SSID</label>
          <Input 
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            placeholder="ANY"
            className="bg-black border-primary rounded-none focus-visible:ring-0 focus-visible:border-accent font-mono text-sm cyber-glow"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase text-primary/70">Encryption</label>
          <Select value={encryption} onValueChange={setEncryption}>
            <SelectTrigger className="bg-black border-primary rounded-none font-mono text-sm">
              <SelectValue placeholder="ALL" />
            </SelectTrigger>
            <SelectContent className="bg-black border-primary rounded-none font-mono">
              <SelectItem value="all">ALL</SelectItem>
              <SelectItem value="None">OPEN</SelectItem>
              <SelectItem value="WPA2">WPA2</SelectItem>
              <SelectItem value="WPA">WPA</SelectItem>
              <SelectItem value="WEP">WEP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button 
            type="submit" 
            variant="outline"
            className="flex-1 rounded-none border-primary hover:bg-primary hover:text-black font-bold uppercase transition-colors"
          >
            Filter
          </Button>
          <Button 
            type="button" 
            variant="outline"
            onClick={onScanArea}
            className="flex-1 rounded-none border-accent text-accent hover:bg-accent hover:text-black font-bold uppercase transition-colors cyber-glow-accent"
          >
            Scan Area
          </Button>
        </div>
      </form>

      <div className="border-t border-primary/50 pt-2 mt-2">
        <div className="flex justify-between items-center text-xs uppercase mb-2">
          <span>Results: {totalResults}</span>
          {isLoading && <span className="text-accent animate-pulse">Scanning...</span>}
        </div>
        
        <ScrollArea className="flex-1 h-[calc(100vh-320px)] border border-primary/30 p-2 bg-black/50">
          <div className="flex flex-col gap-2 pr-3">
            {results.map((net, i) => (
              <div 
                key={`${net.netid}-${i}`}
                onClick={() => onSelectResult(net)}
                className="p-2 border border-primary/30 hover:border-primary hover:bg-primary/10 cursor-pointer transition-colors group flex flex-col gap-1"
              >
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm truncate max-w-[180px] group-hover:text-white">
                    {net.ssid || "<HIDDEN>"}
                  </span>
                  <Badge variant="outline" className={`rounded-none text-[10px] uppercase border-${net.encryption?.includes('WPA') ? 'primary' : net.encryption === 'None' ? 'accent' : 'secondary'}`}>
                    {net.encryption || "UNK"}
                  </Badge>
                </div>
                <div className="text-xs text-primary/60 flex justify-between">
                  <span>{net.netid}</span>
                  <span>CH:{net.channel}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <div className="h-1 bg-primary/20 flex-1">
                    <div 
                      className="h-full bg-primary" 
                      style={{ width: `${Math.min(100, Math.max(0, 100 + (net.signal || -100)))}%` }}
                    />
                  </div>
                  <span className="text-[10px] w-8 text-right">{net.signal}dB</span>
                </div>
              </div>
            ))}
            {results.length === 0 && !isLoading && (
              <div className="text-center p-4 text-primary/50 text-sm">
                NO_NETWORKS_FOUND
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
