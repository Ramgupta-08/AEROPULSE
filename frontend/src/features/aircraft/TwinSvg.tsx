import { cn } from "@/lib/utils";
import type { ComponentBrief } from "@/lib/types";

/**
 * Original top-down schematic of a generic aircraft (not modelled on any real type).
 * Component zones are clickable and coloured by health.
 */
interface Zone {
  kind: string;
  position?: string;
  label: string;
  path?: string;
  rect?: { x: number; y: number; w: number; h: number; rx?: number };
  labelAt: [number, number];
}

const toneFill = {
  ready: "fill-ready/25 stroke-ready",
  caution: "fill-caution/30 stroke-caution",
  grounded: "fill-grounded/30 stroke-grounded",
} as const;

function engineZones(n: number): Zone[] {
  if (n === 1) return [{ kind: "engine", position: "Engine 1", label: "ENG 1", rect: { x: 186, y: 300, w: 28, h: 96, rx: 10 }, labelAt: [200, 412] }];
  if (n === 2)
    return [
      { kind: "engine", position: "Engine 1", label: "ENG 1", rect: { x: 168, y: 300, w: 26, h: 96, rx: 10 }, labelAt: [150, 350] },
      { kind: "engine", position: "Engine 2", label: "ENG 2", rect: { x: 206, y: 300, w: 26, h: 96, rx: 10 }, labelAt: [250, 350] },
    ];
  // Four wing-mounted engines (transport)
  return [
    { kind: "engine", position: "Engine 1", label: "E1", rect: { x: 62, y: 214, w: 20, h: 46, rx: 8 }, labelAt: [72, 274] },
    { kind: "engine", position: "Engine 2", label: "E2", rect: { x: 118, y: 196, w: 20, h: 46, rx: 8 }, labelAt: [128, 256] },
    { kind: "engine", position: "Engine 3", label: "E3", rect: { x: 262, y: 196, w: 20, h: 46, rx: 8 }, labelAt: [272, 256] },
    { kind: "engine", position: "Engine 4", label: "E4", rect: { x: 318, y: 214, w: 20, h: 46, rx: 8 }, labelAt: [328, 274] },
  ];
}

const SYSTEM_ZONES: Zone[] = [
  { kind: "avionics", label: "Avionics", rect: { x: 188, y: 46, w: 24, h: 40, rx: 8 }, labelAt: [200, 36] },
  { kind: "ecs", label: "ECS", rect: { x: 186, y: 98, w: 28, h: 26, rx: 6 }, labelAt: [240, 114] },
  { kind: "fuel", label: "Fuel", path: "M150 210 L184 196 L184 250 L130 262 Z M250 210 L216 196 L216 250 L270 262 Z", labelAt: [110, 236] },
  { kind: "hydraulics", label: "Hydraulics", rect: { x: 188, y: 222, w: 24, h: 40, rx: 6 }, labelAt: [200, 286] },
  { kind: "landing_gear", label: "Gear", path: "M193 136 h14 v14 h-14 Z M150 252 h14 v18 h-14 Z M236 252 h14 v18 h-14 Z", labelAt: [296, 268] },
  { kind: "flight_controls", label: "Flight controls", path: "M60 268 L118 252 L118 264 L64 280 Z M340 268 L282 252 L282 264 L336 280 Z M168 418 L190 410 L190 422 L170 430 Z M232 418 L210 410 L210 422 L230 430 Z", labelAt: [70, 300] },
  { kind: "apu", label: "APU", rect: { x: 191, y: 404, w: 18, h: 20, rx: 5 }, labelAt: [200, 446] },
];

export function TwinSvg({
  components,
  engines,
  selected,
  onSelect,
  isTransport,
}: {
  components: ComponentBrief[];
  engines: number;
  selected: number | null;
  onSelect: (c: ComponentBrief) => void;
  isTransport: boolean;
}) {
  const zones = [...SYSTEM_ZONES, ...engineZones(engines)];
  const find = (z: Zone) => components.find((c) => (z.position ? c.position === z.position : c.kind === z.kind));
  const wing = isTransport
    ? "M200 168 L380 252 L380 268 L200 236 L20 268 L20 252 Z"
    : "M200 170 L344 292 L344 308 L216 292 L184 292 L56 308 L56 292 Z";
  const tail = isTransport ? "M200 392 L272 420 L272 430 L200 420 L128 430 L128 420 Z" : "M200 392 L250 424 L250 434 L200 426 L150 434 L150 424 Z";
  return (
    <svg viewBox="0 0 400 460" className="h-full w-full" role="group" aria-label="Digital twin schematic. Select a component zone for details.">
      {/* airframe */}
      <g className="fill-raised stroke-border-strong" strokeWidth={1.2}>
        <path d={wing} />
        <path d={tail} />
        <path d="M200 22 C214 38 220 70 220 120 L222 380 C222 404 212 424 200 436 C188 424 178 404 178 380 L180 120 C180 70 186 38 200 22 Z" />
      </g>
      <path d="M192 60 C196 52 204 52 208 60 L208 88 L192 88 Z" className="fill-bg/60 stroke-border-strong" strokeWidth={1} />
      <line x1="200" y1="96" x2="200" y2="390" className="stroke-border" strokeDasharray="2 4" />
      {zones.map((z) => {
        const c = find(z);
        if (!c) return null;
        const active = selected === c.id;
        const cls = cn(toneFill[c.tone], "cursor-pointer transition-[fill,stroke] duration-200 outline-none", active ? "stroke-[2.5]" : "stroke-[1.4]");
        const label = `${c.position}: health ${c.health.toFixed(0)} of 100, ${c.tone}. ${c.rul_unit === "sorties" ? `${c.p50.toFixed(0)} sorties` : `${c.p50_days.toFixed(0)} days`} remaining`;
        const common = {
          className: cls,
          role: "button",
          tabIndex: 0,
          "aria-label": label,
          "aria-pressed": active,
          onClick: () => onSelect(c),
          onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(c)),
        };
        return (
          <g key={z.position ?? z.kind}>
            <title>{label}</title>
            {z.rect ? <rect x={z.rect.x} y={z.rect.y} width={z.rect.w} height={z.rect.h} rx={z.rect.rx} {...common} /> : <path d={z.path} {...common} />}
            <text
              x={z.labelAt[0]}
              y={z.labelAt[1]}
              textAnchor="middle"
              className={cn("pointer-events-none select-none", active ? "fill-strong" : "fill-subtle")}
              style={{ fontSize: 10, fontWeight: 500 }}
            >
              {z.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
