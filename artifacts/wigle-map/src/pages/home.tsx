import { useState } from "react";
import { useSearchNetworks } from "@workspace/api-client-react";
import { SearchNetworksParams } from "@workspace/api-client-react/src/generated/api.schemas";
import { WigleMap } from "@/components/Map";
import { Sidebar } from "@/components/Sidebar";
import { StatsPanel } from "@/components/StatsPanel";
import { WiFiNetwork } from "@workspace/api-client-react/src/generated/api.schemas";
import { getSearchNetworksQueryKey } from "@workspace/api-client-react";

export default function Home() {
  const [bounds, setBounds] = useState({
    latrange1: 37.7,
    latrange2: 37.8,
    longrange1: -122.5,
    longrange2: -122.4,
  });

  const [searchParams, setSearchParams] = useState<SearchNetworksParams>({
    ...bounds,
    resultsPerPage: 100,
  });

  const [targetCoords, setTargetCoords] = useState<[number, number] | null>(null);

  const { data, isLoading, isError } = useSearchNetworks(searchParams, {
    query: {
      enabled: true,
      queryKey: getSearchNetworksQueryKey(searchParams),
    },
  });

  const handleSearch = (params: Partial<SearchNetworksParams>) => {
    setSearchParams(prev => ({ ...prev, ...params }));
  };

  const handleBoundsChange = (newBounds: any) => {
    setBounds(newBounds);
  };

  const handleScanArea = () => {
    setSearchParams(prev => ({ ...prev, ...bounds }));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black text-primary font-mono select-none">
      {/* Main Map Area */}
      <div className="flex-1 relative">
        <WigleMap 
          networks={data?.results || []}
          onBoundsChange={handleBoundsChange}
          targetCoords={targetCoords}
          onNetworkSelect={(net) => setTargetCoords([net.trilat, net.trilong])}
        />
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000] bg-black/80 p-4 border border-primary cyber-glow flicker text-xl flex items-center gap-2">
            <span>[</span>
            <span className="text-accent animate-pulse">SCANNING</span>
            <span>]</span>
            <span className="blink-cursor">_</span>
          </div>
        )}

        {/* Error Overlay */}
        {isError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-black/90 p-4 border border-destructive text-destructive cyber-glow-destructive flex items-center gap-2 font-bold">
            [ERR] CONNECTION_REFUSED
          </div>
        )}
      </div>

      {/* Side Panels */}
      <div className="w-[400px] h-full flex flex-col border-l border-primary bg-[#050a0e] relative z-10 z-[1000]">
        <Sidebar 
          onSearch={handleSearch} 
          onScanArea={handleScanArea}
          results={data?.results || []}
          totalResults={data?.totalResults || 0}
          onSelectResult={(net) => setTargetCoords([net.trilat, net.trilong])}
          isLoading={isLoading}
        />
      </div>

      {/* Floating Stats */}
      <div className="absolute bottom-4 left-4 z-[1000]">
        <StatsPanel />
      </div>
    </div>
  );
}
