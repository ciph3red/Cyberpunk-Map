import { useState } from "react";
import { useSearchNetworks, getSearchNetworksQueryKey, SearchNetworksParams, WiFiNetwork } from "@workspace/api-client-react";
import { WigleMap } from "@/components/Map";
import { Sidebar } from "@/components/Sidebar";
import { StatsPanel } from "@/components/StatsPanel";
import { useQueryClient } from "@tanstack/react-query";

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
  const queryClient = useQueryClient();

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
  const [importedNetworks, setImportedNetworks] = useState<WiFiNetwork[] | null>(null);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);

  const isImportedMode = importedNetworks !== null;

  const { data, isLoading, isError, error } = useSearchNetworks(searchParams, {
    query: {
      enabled: !isImportedMode,
      queryKey: getSearchNetworksQueryKey(searchParams),
    },
  });

  const activeNetworks = importedNetworks ?? data?.results ?? [];
  const activeTotalResults = importedNetworks ? importedNetworks.length : (data?.totalResults || 0);

  const handleSearch = (params: Partial<SearchNetworksParams>) => {
    setImportedNetworks(null);
    setImportedFileName(null);
    setSearchParams(prev => ({ ...prev, ...params }));
  };

  const handleBoundsChange = (newBounds: any) => {
    setBounds(newBounds);
  };

  const handleScanArea = () => {
    setImportedNetworks(null);
    setImportedFileName(null);
    setSearchParams(prev => ({ ...prev, ...bounds }));
  };

  const handleImportNetworks = (networks: WiFiNetwork[], fileName: string) => {
    setImportedNetworks(networks);
    setImportedFileName(fileName);
    if (networks.length > 0) {
      setTargetCoords([networks[0].trilat, networks[0].trilong]);
    }
  };

  const handleClearImported = () => {
    setImportedNetworks(null);
    setImportedFileName(null);
  };

  const handleApiSettingsChanged = () => {
    setImportedNetworks(null);
    setImportedFileName(null);
    void queryClient.invalidateQueries();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black text-primary font-mono select-none">
      {/* Main Map Area */}
      <div className="flex-1 relative">
        <WigleMap 
          networks={activeNetworks}
          onBoundsChange={handleBoundsChange}
          targetCoords={targetCoords}
          onNetworkSelect={(net) => setTargetCoords([net.trilat, net.trilong])}
        />
        
        {/* Loading Overlay */}
        {!isImportedMode && isLoading && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000] bg-black/80 p-4 border border-primary cyber-glow flicker text-xl flex items-center gap-2">
            <span>[</span>
            <span className="text-accent animate-pulse">SCANNING</span>
            <span>]</span>
            <span className="blink-cursor">_</span>
          </div>
        )}

        {isImportedMode && (
          <div className="absolute top-4 left-4 z-[1000] bg-black/90 px-4 py-2 border border-accent text-accent font-bold text-xs max-w-md">
            CSV MODE ACTIVE: {importedFileName || "import.csv"} ({activeTotalResults} points)
          </div>
        )}

        {/* Error Overlay */}
        {!isImportedMode && isError && (
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
          results={activeNetworks}
          totalResults={activeTotalResults}
          onSelectResult={(net) => setTargetCoords([net.trilat, net.trilong])}
          isLoading={!isImportedMode && isLoading}
          onImportNetworks={handleImportNetworks}
          onClearImported={handleClearImported}
          importedFileName={importedFileName}
          importedCount={importedNetworks?.length || 0}
          isImportedMode={isImportedMode}
          onApiSettingsChanged={handleApiSettingsChanged}
        />
      </div>

      {/* Floating Stats */}
      <div className="absolute bottom-4 left-4 z-[1000]">
        <StatsPanel />
      </div>
    </div>
  );
}
