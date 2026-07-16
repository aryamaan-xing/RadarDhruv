import { useEffect, useMemo } from "react";
import type { MouseEvent } from "react";
import {
  bearingRangeFromPoint,
  nmToScreen,
  normalizeDeg,
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
const CONTACT_COLOR = "#ffb347";
const TRACK_YELLOW = "#f4e84f";
const RADAR_COVERAGE_HALF_DEG = 95;

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
  const ownHeadingDeg = scenario.ownShip.headingDeg;
  const visibleContacts = contacts.filter((contact) => {
    const track = tracks.get(contact.id);
    return (
      !contact.dropped &&
      track?.visible &&
      !isBehindBlindLine(contact.position, ownHeadingDeg)
    );
  });
  const rings = ringScale(settings.rangeNm);
  const portCoverageLimit = nmToScreen(
    pointFromBearingRange(-RADAR_COVERAGE_HALF_DEG, 1),
    1,
    radius,
  );
  const starboardCoverageLimit = nmToScreen(
    pointFromBearingRange(RADAR_COVERAGE_HALF_DEG, 1),
    1,
    radius,
  );
  const cursorRelativeBR = screenToBearingRange(
    cursor.x,
    cursor.y,
    settings.rangeNm,
    radius,
  );
  const cursorBR = {
    ...cursorRelativeBR,
    bearingDeg: normalizeDeg(cursorRelativeBR.bearingDeg + ownHeadingDeg),
  };
  const nearestId = useMemo(
    () =>
      findNearest(cursor, visibleContacts, settings.rangeNm, radius, ownHeadingDeg),
    [cursor, visibleContacts, settings.rangeNm, radius, ownHeadingDeg],
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
      ownHeadingDeg,
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
      <circle r={radius} fill="#020907" stroke="#d9ded4" strokeWidth={1.1} />

      <g clipPath="url(#scopeClip)">
        <Coastline
          points={scenario.coastline}
          rangeNm={settings.rangeNm}
          radius={radius}
          ownHeadingDeg={ownHeadingDeg}
        />
      </g>

      {rings.map((nm) => {
        const r = (nm / settings.rangeNm) * radius;
        return (
          <g key={nm}>
            <circle
              r={r}
              fill="none"
            stroke="#dce4d6"
            strokeOpacity={0.68}
            strokeWidth={1}
            />
            <text x={5} y={-r - 3} fill="#dce4d6" fontSize={9}>
              {nm}NM
            </text>
          </g>
        );
      })}

      {Array.from({ length: 36 }).map((_, i) => {
        const deg = i * 10;
        const p1 = pointFromBearingRange(
          deg - ownHeadingDeg,
          settings.rangeNm * (i % 3 === 0 ? 0.94 : 0.975),
        );
        const p2 = pointFromBearingRange(deg - ownHeadingDeg, settings.rangeNm);
        const a = nmToScreen(p1, settings.rangeNm, radius);
        const b = nmToScreen(p2, settings.rangeNm, radius);
        return (
          <line
            key={deg}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#dce4d6"
            strokeOpacity={i % 3 === 0 ? 0.42 : 0.18}
          />
        );
      })}

      {Array.from({ length: 12 }).map((_, i) => {
        const deg = i * 30;
        const p = nmToScreen(
          pointFromBearingRange(deg - ownHeadingDeg, settings.rangeNm * 0.9),
          settings.rangeNm,
          radius,
        );
        return (
          <text
            key={deg}
            x={p.x}
            y={p.y + 3}
            fill="#dce4d6"
            fontSize={9}
            textAnchor="middle"
          >
            {padBearing(deg)}
          </text>
        );
      })}

      <line
        x1={0}
        y1={0}
        x2={portCoverageLimit.x}
        y2={portCoverageLimit.y}
        stroke="#ff3842"
        strokeOpacity={0.92}
        strokeWidth={1.2}
      />
      <line
        x1={0}
        y1={0}
        x2={starboardCoverageLimit.x}
        y2={starboardCoverageLimit.y}
        stroke="#ff3842"
        strokeOpacity={0.92}
        strokeWidth={1.2}
      />
      <line
        x1={0}
        y1={-radius}
        x2={0}
        y2={radius}
        stroke="#0e3a20"
        strokeWidth={0.6}
      />
      {visibleContacts.map((contact) => (
        <ContactSymbol
          key={contact.id}
          contact={contact}
          track={tracks.get(contact.id)}
          rangeNm={settings.rangeNm}
          radius={radius}
          selected={selectedId === contact.id}
          hovered={hoverId === contact.id}
          transmitting={settings.transmitting}
          ownHeadingDeg={ownHeadingDeg}
        />
      ))}

      <OwnShipSymbol />
      <Cursor
        x={cursor.x}
        y={cursor.y}
        bearing={cursorBR.bearingDeg}
        range={cursorBR.rangeNm}
      />
      <NorthMarker
        ownHeadingDeg={ownHeadingDeg}
        rangeNm={settings.rangeNm}
        radius={radius}
      />
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
  transmitting,
  ownHeadingDeg,
}: {
  contact: Contact;
  track?: SensorTrack;
  rangeNm: number;
  radius: number;
  selected: boolean;
  hovered: boolean;
  transmitting: boolean;
  ownHeadingDeg: number;
}) {
  const p = worldToScope(contact.position, ownHeadingDeg, rangeNm, radius);
  const symbolColor =
    transmitting && (selected || contact.designated || track?.trackFile)
      ? TRACK_YELLOW
      : CONTACT_COLOR;
  const opacity = 1;
  const heading = nmToScreen(
    pointFromBearingRange(
      contact.headingDeg - ownHeadingDeg,
      Math.min(8, 1 + contact.speedKts / 6),
    ),
    rangeNm,
    radius,
  );

  return (
    <g transform={`translate(${p.x},${p.y})`} opacity={opacity}>
      {contact.trail.slice(1, 12).map((trail, i) => {
        const t = worldToScope(trail, ownHeadingDeg, rangeNm, radius);
        return (
          <circle
            key={i}
            cx={t.x - p.x}
            cy={t.y - p.y}
            r={1}
            fill={symbolColor}
            stroke="#020907"
            strokeWidth={0.4}
            opacity={0.42 - i * 0.03}
          />
        );
      })}
      {track?.painted && (
        <circle r={8} fill="none" stroke={CONTACT_COLOR} strokeOpacity={0.3} />
      )}
      {symbolFor(contact, transmitting, symbolColor, {
        tracked: Boolean(track?.trackFile || contact.designated),
        selected,
        heading,
        hasHistory: contact.trail.length > 3,
      })}
      {transmitting && (selected || contact.designated || track?.trackFile) && (
        <Brackets color={selected ? TRACK_YELLOW : "#dce4d6"} />
      )}
      {transmitting && hovered && !selected && (
        <circle
          r={13}
          fill="none"
          stroke={symbolColor}
          strokeDasharray="2 2"
          opacity={0.65}
        />
      )}
    </g>
  );
}

function symbolFor(
  contact: Contact,
  transmitting: boolean,
  color: string,
  options: {
    tracked: boolean;
    selected: boolean;
    heading: { x: number; y: number };
    hasHistory: boolean;
  },
) {
  if (transmitting && contact.aisActive)
    return (
      <RadarAisSquare
        color={options.selected || options.tracked ? TRACK_YELLOW : CONTACT_COLOR}
        heading={options.heading}
      />
    );

  if (!transmitting) {
    return <ShieldTarget color={color} />;
  }

  return (
    <polygon
      points="0,-7 6,5 -6,5"
      fill="none"
      stroke={color}
      strokeWidth={1.2}
    />
  );
}

function ShieldTarget({ color }: { color: string }) {
  return (
    <path
      d="M-8,-7 L0,-3 L8,-7 L8,6 L0,10 L-8,6 Z"
      fill="none"
      stroke={color}
      strokeWidth={1.35}
    />
  );
}

function RadarAisSquare({
  color,
  heading,
}: {
  color: string;
  heading: { x: number; y: number };
}) {
  return (
    <g>
      <line
        x1={0}
        y1={0}
        x2={heading.x}
        y2={heading.y}
        stroke={color}
        strokeOpacity={0.95}
        strokeWidth={1.1}
      />
      <rect
        x={-6}
        y={-6}
        width={12}
        height={12}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
      />
    </g>
  );
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

function NorthMarker({
  ownHeadingDeg,
  rangeNm,
  radius,
}: {
  ownHeadingDeg: number;
  rangeNm: number;
  radius: number;
}) {
  const p = nmToScreen(
    pointFromBearingRange(-ownHeadingDeg, rangeNm * 0.98),
    rangeNm,
    radius,
  );
  return (
    <text
      x={p.x}
      y={p.y + 4}
      fill="#7fffae"
      fontSize={11}
      textAnchor="middle"
    >
      N
    </text>
  );
}

function Coastline({
  points,
  rangeNm,
  radius,
  ownHeadingDeg,
}: {
  points: { x: number; y: number }[];
  rangeNm: number;
  radius: number;
  ownHeadingDeg: number;
}) {
  const path = points
    .map((point, i) => {
      const p = worldToScope(point, ownHeadingDeg, rangeNm, radius);
      return `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <path
      d={path}
      fill="none"
      stroke="#f2f2e7"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.88}
      strokeWidth={1.4}
    />
  );
}

function OwnShipSymbol() {
  return (
    <g pointerEvents="none">
      <circle r={26} fill="none" stroke="#4cff4c" strokeWidth={1.6} />
      <circle r={13} fill="none" stroke="#36d1ff" strokeWidth={1.1} />
      <ellipse cx={0} cy={-1} rx={5.2} ry={19} fill="#28dffc" fillOpacity={0.86} />
      <path
        d="M0,-23 C5,-17 6,-8 5,-1 C4,8 2,16 0,20 C-2,16 -4,8 -5,-1 C-6,-8 -5,-17 0,-23 Z"
        fill="#28dffc"
        fillOpacity={0.7}
        stroke="#8bf8ff"
        strokeWidth={1}
      />
      <line x1={-25} y1={-2} x2={25} y2={-2} stroke="#8bf8ff" strokeWidth={1.7} />
      <line x1={0} y1={-27} x2={0} y2={27} stroke="#8bf8ff" strokeWidth={1.2} />
      <path d="M-13,2 L-25,9 M13,2 L25,9" stroke="#8bf8ff" strokeWidth={1.2} />
      <path d="M-8,15 L-16,22 M8,15 L16,22" stroke="#8bf8ff" strokeWidth={1.1} />
      <circle r={2.2} fill="#8bf8ff" />
      <line
        x1={0}
        y1={-30}
        x2={0}
        y2={-44}
        stroke="#f4e84f"
        strokeWidth={1.5}
      />
      <polygon points="0,-50 5,-42 -5,-42" fill="#f4e84f" />
    </g>
  );
}

function ShippingLanes({
  scenario,
  rangeNm,
  radius,
  ownHeadingDeg,
}: {
  scenario: Scenario;
  rangeNm: number;
  radius: number;
  ownHeadingDeg: number;
}) {
  return (
    <g>
      {scenario.lanes.map((lane, i) => {
        const a = worldToScope(lane.a, ownHeadingDeg, rangeNm, radius);
        const b = worldToScope(lane.b, ownHeadingDeg, rangeNm, radius);
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
  ownHeadingDeg,
}: {
  scenario: Scenario;
  rangeNm: number;
  radius: number;
  ownHeadingDeg: number;
}) {
  return (
    <g>
      {scenario.protectedZones.map((zone) => {
        const p = worldToScope(zone.center, ownHeadingDeg, rangeNm, radius);
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
  ownHeadingDeg,
}: {
  scenario: Scenario;
  rangeNm: number;
  radius: number;
  ownHeadingDeg: number;
}) {
  return (
    <g>
      {scenario.rainCells.map((cell, i) => {
        const p = worldToScope(cell.center, ownHeadingDeg, rangeNm, radius);
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
  ownHeadingDeg: number,
) {
  let best: { id: string; d: number } | null = null;
  for (const contact of contacts) {
    const p = worldToScope(contact.position, ownHeadingDeg, rangeNm, radius);
    const d = Math.hypot(cursor.x - p.x, cursor.y - p.y);
    if (d < ACQUISITION_GATE_PX && (!best || d < best.d))
      best = { id: contact.id, d };
  }
  return best?.id ?? null;
}

function worldToScope(
  point: { x: number; y: number },
  ownHeadingDeg: number,
  rangeNm: number,
  radius: number,
) {
  const { bearingDeg, rangeNm: pointRangeNm } = bearingRangeFromPoint(point);
  return nmToScreen(
    pointFromBearingRange(bearingDeg - ownHeadingDeg, pointRangeNm),
    rangeNm,
    radius,
  );
}

function isBehindBlindLine(
  point: { x: number; y: number },
  ownHeadingDeg: number,
) {
  const { bearingDeg } = bearingRangeFromPoint(point);
  const relativeBearing = ((bearingDeg - ownHeadingDeg + 540) % 360) - 180;
  return Math.abs(relativeBearing) > RADAR_COVERAGE_HALF_DEG;
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
