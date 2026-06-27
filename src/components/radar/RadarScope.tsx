import { useEffect, useMemo } from "react";
import type { MouseEvent } from "react";
import {
  bearingRangeFromPoint,
  nmToScreen,
  padBearing,
  pointFromBearingRange,
  screenToBearingRange,
} from "@/sim/math";
import type {
  Contact,
  RadarSettings,
  Scenario,
  SensorTrack,
} from "@/sim/types";

const ACQUISITION_GATE_PX = 30;

interface RadarScopeProps {
  scenario: Scenario;
  contacts: Contact[];
  tracks: Map<string, SensorTrack>;
  settings: RadarSettings;
  sweepDeg: number;
  selectedId: string | null;
  hoverId: string | null;
  cursor: { x: number; y: number };
  size: number;
  onCursor: (cursor: { x: number; y: number }) => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

export function RadarScope({
  scenario,
  contacts,
  tracks,
  settings,
  sweepDeg,
  selectedId,
  hoverId,
  cursor,
  size,
  onCursor,
  onHover,
  onSelect,
}: RadarScopeProps) {
  const radius = size / 2 - 34;
  const visibleContacts = contacts.filter((contact) => {
    const track = tracks.get(contact.id);
    return !contact.dropped && track?.visible;
  });
  const rings = ringScale(settings.rangeNm);
  const cursorBR = screenToBearingRange(
    cursor.x,
    cursor.y,
    settings.rangeNm,
    radius,
  );
  const clutter = useMemo(
    () => makeClutter(scenario.seed, radius, settings, scenario),
    [scenario, radius, settings],
  );
  const nearestId = useMemo(
    () => findNearest(cursor, visibleContacts, settings.rangeNm, radius),
    [cursor, visibleContacts, settings.rangeNm, radius],
  );

  useEffect(() => {
    onHover(nearestId);
  }, [nearestId, onHover]);

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    onCursor(mouseToScopePoint(event, size));
  };

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    const clickCursor = mouseToScopePoint(event, size);
    const clickedId = findNearest(
      clickCursor,
      visibleContacts,
      settings.rangeNm,
      radius,
    );
    onCursor(clickCursor);
    onSelect(clickedId);
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      onMouseMove={handleMove}
      onClick={handleClick}
      style={{ cursor: "none" }}
      role="img"
      aria-label="ALH procedural maritime radar scope"
    >
      <defs>
        <clipPath id="scopeClip">
          <circle r={radius} />
        </clipPath>
        <radialGradient id="sweepGrad" cx="0" cy="0" r="1">
          <stop offset="0%" stopColor="#7fffae" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#7fffae" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle r={radius + 13} fill="none" stroke="#0c2a18" strokeWidth={2} />
      <circle r={radius} fill="#021008" stroke="#1d6a3c" strokeWidth={1.2} />

      <g clipPath="url(#scopeClip)">
        <Coastline
          points={scenario.coastline}
          rangeNm={settings.rangeNm}
          radius={radius}
        />
        <ProtectedZones
          scenario={scenario}
          rangeNm={settings.rangeNm}
          radius={radius}
        />
        <ShippingLanes
          scenario={scenario}
          rangeNm={settings.rangeNm}
          radius={radius}
        />
        <Weather
          scenario={scenario}
          rangeNm={settings.rangeNm}
          radius={radius}
        />
        {clutter.map((dot, i) => (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            fill="#6effa2"
            opacity={dot.opacity}
          />
        ))}
      </g>

      {rings.map((nm) => {
        const r = (nm / settings.rangeNm) * radius;
        return (
          <g key={nm}>
            <circle
              r={r}
              fill="none"
              stroke="#0e6b3a"
              strokeOpacity={0.5}
              strokeDasharray="2 5"
              strokeWidth={0.75}
            />
            <text x={5} y={-r - 3} fill="#3aa468" fontSize={9}>
              {nm}NM
            </text>
          </g>
        );
      })}

      {Array.from({ length: 36 }).map((_, i) => {
        const deg = i * 10;
        const p1 = pointFromBearingRange(
          deg,
          settings.rangeNm * (i % 3 === 0 ? 0.94 : 0.975),
        );
        const p2 = pointFromBearingRange(deg, settings.rangeNm);
        const a = nmToScreen(p1, settings.rangeNm, radius);
        const b = nmToScreen(p2, settings.rangeNm, radius);
        return (
          <line
            key={deg}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#1d6a3c"
            strokeOpacity={i % 3 === 0 ? 0.9 : 0.45}
          />
        );
      })}

      {Array.from({ length: 12 }).map((_, i) => {
        const deg = i * 30;
        const p = nmToScreen(
          pointFromBearingRange(deg, settings.rangeNm * 0.9),
          settings.rangeNm,
          radius,
        );
        return (
          <text
            key={deg}
            x={p.x}
            y={p.y + 3}
            fill="#3aa468"
            fontSize={9}
            textAnchor="middle"
          >
            {padBearing(deg)}
          </text>
        );
      })}

      <line
        x1={-radius}
        y1={0}
        x2={radius}
        y2={0}
        stroke="#0e3a20"
        strokeWidth={0.6}
      />
      <line
        x1={0}
        y1={-radius}
        x2={0}
        y2={radius}
        stroke="#0e3a20"
        strokeWidth={0.6}
      />
      <SectorOverlay settings={settings} radius={radius} />

      <g transform={`rotate(${sweepDeg - 90})`}>
        <path
          d={`M0,0 L${radius},0 A${radius},${radius} 0 0 0 ${radius * Math.cos((-24 * Math.PI) / 180)},${
            radius * Math.sin((-24 * Math.PI) / 180)
          } Z`}
          fill="url(#sweepGrad)"
        />
        <path
          d={`M0,0 L${radius},0 A${radius},${radius} 0 0 1 ${radius * Math.cos((7 * Math.PI) / 180)},${
            radius * Math.sin((7 * Math.PI) / 180)
          } Z`}
          fill="#7fffae"
          opacity={0.08}
        />
        <line
          x1={0}
          y1={0}
          x2={radius}
          y2={0}
          stroke="#7fffae"
          strokeOpacity={0.85}
        />
      </g>

      {visibleContacts.map((contact) => (
        <ContactSymbol
          key={contact.id}
          contact={contact}
          track={tracks.get(contact.id)}
          rangeNm={settings.rangeNm}
          radius={radius}
          selected={selectedId === contact.id}
          hovered={hoverId === contact.id}
        />
      ))}

      <Cursor
        x={cursor.x}
        y={cursor.y}
        bearing={cursorBR.bearingDeg}
        range={cursorBR.rangeNm}
      />
      <text
        x={0}
        y={-radius - 10}
        fill="#7fffae"
        fontSize={11}
        textAnchor="middle"
      >
        N
      </text>
    </svg>
  );
}

function ContactSymbol({
  contact,
  track,
  rangeNm,
  radius,
  selected,
  hovered,
}: {
  contact: Contact;
  track?: SensorTrack;
  rangeNm: number;
  radius: number;
  selected: boolean;
  hovered: boolean;
}) {
  const p = nmToScreen(contact.position, rangeNm, radius);
  const color =
    contact.classification === "ANOMALOUS"
      ? "#ffb347"
      : contact.classification === "AIS"
        ? "#9cdcff"
        : "#7fffae";
  const rawFade = track?.trackFile
    ? 1
    : Math.max(0.18, 1 - (track?.ageSeconds ?? 14) / 14);
  const opacity = Math.max(0.14, (track?.strength ?? 0.4) * rawFade);
  const heading = nmToScreen(
    pointFromBearingRange(
      contact.headingDeg,
      Math.min(8, 1 + contact.speedKts / 6),
    ),
    rangeNm,
    radius,
  );

  return (
    <g transform={`translate(${p.x},${p.y})`} opacity={opacity}>
      {contact.trail.slice(1, 12).map((trail, i) => {
        const t = nmToScreen(trail, rangeNm, radius);
        return (
          <circle
            key={i}
            cx={t.x - p.x}
            cy={t.y - p.y}
            r={1}
            fill={color}
            opacity={0.42 - i * 0.03}
          />
        );
      })}
      {track?.painted && (
        <circle r={8} fill="none" stroke="#7fffae" strokeOpacity={0.3} />
      )}
      {track?.trackFile && (
        <line
          x1={0}
          y1={0}
          x2={heading.x}
          y2={heading.y}
          stroke={color}
          strokeOpacity={0.85}
          strokeWidth={1}
        />
      )}
      {symbolFor(contact.classification, color)}
      {(selected || contact.designated) && <Brackets color={color} />}
      {hovered && !selected && (
        <circle
          r={13}
          fill="none"
          stroke={color}
          strokeDasharray="2 2"
          opacity={0.65}
        />
      )}
      {(hovered || selected || track?.trackFile) && (
        <text x={10} y={-8} fontSize={9} fill={color}>
          {contact.id}
        </text>
      )}
      {track?.trackFile && track.ageSeconds > 18 && (
        <text x={10} y={4} fontSize={8} fill="#ffb347">
          COAST
        </text>
      )}
      {track?.cluttered && (
        <text x={10} y={4} fontSize={8} fill="#ffb347">
          CLTR
        </text>
      )}
      {track?.merged && (
        <text x={10} y={15} fontSize={8} fill="#ffb347">
          MERGE
        </text>
      )}
    </g>
  );
}

function symbolFor(classification: Contact["classification"], color: string) {
  if (classification === "AIS")
    return (
      <rect
        x={-5}
        y={-5}
        width={10}
        height={10}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
      />
    );
  if (classification === "ANOMALOUS")
    return (
      <polygon
        points="0,-7 6,5 -6,5"
        fill="none"
        stroke={color}
        strokeWidth={1.2}
      />
    );
  if (classification === "EO_ID") {
    return (
      <g>
        <polygon
          points="0,-6 6,0 0,6 -6,0"
          fill="none"
          stroke={color}
          strokeWidth={1.2}
        />
        <circle r={1.5} fill={color} />
      </g>
    );
  }
  if (classification === "TRACKED")
    return (
      <polygon
        points="0,-6 6,0 0,6 -6,0"
        fill="none"
        stroke={color}
        strokeWidth={1.2}
      />
    );
  return <circle r={2.4} fill={color} />;
}

function Brackets({ color }: { color: string }) {
  return (
    <g stroke={color} strokeWidth={1} fill="none">
      <path d="M-11,-11 L-11,-7 M-11,-11 L-7,-11" />
      <path d="M11,-11 L11,-7 M11,-11 L7,-11" />
      <path d="M-11,11 L-11,7 M-11,11 L-7,11" />
      <path d="M11,11 L11,7 M11,11 L7,11" />
    </g>
  );
}

function Cursor({
  x,
  y,
  bearing,
  range,
}: {
  x: number;
  y: number;
  bearing: number;
  range: number;
}) {
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <circle r={14} fill="none" stroke="#7fffae" strokeOpacity={0.72} />
      <line x1={-22} y1={0} x2={-6} y2={0} stroke="#7fffae" />
      <line x1={6} y1={0} x2={22} y2={0} stroke="#7fffae" />
      <line x1={0} y1={-22} x2={0} y2={-6} stroke="#7fffae" />
      <line x1={0} y1={6} x2={0} y2={22} stroke="#7fffae" />
      <text x={18} y={-16} fontSize={9} fill="#7fffae">
        B{padBearing(bearing)} R{range.toFixed(1)}NM
      </text>
    </g>
  );
}

function Coastline({
  points,
  rangeNm,
  radius,
}: {
  points: { x: number; y: number }[];
  rangeNm: number;
  radius: number;
}) {
  const path = points
    .map((point, i) => {
      const p = nmToScreen(point, rangeNm, radius);
      return `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <path
      d={`${path} Z`}
      fill="#0a2a16"
      fillOpacity={0.58}
      stroke="#1f6b3a"
      strokeWidth={0.8}
    />
  );
}

function ShippingLanes({
  scenario,
  rangeNm,
  radius,
}: {
  scenario: Scenario;
  rangeNm: number;
  radius: number;
}) {
  return (
    <g>
      {scenario.lanes.map((lane, i) => {
        const a = nmToScreen(lane.a, rangeNm, radius);
        const b = nmToScreen(lane.b, rangeNm, radius);
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#1d6a3c"
            strokeDasharray="5 6"
            opacity={0.55}
          />
        );
      })}
    </g>
  );
}

function ProtectedZones({
  scenario,
  rangeNm,
  radius,
}: {
  scenario: Scenario;
  rangeNm: number;
  radius: number;
}) {
  return (
    <g>
      {scenario.protectedZones.map((zone) => {
        const p = nmToScreen(zone.center, rangeNm, radius);
        return (
          <circle
            key={zone.label}
            cx={p.x}
            cy={p.y}
            r={(zone.radiusNm / rangeNm) * radius}
            fill="none"
            stroke="#ffb347"
            strokeDasharray="4 4"
            opacity={0.35}
          />
        );
      })}
    </g>
  );
}

function Weather({
  scenario,
  rangeNm,
  radius,
}: {
  scenario: Scenario;
  rangeNm: number;
  radius: number;
}) {
  return (
    <g>
      {scenario.rainCells.map((cell, i) => {
        const p = nmToScreen(cell.center, rangeNm, radius);
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={(cell.radiusNm / rangeNm) * radius}
            fill="#78ffae"
            fillOpacity={0.06 * cell.intensity}
            stroke="#7fffae"
            strokeDasharray="1 4"
            opacity={0.4}
          />
        );
      })}
    </g>
  );
}

function SectorOverlay({
  settings,
  radius,
}: {
  settings: RadarSettings;
  radius: number;
}) {
  if (settings.sectorWidthDeg >= 359) return null;
  const start = settings.sectorCenterDeg - settings.sectorWidthDeg / 2;
  const end = settings.sectorCenterDeg + settings.sectorWidthDeg / 2;
  const a = pointFromBearingRange(start, 1);
  const b = pointFromBearingRange(end, 1);
  return (
    <g opacity={0.45}>
      <line
        x1={0}
        y1={0}
        x2={a.x * radius}
        y2={-a.y * radius}
        stroke="#ffb347"
        strokeDasharray="3 5"
      />
      <line
        x1={0}
        y1={0}
        x2={b.x * radius}
        y2={-b.y * radius}
        stroke="#ffb347"
        strokeDasharray="3 5"
      />
    </g>
  );
}

function ringScale(rangeNm: number) {
  if (rangeNm <= 10) return [2, 5, 10].filter((r) => r <= rangeNm);
  if (rangeNm <= 20) return [5, 10, 15, 20].filter((r) => r <= rangeNm);
  if (rangeNm <= 40) return [10, 20, 30, 40].filter((r) => r <= rangeNm);
  return [20, 40, 80, 120].filter((r) => r <= rangeNm);
}

function findNearest(
  cursor: { x: number; y: number },
  contacts: Contact[],
  rangeNm: number,
  radius: number,
) {
  let best: { id: string; d: number } | null = null;
  for (const contact of contacts) {
    const p = nmToScreen(contact.position, rangeNm, radius);
    const d = Math.hypot(cursor.x - p.x, cursor.y - p.y);
    if (d < ACQUISITION_GATE_PX && (!best || d < best.d))
      best = { id: contact.id, d };
  }
  return best?.id ?? null;
}

function mouseToScopePoint(event: MouseEvent<SVGSVGElement>, size: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left - size / 2,
    y: event.clientY - rect.top - size / 2,
  };
}

function makeClutter(
  seed: number,
  radius: number,
  settings: RadarSettings,
  scenario: Scenario,
) {
  const count =
    80 + Math.round(settings.gain * 0.7) + scenario.rainCells.length * 70;
  let value =
    seed +
    Math.round(radius) +
    settings.rangeNm * 11 +
    settings.seaClutter * 3 +
    settings.rainClutter;
  const random = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
  return Array.from({ length: count }).map(() => {
    const angle = random() * Math.PI * 2;
    const rr = Math.sqrt(random()) * radius;
    return {
      x: Math.cos(angle) * rr,
      y: Math.sin(angle) * rr,
      r: 0.55 + random() * 0.85,
      opacity: 0.03 + random() * (settings.mode === "WEATHER" ? 0.2 : 0.12),
    };
  });
}
