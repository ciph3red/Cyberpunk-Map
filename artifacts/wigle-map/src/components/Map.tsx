import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { WiFiNetwork } from "@workspace/api-client-react";

const MAX_RENDERED_MARKERS = 1500;

interface MapViewport {
  south: number;
  north: number;
  west: number;
  east: number;
}

interface MapEventsProps {
  onBoundsChange: (bounds: { latrange1: number; latrange2: number; longrange1: number; longrange2: number }) => void;
  onViewportChange: (viewport: MapViewport) => void;
}

function clampLng(v: number) { return Math.max(-180, Math.min(180, v)); }
function clampLat(v: number) { return Math.max(-90, Math.min(90, v)); }

function MapEvents({ onBoundsChange, onViewportChange }: MapEventsProps) {
  const updateFromMap = (map: ReturnType<typeof useMap>) => {
    const bounds = map.getBounds();

    onViewportChange({
      south: clampLat(bounds.getSouth()),
      north: clampLat(bounds.getNorth()),
      west: clampLng(bounds.getWest()),
      east: clampLng(bounds.getEast()),
    });

    onBoundsChange({
      latrange1: clampLat(bounds.getSouth()),
      latrange2: clampLat(bounds.getNorth()),
      longrange1: clampLng(bounds.getWest()),
      longrange2: clampLng(bounds.getEast()),
    });
  };

  const map = useMapEvents({
    moveend: () => {
      updateFromMap(map);
    },
  });

  useEffect(() => {
    updateFromMap(map);
  }, [map]);

  return null;
}

interface MapFlyToProps {
  target: [number, number] | null;
}

function MapFlyTo({ target }: MapFlyToProps) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, 18, { duration: 1.5 });
    }
  }, [target, map]);
  return null;
}

export interface WigleMapProps {
  networks: WiFiNetwork[];
  onBoundsChange: (bounds: { latrange1: number; latrange2: number; longrange1: number; longrange2: number }) => void;
  targetCoords: [number, number] | null;
  onNetworkSelect: (net: WiFiNetwork) => void;
}

const getNetworkColor = (encryption?: string) => {
  if (!encryption || encryption === "Unknown") return "#888888";
  if (encryption === "None") return "#39ff14"; // open = toxic green
  if (encryption.includes("WEP")) return "#ff00ff"; // hot magenta
  if (encryption.includes("WPA")) return "#00ffff"; // WPA/WPA2 = electric cyan
  return "#00ffff";
};

export function WigleMap({ networks, onBoundsChange, targetCoords, onNetworkSelect }: WigleMapProps) {
  const [viewport, setViewport] = useState<MapViewport | null>(null);

  const signalIcon = useMemo(
    () =>
      L.icon({
        iconUrl: "/rdmnd.png",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10],
      }),
    [],
  );

  const visibleNetworks = useMemo(() => {
    if (!viewport) {
      return networks.slice(0, MAX_RENDERED_MARKERS);
    }

    const inView = networks.filter((net) => {
      return (
        net.trilat >= viewport.south &&
        net.trilat <= viewport.north &&
        net.trilong >= viewport.west &&
        net.trilong <= viewport.east
      );
    });

    if (inView.length <= MAX_RENDERED_MARKERS) {
      return inView;
    }

    const step = Math.ceil(inView.length / MAX_RENDERED_MARKERS);
    return inView.filter((_, index) => index % step === 0);
  }, [networks, viewport]);

  const droppedCount = Math.max(0, networks.length - visibleNetworks.length);

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={[37.7749, -122.4194]}
        zoom={13}
        style={{ width: "100%", height: "100%", background: "#050a0e" }}
        className="z-0"
        zoomControl={false}
        updateWhenIdle
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
          updateWhenIdle
          keepBuffer={2}
        />
        <MapEvents onBoundsChange={onBoundsChange} onViewportChange={setViewport} />
        <MapFlyTo target={targetCoords} />
        
        {visibleNetworks.map((net, index) => (
          <Marker
            key={`${net.netid}-${index}`}
            position={[net.trilat, net.trilong]}
            icon={signalIcon}
            eventHandlers={{
              click: () => onNetworkSelect(net),
            }}
          >
            <Popup className="cyber-popup">
              <div className="bg-[#050a0e] text-[#00ffff] p-2 border border-[#00ffff] shadow-[0_0_10px_#00ffff] font-mono text-xs">
                <div className="font-bold text-sm mb-1">{net.ssid || "<HIDDEN>"}</div>
                <div>BSSID: {net.netid}</div>
                <div>ENC: <span style={{ color: getNetworkColor(net.encryption) }}>{net.encryption}</span></div>
                <div>CH: {net.channel} | SIG: {net.signal}</div>
                <div>{net.city}, {net.country}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {droppedCount > 0 && (
        <div className="absolute top-4 right-4 z-[1000] bg-black/80 border border-red-500 text-red-400 px-3 py-1 text-xs font-mono uppercase">
          Rendering {visibleNetworks.length.toLocaleString()} of {networks.length.toLocaleString()} signals
        </div>
      )}
    </div>
  );
}
