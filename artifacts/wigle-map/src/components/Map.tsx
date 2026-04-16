import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  CircleMarker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { WiFiNetwork } from "@workspace/api-client-react";
import { MAX_MARKERS_PER_CLUSTER } from "@/lib/import-limits";

const CLUSTER_ZOOM_THRESHOLD = 16;
const TRIANGULATION_PATTERN_ID = "triangulation-stripe-fill";
const TRIANGULATION_COLOR = "#ff5a1f";

interface MapViewport {
  south: number;
  north: number;
  west: number;
  east: number;
  zoom: number;
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
      zoom: map.getZoom(),
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

function ensureTriangulationPattern(svg: SVGSVGElement): void {
  if (svg.querySelector(`#${TRIANGULATION_PATTERN_ID}`)) {
    return;
  }

  const ns = "http://www.w3.org/2000/svg";
  let defs = svg.querySelector("defs");

  if (!defs) {
    defs = document.createElementNS(ns, "defs");
    svg.prepend(defs);
  }

  const pattern = document.createElementNS(ns, "pattern");
  pattern.setAttribute("id", TRIANGULATION_PATTERN_ID);
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", "12");
  pattern.setAttribute("height", "12");
  pattern.setAttribute("patternTransform", "rotate(45)");

  const background = document.createElementNS(ns, "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", "12");
  background.setAttribute("height", "12");
  background.setAttribute("fill", "#000000");

  const stripe = document.createElementNS(ns, "rect");
  stripe.setAttribute("x", "0");
  stripe.setAttribute("y", "0");
  stripe.setAttribute("width", "6");
  stripe.setAttribute("height", "12");
  stripe.setAttribute("fill", TRIANGULATION_COLOR);

  pattern.append(background, stripe);
  defs.append(pattern);
}

interface TriangulationOverlayProps {
  networks: WiFiNetwork[];
  estimatedPoint?: [number, number] | null;
}

function TriangulationOverlay({ networks, estimatedPoint }: TriangulationOverlayProps) {
  const map = useMap();
  const polygonRef = useRef<L.Polygon | null>(null);

  const points = useMemo(
    () => {
      const raw = networks
        .filter((net) => Number.isFinite(net.trilat) && Number.isFinite(net.trilong))
        .map((net) => [net.trilat, net.trilong] as [number, number]);

      if (raw.length < 3) return raw;

      const center = raw.reduce(
        (acc, point) => {
          acc.lat += point[0];
          acc.lng += point[1];
          return acc;
        },
        { lat: 0, lng: 0 },
      );

      center.lat /= raw.length;
      center.lng /= raw.length;

      return raw.slice().sort((a, b) => {
        const angleA = Math.atan2(a[0] - center.lat, a[1] - center.lng);
        const angleB = Math.atan2(b[0] - center.lat, b[1] - center.lng);
        return angleA - angleB;
      });
    },
    [networks],
  );

  useEffect(() => {
    if (points.length < 3) return;

    const applyPattern = () => {
      const svg = map.getPanes().overlayPane.querySelector("svg") as SVGSVGElement | null;
      const element = polygonRef.current?.getElement() as SVGPathElement | null;
      if (!svg || !element) return;

      ensureTriangulationPattern(svg);
      element.setAttribute("fill", `url(#${TRIANGULATION_PATTERN_ID})`);
      element.setAttribute("fill-opacity", "0.3");
      element.setAttribute("stroke", TRIANGULATION_COLOR);
    };

    const applyPatternNextFrame = () => {
      window.requestAnimationFrame(applyPattern);
    };

    applyPatternNextFrame();

    map.on("zoomend", applyPatternNextFrame);
    map.on("moveend", applyPatternNextFrame);
    map.on("viewreset", applyPatternNextFrame);

    return () => {
      map.off("zoomend", applyPatternNextFrame);
      map.off("moveend", applyPatternNextFrame);
      map.off("viewreset", applyPatternNextFrame);
    };
  }, [map, points]);

  if (points.length < 3 && !estimatedPoint) return null;

  return (
    <>
      {points.length >= 3 && (
        <Polygon
          ref={polygonRef}
          positions={points}
          pathOptions={{
            color: TRIANGULATION_COLOR,
            weight: 2,
            opacity: 1,
            fillOpacity: 0.3,
          }}
        />
      )}
      {estimatedPoint && (
        <CircleMarker
          center={estimatedPoint}
          radius={8}
          pathOptions={{
            color: TRIANGULATION_COLOR,
            fillColor: TRIANGULATION_COLOR,
            fillOpacity: 0.8,
            weight: 2,
          }}
        >
          <Popup>
            <div className="bg-[#050a0e] text-[#ff5a1f] p-2 border border-[#ff5a1f] shadow-[0_0_10px_#ff5a1f] font-mono text-xs">
              Estimated triangulation location
            </div>
          </Popup>
        </CircleMarker>
      )}
    </>
  );
}

function MapFlyTo({ target }: MapFlyToProps) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, 20, { duration: 1.5 });
    }
  }, [target, map]);
  return null;
}

export interface WigleMapProps {
  networks: WiFiNetwork[];
  triangulationNetworks?: WiFiNetwork[];
  triangulationEstimate?: [number, number] | null;
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

export function WigleMap({
  networks,
  triangulationNetworks = [],
  triangulationEstimate = null,
  onBoundsChange,
  targetCoords,
  onNetworkSelect,
}: WigleMapProps) {
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

  const groupedData = useMemo(() => {
    if (!viewport) {
      return { 
        markers: [] as WiFiNetwork[],
        clusters: [] as { lat: number; lng: number; count: number }[],
        inViewCount: 0,
      };
    }

    const inView = networks.filter((net) => {
      return (
        net.trilat >= viewport.south &&
        net.trilat <= viewport.north &&
        net.trilong >= viewport.west &&
        net.trilong <= viewport.east
      );
    });

    if (viewport.zoom < CLUSTER_ZOOM_THRESHOLD) {
      // Grid-based clustering for zoomed out views to avoid lag.
      const radius = viewport.zoom <= 12 ? 0.05 : viewport.zoom <= 14 ? 0.01 : 0.005;
      const grid = new Map<string, { lat: number; lng: number; count: number }>();

      inView.forEach((net) => {
        const gridLat = Math.round(net.trilat / radius) * radius;
        const gridLng = Math.round(net.trilong / radius) * radius;
        const key = `${gridLat.toFixed(4)},${gridLng.toFixed(4)}`;
        const existing = grid.get(key);
        if (!existing) {
          grid.set(key, { lat: gridLat, lng: gridLng, count: 1 });
        } else {
          existing.count++;
        }
      });

      return { markers: [], clusters: Array.from(grid.values()), inViewCount: inView.length };
    }

    // Zoomed-in mode renders AP markers directly, capped per dense cell.
    const cellRadius = viewport.zoom >= 19 ? 0.0005 : viewport.zoom >= 18 ? 0.001 : 0.002;
    const denseCells = new Map<string, WiFiNetwork[]>();

    inView.forEach((net) => {
      const cellLat = Math.round(net.trilat / cellRadius) * cellRadius;
      const cellLng = Math.round(net.trilong / cellRadius) * cellRadius;
      const key = `${cellLat.toFixed(6)},${cellLng.toFixed(6)}`;
      const bucket = denseCells.get(key);
      if (!bucket) {
        denseCells.set(key, [net]);
        return;
      }
      bucket.push(net);
    });

    const markers: WiFiNetwork[] = [];
    denseCells.forEach((bucket) => {
      bucket.sort((a, b) => (b.signal ?? Number.NEGATIVE_INFINITY) - (a.signal ?? Number.NEGATIVE_INFINITY));
      markers.push(...bucket.slice(0, MAX_MARKERS_PER_CLUSTER));
    });

    return { markers, clusters: [], inViewCount: inView.length };
  }, [networks, viewport]);

  const createClusterIcon = (count: number) => {
    return L.divIcon({
      className: "bg-transparent border-0",
      html: `<div class="flex items-center justify-center w-8 h-8 bg-[#050a0e]/80 border border-[#00ffff] rounded-full text-[#00ffff] font-mono text-[10px] shadow-[0_0_8px_#00ffff]">
        ${count > 999 ? '999+' : count}
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  const isZoomedOutClusterMode = Boolean(viewport && viewport.zoom < CLUSTER_ZOOM_THRESHOLD);

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={[37.7749, -122.4194]}
        zoom={13}
        minZoom={2}
        maxZoom={22}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={40}
        style={{ width: "100%", height: "100%", background: "#050a0e" }}
        className="z-0"
        zoomControl
        updateWhenIdle
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
          maxNativeZoom={20}
          maxZoom={22}
          updateWhenIdle
          keepBuffer={2}
        />
        <MapEvents onBoundsChange={onBoundsChange} onViewportChange={setViewport} />
        <MapFlyTo target={targetCoords} />
        <TriangulationOverlay
          networks={triangulationNetworks}
          estimatedPoint={triangulationEstimate}
        />
        
        {groupedData.clusters.map((cluster, index) => (
          <Marker
            key={`cluster-${cluster.lat}-${cluster.lng}-${index}`}
            position={[cluster.lat, cluster.lng]}
            icon={createClusterIcon(cluster.count)}
          />
        ))}

        {groupedData.markers.map((net, index) => (
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

      {isZoomedOutClusterMode && (
        <div className="absolute top-4 right-4 z-[1000] bg-black/80 border border-red-500 text-red-400 px-3 py-1 text-xs font-mono uppercase">
          {`Clustered ${groupedData.inViewCount.toLocaleString()} APs in view`}
        </div>
      )}
    </div>
  );
}
