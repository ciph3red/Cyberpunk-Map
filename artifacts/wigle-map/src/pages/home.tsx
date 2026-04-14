import { useState } from "react";
import { useSearchNetworks, getSearchNetworksQueryKey, SearchNetworksParams, WiFiNetwork } from "@workspace/api-client-react";
import { WigleMap } from "@/components/Map";
import { Sidebar } from "@/components/Sidebar";
import { StatsPanel } from "@/components/StatsPanel";

function getErrorMessage(error: unknown): string {
  const status = (error as any)?.status as number | undefined;
  const message = (error as any)?.message as string | undefined;
  const dataMsg = (error as any)?.data?.message as string | undefined;
  if (status === 429) return "[ERR 429] RATE_LIMIT_EXCEEDED — WiGLE daily query quota hit. Try again tomorrow.";
  if (status === 401 || status === 403) return `[ERR ${status}] AUTH_FAILED — Check your API credentials.`;
  if (status === 400) return `[ERR 400] BAD_REQUEST — ${dataMsg || "Invalid search parameters."}`;
  if (status) return `[ERR ${status}] ${message ?? "Request failed."}`;
  if (error instanceof Error) return `[ERR] ${error.message}`;
  return "[ERR] UNKNOWN_FAILURE";
}

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

  const { data, isLoading, isError, error } = useSearchNetworks(searchParams, {
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
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-black/90 px-5 py-3 border border-red-500 text-red-400 flex items-center gap-2 font-bold text-sm max-w-xl text-center" style={{boxShadow:"0 0 12px #ff000080"}}>
            {getErrorMessage(error)}
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
