import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useSearchNetworks, getSearchNetworksQueryKey, WiFiNetwork } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface MapEventsProps {
  onBoundsChange: (bounds: { latrange1: number; latrange2: number; longrange1: number; longrange2: number }) => void;
}

function clampLng(v: number) { return Math.max(-180, Math.min(180, v)); }
function clampLat(v: number) { return Math.max(-90, Math.min(90, v)); }

function MapEvents({ onBoundsChange }: MapEventsProps) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        latrange1: clampLat(bounds.getSouth()),
        latrange2: clampLat(bounds.getNorth()),
        longrange1: clampLng(bounds.getWest()),
        longrange2: clampLng(bounds.getEast()),
      });
    },
  });
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
  return (
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={[37.7749, -122.4194]}
        zoom={13}
        style={{ width: "100%", height: "100%", background: "#050a0e" }}
        className="z-0"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEvents onBoundsChange={onBoundsChange} />
        <MapFlyTo target={targetCoords} />
        
        {networks.map((net) => (
          <CircleMarker
            key={net.netid}
            center={[net.trilat, net.trilong]}
            radius={6}
            pathOptions={{
              color: getNetworkColor(net.encryption),
              fillColor: getNetworkColor(net.encryption),
              fillOpacity: 0.6,
              weight: 2,
            }}
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
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
