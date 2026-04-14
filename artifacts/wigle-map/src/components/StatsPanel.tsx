import { useGetStats, useGetUserStats, getGetStatsQueryKey, getGetUserStatsQueryKey } from "@workspace/api-client-react";

export function StatsPanel() {
  const { data: globalStats } = useGetStats({
    query: {
      queryKey: getGetStatsQueryKey()
    }
  });

  const { data: userStats } = useGetUserStats({
    query: {
      queryKey: getGetUserStatsQueryKey()
    }
  });

  return (
    <div className="bg-[#050a0e]/90 border border-primary p-3 flex flex-col gap-2 font-mono text-xs shadow-[0_0_15px_rgba(0,255,255,0.2)] backdrop-blur-sm pointer-events-none">
      <div className="flex items-center justify-between border-b border-primary/50 pb-1">
        <span className="text-primary/70 uppercase">Global.SYS</span>
        <span className="text-accent blink-cursor">ONLN</span>
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="text-primary/70">TOTAL_NETS:</div>
        <div className="text-right text-white">{globalStats?.nettotal?.toLocaleString() || "---"}</div>
        
        <div className="text-primary/70">SEC_OPEN:</div>
        <div className="text-right text-accent">{globalStats?.netnoenc?.toLocaleString() || "---"}</div>
        
        <div className="text-primary/70">SEC_WEP:</div>
        <div className="text-right text-secondary">{globalStats?.netwep?.toLocaleString() || "---"}</div>
        
        <div className="text-primary/70">SEC_WPAX:</div>
        <div className="text-right text-primary">{(globalStats?.netwpa2 || 0 + (globalStats?.netwpa || 0))?.toLocaleString() || "---"}</div>
      </div>

      <div className="flex items-center justify-between border-b border-primary/50 pb-1 mt-1">
        <span className="text-primary/70 uppercase">Oper.ID</span>
        <span className="text-primary">{userStats?.userName || "ANONYMOUS"}</span>
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="text-primary/70">RANK:</div>
        <div className="text-right text-white">{userStats?.rank?.toLocaleString() || "---"}</div>
        
        <div className="text-primary/70">DISCOVERED:</div>
        <div className="text-right text-white">{userStats?.statistics?.totalWiFiLocations?.toLocaleString() || "---"}</div>
      </div>
    </div>
  );
}
