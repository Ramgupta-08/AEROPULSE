import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { tokenColor } from "@/lib/echartsTheme";
import { useUi } from "@/lib/store";
import type { BaseInfo } from "@/lib/types";
import { ReadinessRing } from "./ReadinessRing";

/** Label placement to avoid collisions between nearby bases (Hindan / Gwalior / Jodhpur). */
const LABEL_LEFT = new Set(["HDN", "JDH", "JGA"]);

const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [67.5, 6.2],
  [97.8, 37.4],
];

function styleFor(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      states: { type: "geojson", data: "/geo/india-states.geojson" },
      outline: { type: "geojson", data: "/geo/india-outline.geojson" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": tokenColor("surface") } },
      { id: "land", type: "fill", source: "outline", paint: { "fill-color": tokenColor("raised") } },
      { id: "states", type: "line", source: "states", paint: { "line-color": tokenColor("border"), "line-width": 0.6 } },
      { id: "border", type: "line", source: "outline", paint: { "line-color": tokenColor("border-strong"), "line-width": 1.1 } },
    ],
  };
}

/** Offline India map (bundled GeoJSON, no tile server). Click a base to filter the whole app. */
export function BaseMap({ bases, height = 360 }: { bases: BaseInfo[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<{ marker: maplibregl.Marker; root: Root; id: string }[]>([]);
  const theme = useUi((s) => s.theme);
  const { baseFilter, setBaseFilter } = useUi();

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: styleFor(),
      bounds: INDIA_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      scrollZoom: false,
      cooperativeGestures: false,
      renderWorldCopies: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.current = m;
    const ro = new ResizeObserver(() => {
      m.resize();
      m.fitBounds(INDIA_BOUNDS, { padding: 12, animate: false });
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      markers.current.forEach((x) => setTimeout(() => x.root.unmount()));
      markers.current = [];
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.setStyle(styleFor());
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((x) => {
      x.marker.remove();
      setTimeout(() => x.root.unmount());
    });
    markers.current = bases.map((b) => {
      const node = document.createElement("button");
      node.type = "button";
      const left = LABEL_LEFT.has(b.id);
      node.className = "group grid place-items-center rounded-full outline-none";
      node.setAttribute("aria-label", `${b.name}: ${b.readiness_pct}% ready. ${baseFilter === b.id ? "Clear filter" : "Filter app to this base"}`);
      node.onclick = (e) => {
        e.stopPropagation();
        setBaseFilter(useUi.getState().baseFilter === b.id ? null : b.id);
      };
      const root = createRoot(node);
      root.render(
        <>
          <ReadinessRing ready={b.ready} caution={b.caution} grounded={b.grounded} active={baseFilter === b.id} size={30} />
          <span
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface/95 px-1.5 py-0.5 text-[11px] font-medium leading-none text-strong group-hover:border-border-strong ${
              left ? "right-full mr-1" : "left-full ml-1"
            }`}
          >
            {b.name}
          </span>
        </>,
      );
      const marker = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([b.lon, b.lat]).addTo(m);
      return { marker, root, id: b.id };
    });
  }, [bases, baseFilter, setBaseFilter]);

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-b-card" role="region" aria-label="Map of air bases with readiness" />;
}
