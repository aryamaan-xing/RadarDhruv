import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ----- Types -----
type Classification =
  | "UNKNOWN"
  | "TRACKED"
  | "AIS"
  | "SUSPECT"
  | "EO";

type VesselType = "FV" | "MV" | "TKR" | "WAR" | "PAT" | "DHOW" | "TUG";

interface Contact {
  id: string;
  // polar position from own-ship (center)
  bearing: number; // degrees, 0 = North
  range: number; // NM
  speed: number; // knots
  heading: number; // degrees
  ais: boolean;
  classification: Classification;
  trail: { x: number; y: number; age: number }[];
  lastPaint: number; // ms timestamp when last "lit" by sweep
  visible: boolean; // intermittent detection
  designated: boolean;
  vesselType?: VesselType; // not all contacts report this
  suspicious: boolean; // ground-truth flag (hidden from operator until classified)
}

interface LogEntry {
  t: string;
  msg: string;
}

interface RainCell {
  cx: number; // NM east
  cy: number; // NM north
  r: number; // NM radius
  intensity: number; // 0..1
}

interface Scenario {
  contacts: Contact[];
  coastPath: string; // SVG path in NM-space (east/north)
  laneSegments: { x1: number; y1: number; x2: number; y2: number }[]; // NM-space
  rainCells: RainCell[];
  seed: number;
}

// ----- Helpers -----
const MAX_RANGE_NM = 20;
// Simulation accelerator: real ship speeds (knots) would be invisible at scope
// scale within a training session, so compress time. 120 ≈ 2 min/sec.
const TIME_SCALE = 120;

function spawnEdgeContact(rng: () => number): Contact {
  const types: VesselType[] = ["FV", "MV", "TKR", "WAR", "PAT", "DHOW", "TUG"];
  const ais = rng() < 0.55;
  const reportsType = ais ? rng() < 0.85 : rng() < 0.25;
  const vesselType = reportsType ? types[Math.floor(rng() * types.length)] : undefined;
  const suspicious = rng() < 0.18;
  const speed =
    vesselType === "WAR" || vesselType === "PAT"
      ? 18 + rng() * 18
      : vesselType === "FV" || vesselType === "DHOW"
        ? 4 + rng() * 8
        : 8 + rng() * 18;
  const bearing = rng() * 360;
  // inbound heading roughly toward centre, with some scatter
  const inbound = (bearing + 180 + (rng() - 0.5) * 60 + 360) % 360;
  return {
    id: `C${String(10 + Math.floor(rng() * 89)).padStart(2, "0")}${Math.floor(rng() * 4096).toString(16).toUpperCase()}`,
    bearing,
    // appear right at the scope edge and sail inward, like a real picture
    range: MAX_RANGE_NM - 0.05,
    speed,
    heading: inbound,
    ais,
    classification: ais ? "AIS" : "UNKNOWN",
    trail: [],
    lastPaint: 0,
    visible: true,
    designated: false,
    vesselType,
    suspicious,
  };
}

function zulu(d = new Date()) {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}${mm}${ss}Z`;
}
function zuluShort(d = new Date()) {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}${mm}Z`;
}

function polarToXY(bearing: number, range: number, radius: number) {
  const a = ((bearing - 90) * Math.PI) / 180;
  const r = (range / MAX_RANGE_NM) * radius;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

function pad(n: number, w = 3) {
  return String(Math.round(n)).padStart(w, "0");
}

function shortAngleDiff(a: number, b: number) {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}

// NM-space helpers (east=+x, north=+y in NM)
function nmToScreen(nx: number, ny: number, radius: number) {
  // screen y is inverted: north (+ny) renders up (−screenY)
  const s = radius / MAX_RANGE_NM;
  return { x: nx * s, y: -ny * s };
}

// Deterministic PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateScenario(seed: number): Scenario {
  const rnd = mulberry32(seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  // Coastline: jagged polyline along one edge (varies per scenario)
  const coastEdge = pick(["SW", "NW", "SE", "NE"] as const);
  const coastPoints: { x: number; y: number }[] = [];
  const segCount = 18;
  for (let i = 0; i <= segCount; i++) {
    const t = i / segCount;
    const along = -MAX_RANGE_NM * 1.2 + t * MAX_RANGE_NM * 2.4;
    const inward = MAX_RANGE_NM * 0.85 + (rnd() - 0.5) * 3.2;
    let x = 0, y = 0;
    if (coastEdge === "SW") { x = along; y = -inward; }
    else if (coastEdge === "NW") { x = -inward; y = along; }
    else if (coastEdge === "SE") { x = inward; y = along; }
    else { x = along; y = inward; }
    coastPoints.push({ x, y });
  }
  // Close polygon out beyond scope
  const closer = (() => {
    if (coastEdge === "SW") return [{ x: 30, y: -30 }, { x: -30, y: -30 }];
    if (coastEdge === "NW") return [{ x: -30, y: 30 }, { x: -30, y: -30 }];
    if (coastEdge === "SE") return [{ x: 30, y: 30 }, { x: 30, y: -30 }];
    return [{ x: -30, y: 30 }, { x: 30, y: 30 }];
  })();
  const allPts = [...coastPoints, ...closer];
  const coastPath =
    "M " + allPts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ") + " Z";

  // Shipping lanes: 2 corridors as line pairs
  const laneSegments: Scenario["laneSegments"] = [];
  for (let l = 0; l < 2; l++) {
    const bear = Math.floor(rnd() * 360);
    const perp = bear + 90;
    const width = 1.4 + rnd() * 1.0; // NM
    const ux = Math.cos(((bear - 90) * Math.PI) / 180);
    const uy = Math.sin(((bear - 90) * Math.PI) / 180);
    const px = Math.cos(((perp - 90) * Math.PI) / 180);
    const py = Math.sin(((perp - 90) * Math.PI) / 180);
    const offset = (rnd() - 0.5) * 16;
    const cx = px * offset;
    const cy = py * offset;
    // express in NM-space east/north (ux/uy already screen-style; convert)
    // Use direct math instead: bear deg from north → east= sin, north= cos
    const ex = Math.sin((bear * Math.PI) / 180);
    const en = Math.cos((bear * Math.PI) / 180);
    const pex = Math.sin((perp * Math.PI) / 180);
    const pen = Math.cos((perp * Math.PI) / 180);
    const ocx = pex * offset;
    const ocy = pen * offset;
    const len = MAX_RANGE_NM * 1.6;
    for (const side of [-1, 1]) {
      const sx = ocx + pex * side * (width / 2);
      const sy = ocy + pen * side * (width / 2);
      laneSegments.push({
        x1: sx - ex * len,
        y1: sy - en * len,
        x2: sx + ex * len,
        y2: sy + en * len,
      });
    }
    void ux; void uy; void px; void py; void cx; void cy;
  }

  // Rain cells
  const rainCount = 1 + Math.floor(rnd() * 3);
  const rainCells: RainCell[] = [];
  for (let i = 0; i < rainCount; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 4 + rnd() * 12;
    rainCells.push({
      cx: Math.cos(ang) * dist,
      cy: Math.sin(ang) * dist,
      r: 2.2 + rnd() * 3.5,
      intensity: 0.45 + rnd() * 0.45,
    });
  }

  // Contacts: 20–30 mixed
  const total = 20 + Math.floor(rnd() * 11);
  const types: VesselType[] = ["FV", "MV", "TKR", "WAR", "PAT", "DHOW", "TUG"];
  const contacts: Contact[] = [];
  for (let i = 0; i < total; i++) {
    const ais = rnd() < 0.55;
    const reportsType = ais ? rnd() < 0.85 : rnd() < 0.25;
    const vesselType = reportsType ? pick(types) : undefined;
    const suspicious = rnd() < 0.18; // ~18% truly suspicious
    const cls: Classification = ais ? "AIS" : "UNKNOWN";
    const speed =
      vesselType === "WAR" || vesselType === "PAT"
        ? 18 + rnd() * 18
        : vesselType === "FV" || vesselType === "DHOW"
          ? 4 + rnd() * 8
          : 8 + rnd() * 18;
    contacts.push({
      id: `C${String(10 + Math.floor(rnd() * 89)).padStart(2, "0")}${i.toString(16).toUpperCase()}`,
      bearing: rnd() * 360,
      range: 2 + rnd() * (MAX_RANGE_NM - 3),
      speed,
      heading: rnd() * 360,
      ais,
      classification: cls,
      trail: [],
      lastPaint: 0,
      visible: true,
      designated: false,
      vesselType,
      suspicious,
    });
  }

  return { contacts, coastPath, laneSegments, rainCells, seed };
}

export function RadarConsole() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState(720);

  const [sweep, setSweep] = useState(0); // degrees
  const [scenario, setScenario] = useState<Scenario>(() =>
    generateScenario(Math.floor(Math.random() * 1e9)),
  );
  const [contacts, setContacts] = useState<Contact[]>(() => scenario.contacts);

  const [cursor, setCursor] = useState({ x: 0, y: 0 }); // svg coords from center
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [correctMarks, setCorrectMarks] = useState(0);
  const [incorrectMarks, setIncorrectMarks] = useState(0);
  const evaluatedRef = useRef<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([
    { t: zuluShort(), msg: "RADAR ONLINE  X-BAND  20NM" },
    { t: zuluShort(), msg: "OWN POS  12.9N 074.1E" },
    { t: zuluShort(), msg: "SWEEP 12RPM  IF MED" },
    { t: zuluShort(), msg: "SCENARIO LOADED" },
  ]);

  const appendLog = (msg: string) =>
    setLog((l) => [...l.slice(-40), { t: zulu(), msg }]);

  const newScenario = useCallback(() => {
    const sc = generateScenario(Math.floor(Math.random() * 1e9));
    setScenario(sc);
    setContacts(sc.contacts);
    setSelectedId(null);
    setHoverId(null);
    setCorrectMarks(0);
    setIncorrectMarks(0);
    evaluatedRef.current = new Set();
    setLog((l) => [
      ...l.slice(-40),
      { t: zulu(), msg: `NEW SCENARIO  ${sc.contacts.length} CONTACTS` },
    ]);
  }, []);

  // Resize
  useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setSize(Math.max(420, Math.min(r.width, r.height)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Sweep + contact motion loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dtReal = (now - last) / 1000;
      const dt = dtReal * TIME_SCALE;
      last = now;
      // 12 RPM = 72 deg/s
      setSweep((s) => (s + dtReal * 72) % 360);
      setContacts((cs) =>
        cs.map((c) => {
          // advance position based on heading/speed (knots → NM per s)
          // Vessels hold a steady course — real ships don't wobble. Only very
          // rare, small course corrections occur (fishing pattern changes,
          // suspicious vessel manoeuvres). This keeps motion smooth.
          let heading = c.heading;
          let speed = c.speed;
          const t = c.vesselType;
          const sus = c.suspicious;
          // probability per real second of a discrete course adjustment
          let pTurn = 0;
          let turnMag = 0;
          if (t === "FV" || t === "DHOW") { pTurn = 0.03; turnMag = 12; }
          else if (t === "PAT") { pTurn = 0.015; turnMag = 10; }
          else if (t === "WAR") { pTurn = 0.008; turnMag = 6; }
          else if (t === "MV" || t === "TKR" || t === "TUG") { pTurn = 0.003; turnMag = 4; }
          else { pTurn = 0.01; turnMag = 8; }
          if (sus) { pTurn *= 1.6; turnMag *= 1.2; }
          if (Math.random() < pTurn * dtReal) {
            heading += (Math.random() - 0.5) * turnMag;
          }
          // clamp reasonable per type
          const maxSpd = t === "WAR" || t === "PAT" ? 40 : t === "FV" || t === "DHOW" || t === "TUG" ? 14 : 26;
          if (speed > maxSpd) speed = maxSpd;
          if (speed < 0) speed = 0;
          heading = ((heading % 360) + 360) % 360;
          const nmPerSec = speed / 3600;
          const dist = nmPerSec * dt;
          // convert current polar to cartesian (NM, east/north)
          const ax = ((c.bearing - 90) * Math.PI) / 180;
          const cx = c.range * Math.cos(ax);
          const cy = c.range * Math.sin(ax);
          const hx = ((heading - 90) * Math.PI) / 180;
          const nx = cx + dist * Math.cos(hx);
          const ny = cy + dist * Math.sin(hx);
          const newRange = Math.sqrt(nx * nx + ny * ny);
          let newBearing = (Math.atan2(ny, nx) * 180) / Math.PI + 90;
          if (newBearing < 0) newBearing += 360;
          if (newRange > MAX_RANGE_NM) {
            // contact has left the scope — replace with a fresh inbound one
            return spawnEdgeContact(Math.random);
          }
          return { ...c, range: newRange, bearing: newBearing, heading, speed };
        }),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // When sweep crosses a contact's bearing, "paint" it & push trail
  const prevSweepRef = useRef(0);
  useEffect(() => {
    const prev = prevSweepRef.current;
    const curr = sweep;
    setContacts((cs) =>
      cs.map((c) => {
        // detect crossing
        const crossed =
          prev <= curr
            ? c.bearing >= prev && c.bearing <= curr
            : c.bearing >= prev || c.bearing <= curr;
        if (!crossed) return c;
        // intermittent: small chance to drop a paint for UNKNOWN
        const drop = c.classification === "UNKNOWN" && Math.random() < 0.18;
        const lastPaint = drop ? c.lastPaint : performance.now();
        const radius = size / 2 - 30;
        const { x, y } = polarToXY(c.bearing, c.range, radius);
        const trail = [{ x, y, age: 0 }, ...c.trail.slice(0, 14)];
        return { ...c, lastPaint, trail, visible: !drop };
      }),
    );
    prevSweepRef.current = curr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweep, size]);

  // Cursor: keyboard nudge (trackball emulation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 20 : 6;
      if (e.key === "ArrowUp") setCursor((c) => ({ ...c, y: c.y - step }));
      else if (e.key === "ArrowDown") setCursor((c) => ({ ...c, y: c.y + step }));
      else if (e.key === "ArrowLeft") setCursor((c) => ({ ...c, x: c.x - step }));
      else if (e.key === "ArrowRight") setCursor((c) => ({ ...c, x: c.x + step }));
      else if (e.key === "Enter") {
        if (hoverId) selectContact(hoverId);
      } else if (e.key === "Escape") setSelectedId(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId]);

  const radius = size / 2 - 30;

  // Hover detection from cursor
  useEffect(() => {
    let best: { id: string; d: number } | null = null;
    for (const c of contacts) {
      const { x, y } = polarToXY(c.bearing, c.range, radius);
      const d = Math.hypot(x - cursor.x, y - cursor.y);
      if (d < 18 && (!best || d < best.d)) best = { id: c.id, d };
    }
    setHoverId(best ? best.id : null);
  }, [cursor, contacts, radius]);

  const selectContact = (id: string) => {
    setSelectedId(id);
    setContacts((cs) =>
      cs.map((c) =>
        c.id === id
          ? {
              ...c,
              designated: true,
              classification: c.classification === "UNKNOWN" ? "TRACKED" : c.classification,
            }
          : c,
      ),
    );
    appendLog(`TRACK ${id} DESIGNATED`);
  };

  const updateContact = (id: string, patch: Partial<Contact>) =>
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const onSvgMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    setCursor({
      x: e.clientX - rect.left - size / 2,
      y: e.clientY - rect.top - size / 2,
    });
  };

  const onSvgClick = () => {
    if (hoverId) selectContact(hoverId);
    else setSelectedId(null);
  };

  const selected = contacts.find((c) => c.id === selectedId) || null;

  // Range rings labels
  const rings = [5, 10, 15, 20];

  // Clutter dots (regenerate slowly)
  const clutter = useMemo(() => {
    const arr: { x: number; y: number; o: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      arr.push({
        x: r * Math.cos(ang),
        y: r * Math.sin(ang),
        o: 0.05 + Math.random() * 0.12,
      });
    }
    return arr;
    // re-roll on size or every minute
  }, [radius, scenario.seed]);

  // Rain clutter dots
  const rainDots = useMemo(() => {
    const arr: { x: number; y: number; o: number }[] = [];
    const s = radius / MAX_RANGE_NM;
    for (const cell of scenario.rainCells) {
      const count = Math.floor(cell.r * cell.r * 28 * cell.intensity);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * cell.r;
        const nx = cell.cx + Math.cos(a) * rr;
        const ny = cell.cy + Math.sin(a) * rr;
        arr.push({
          x: nx * s,
          y: -ny * s,
          o: 0.18 + Math.random() * 0.35 * cell.intensity,
        });
      }
    }
    return arr;
  }, [radius, scenario]);

  const suspiciousCount = contacts.filter((c) => c.suspicious).length;

  // ----- Render -----
  return (
    <div
      className="min-h-screen w-full text-[#7fffae]"
      style={{
        backgroundColor: "#020604",
        fontFamily:
          "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace",
      }}
    >
      {/* Top status bar */}
      <TopBar sweep={sweep} contacts={contacts} onNewScenario={newScenario} />

      <div className="flex h-[calc(100vh-44px)] w-full">
        {/* Left rail */}
        <SideRail
          contacts={contacts}
          selectedId={selectedId}
          suspiciousCount={suspiciousCount}
          correctMarks={correctMarks}
          incorrectMarks={incorrectMarks}
          onNewScenario={newScenario}
        />

        {/* Radar PPI */}
        <div
          ref={wrapRef}
          className="relative flex-1 flex items-center justify-center overflow-hidden"
          style={{
            background:
              "radial-gradient(circle at center, #041208 0%, #010402 70%, #000 100%)",
          }}
        >
          <svg
            ref={svgRef}
            width={size}
            height={size}
            viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
            onMouseMove={onSvgMove}
            onClick={onSvgClick}
            style={{ cursor: "none" }}
          >
            <defs>
              <radialGradient id="sweepGrad" cx="0" cy="0" r="1">
                <stop offset="0%" stopColor="#7fffae" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#7fffae" stopOpacity="0" />
              </radialGradient>
              <filter id="ph-glow">
                <feGaussianBlur stdDeviation="1.2" />
              </filter>
              <clipPath id="scopeClip">
                <circle r={radius} />
              </clipPath>
            </defs>

            {/* Outer scope frame */}
            <circle r={radius + 14} fill="none" stroke="#0c2a18" strokeWidth={2} />
            <circle r={radius + 6} fill="none" stroke="#0e3a20" strokeWidth={1} />

            {/* Static geo layer — clipped to scope */}
            <g clipPath="url(#scopeClip)">
              {/* Coastline (landmass) */}
              <g transform={`scale(${radius / MAX_RANGE_NM}, ${-radius / MAX_RANGE_NM})`}>
                <path
                  d={scenario.coastPath}
                  fill="#0a2a16"
                  fillOpacity={0.55}
                  stroke="#1f6b3a"
                  strokeWidth={0.12}
                  strokeOpacity={0.9}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
              {/* Shipping lanes */}
              <g>
                {scenario.laneSegments.map((s, i) => {
                  const a = nmToScreen(s.x1, s.y1, radius);
                  const b = nmToScreen(s.x2, s.y2, radius);
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#1d6a3c"
                      strokeOpacity={0.55}
                      strokeDasharray="3 5"
                      strokeWidth={0.7}
                    />
                  );
                })}
              </g>
              {/* Rain cell halos */}
              <g>
                {scenario.rainCells.map((c, i) => {
                  const p = nmToScreen(c.cx, c.cy, radius);
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={(c.r / MAX_RANGE_NM) * radius}
                      fill="#3aa468"
                      fillOpacity={0.05 * c.intensity}
                      stroke="#1d6a3c"
                      strokeOpacity={0.25}
                      strokeDasharray="1 3"
                      strokeWidth={0.5}
                    />
                  );
                })}
              </g>
            </g>

            {/* Range rings */}
            {rings.map((nm) => {
              const r = (nm / MAX_RANGE_NM) * radius;
              return (
                <g key={nm}>
                  <circle
                    r={r}
                    fill="none"
                    stroke="#0e6b3a"
                    strokeOpacity={0.45}
                    strokeDasharray="2 4"
                    strokeWidth={0.7}
                  />
                  <text
                    x={4}
                    y={-r - 2}
                    fill="#3aa468"
                    fontSize={9}
                    opacity={0.7}
                  >
                    {nm}NM
                  </text>
                </g>
              );
            })}

            {/* Bearing graticule */}
            {Array.from({ length: 36 }).map((_, i) => {
              const ang = (i * 10 - 90) * (Math.PI / 180);
              const major = i % 3 === 0;
              const r1 = radius - (major ? 14 : 6);
              const r2 = radius;
              return (
                <line
                  key={i}
                  x1={r1 * Math.cos(ang)}
                  y1={r1 * Math.sin(ang)}
                  x2={r2 * Math.cos(ang)}
                  y2={r2 * Math.sin(ang)}
                  stroke="#1d6a3c"
                  strokeOpacity={major ? 0.9 : 0.5}
                  strokeWidth={major ? 1 : 0.6}
                />
              );
            })}
            {/* Bearing labels every 30 */}
            {Array.from({ length: 12 }).map((_, i) => {
              const deg = i * 30;
              const ang = ((deg - 90) * Math.PI) / 180;
              const r = radius - 22;
              return (
                <text
                  key={deg}
                  x={r * Math.cos(ang)}
                  y={r * Math.sin(ang) + 3}
                  fill="#3aa468"
                  fontSize={9}
                  textAnchor="middle"
                  opacity={0.85}
                >
                  {pad(deg)}
                </text>
              );
            })}

            {/* Cross-hair through center */}
            <line x1={-radius} y1={0} x2={radius} y2={0} stroke="#0e3a20" strokeWidth={0.6} />
            <line x1={0} y1={-radius} x2={0} y2={radius} stroke="#0e3a20" strokeWidth={0.6} />

            {/* Clutter */}
            <g>
              {clutter.map((c, i) => (
                <circle
                  key={i}
                  cx={c.x}
                  cy={c.y}
                  r={0.8}
                  fill="#5cff9a"
                  opacity={c.o * (0.4 + Math.random() * 0.6)}
                />
              ))}
            </g>

            {/* Rain clutter (dense noise within rain cells) */}
            <g clipPath="url(#scopeClip)">
              {rainDots.map((c, i) => (
                <circle
                  key={i}
                  cx={c.x}
                  cy={c.y}
                  r={0.9}
                  fill="#9cffc2"
                  opacity={c.o}
                />
              ))}
            </g>

            {/* Sweep beam (wedge) */}
            <g transform={`rotate(${sweep - 90})`}>
              <path
                d={`M0,0 L${radius},0 A${radius},${radius} 0 0 0 ${
                  radius * Math.cos((-25 * Math.PI) / 180)
                },${radius * Math.sin((-25 * Math.PI) / 180)} Z`}
                fill="url(#sweepGrad)"
              />
              <line x1={0} y1={0} x2={radius} y2={0} stroke="#7fffae" strokeOpacity={0.9} strokeWidth={1} />
            </g>

            {/* Contacts */}
            {contacts.map((c) => (
              <ContactSymbol
                key={c.id}
                contact={c}
                radius={radius}
                hovered={hoverId === c.id}
                selected={selectedId === c.id}
              />
            ))}

            {/* Cursor (trackball) */}
            <Cursor x={cursor.x} y={cursor.y} bearing={
              ((Math.atan2(cursor.y, cursor.x) * 180) / Math.PI + 90 + 360) % 360
            } range={Math.min(MAX_RANGE_NM, (Math.hypot(cursor.x, cursor.y) / radius) * MAX_RANGE_NM)} />

            {/* North marker */}
            <text x={0} y={-radius - 8} fill="#7fffae" fontSize={11} textAnchor="middle">
              N
            </text>
          </svg>

          {/* Tactical overlay */}
          {selected && (
            <TacticalOverlay
              contact={selected}
              size={size}
              onAction={(action) => {
                if (action === "TRACK") {
                  updateContact(selected.id, { classification: "TRACKED" });
                  appendLog(`TRACK ${selected.id} CONFIRMED`);
                } else if (action === "EO") {
                  appendLog(`EO VERIFY INITIATED  ${selected.id}`);
                  setTimeout(() => {
                    updateContact(selected.id, { classification: "EO" });
                    appendLog(`EO VERIFY OK  ${selected.id}`);
                  }, 1800);
                } else if (action === "SUSPECT") {
                  updateContact(selected.id, { classification: "SUSPECT" });
                  appendLog(`${selected.id} MARKED SUSPECT`);
                  if (!evaluatedRef.current.has(selected.id)) {
                    evaluatedRef.current.add(selected.id);
                    if (selected.suspicious) {
                      setCorrectMarks((n) => n + 1);
                      appendLog(`> EVAL ${selected.id}  CORRECT  +1`);
                    } else {
                      setIncorrectMarks((n) => n + 1);
                      appendLog(`> EVAL ${selected.id}  INCORRECT  FRIENDLY`);
                    }
                  }
                } else if (action === "DROP") {
                  appendLog(`${selected.id} TRACK DROPPED`);
                  setContacts((cs) => cs.filter((x) => x.id !== selected.id));
                  setSelectedId(null);
                }
              }}
              onClose={() => setSelectedId(null)}
            />
          )}

          {/* Bottom HUD strip */}
          <BottomHud cursor={cursor} radius={radius} />
        </div>

        {/* Right log column */}
        <LogPane log={log} />
      </div>
    </div>
  );
}

// ===== Subcomponents =====

function TopBar({
  sweep,
  contacts,
  onNewScenario,
}: {
  sweep: number;
  contacts: Contact[];
  onNewScenario: () => void;
}) {
  const [t, setT] = useState(zulu());
  useEffect(() => {
    const id = setInterval(() => setT(zulu()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="flex items-center gap-6 h-11 px-4 text-[11px] tracking-widest border-b"
      style={{ borderColor: "#0a2814", backgroundColor: "#03110a", color: "#5fcf8a" }}
    >
      <span style={{ color: "#7fffae" }}>ALH-RECCE  //  SURFACE PICTURE</span>
      <Stat k="MODE" v="SURF SRCH" />
      <Stat k="X-BAND" v="9.41GHz" />
      <Stat k="PRF" v="2.0kHz" />
      <Stat k="RNG" v="20NM" />
      <Stat k="SWP" v={`${pad(sweep)}°`} />
      <Stat k="CONT" v={String(contacts.length).padStart(2, "0")} />
      <Stat k="IF" v="MED" />
      <button
        onClick={onNewScenario}
        className="ml-auto px-2 py-0.5 hover:bg-[#04200f] transition-colors"
        style={{ color: "#7fffae", border: "1px solid #1f6b3a", letterSpacing: "0.15em" }}
      >
        [ NEW SCENARIO ]
      </button>
      <span style={{ color: "#7fffae" }}>UTC {t}</span>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span style={{ color: "#2f7a4e" }}>{k} </span>
      <span>{v}</span>
    </span>
  );
}

function SideRail({
  contacts,
  selectedId,
  suspiciousCount,
  correctMarks,
  incorrectMarks,
  onNewScenario,
}: {
  contacts: Contact[];
  selectedId: string | null;
  suspiciousCount: number;
  correctMarks: number;
  incorrectMarks: number;
  onNewScenario: () => void;
}) {
  const aisCount = contacts.filter((c) => c.ais).length;
  const darkCount = contacts.length - aisCount;
  const markedSuspect = contacts.filter((c) => c.classification === "SUSPECT").length;
  return (
    <div
      className="w-44 border-r p-3 text-[10px] flex flex-col gap-3"
      style={{ borderColor: "#0a2814", backgroundColor: "#02100a", color: "#5fcf8a" }}
    >
      <Section title="OWN SHIP">
        <Row k="LAT" v="12°54.3'N" />
        <Row k="LON" v="074°06.8'E" />
        <Row k="HDG" v="284°" />
        <Row k="SPD" v="120KT" />
        <Row k="ALT" v="1200FT" />
      </Section>
      <Section title="SENSORS">
        <Row k="RDR" v="ON" ok />
        <Row k="AIS" v="RX" ok />
        <Row k="EO/IR" v="STBY" />
        <Row k="ESM" v="PASS" ok />
        <Row k="IFF" v="MK XII" />
      </Section>
      <Section title="PICTURE">
        <Row k="CONT" v={String(contacts.length).padStart(2, "0")} />
        <Row k="AIS" v={String(aisCount).padStart(2, "0")} />
        <Row k="DARK" v={String(darkCount).padStart(2, "0")} />
      </Section>
      <Section title="THREAT">
        <div className="flex justify-between">
          <span style={{ color: "#2f7a4e" }}>SUS</span>
          <span style={{ color: suspiciousCount > 0 ? "#ffb347" : "#5fcf8a" }}>
            {String(suspiciousCount).padStart(2, "0")}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "#2f7a4e" }}>MRK</span>
          <span style={{ color: markedSuspect > 0 ? "#ffb347" : "#5fcf8a" }}>
            {String(markedSuspect).padStart(2, "0")}
          </span>
        </div>
      </Section>
      <Section title="SCORE">
        <div className="flex justify-between">
          <span style={{ color: "#2f7a4e" }}>OK</span>
          <span style={{ color: "#7fffae" }}>{String(correctMarks).padStart(2, "0")}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "#2f7a4e" }}>ERR</span>
          <span style={{ color: incorrectMarks > 0 ? "#ff7a6b" : "#5fcf8a" }}>
            {String(incorrectMarks).padStart(2, "0")}
          </span>
        </div>
      </Section>
      <Section title="DESIG">
        <div style={{ color: selectedId ? "#7fffae" : "#2f7a4e" }}>
          {selectedId ? `TRK ${selectedId}` : "----"}
        </div>
      </Section>
      <Section title="LEGEND">
        <LegendRow color="#7fffae" label="UNK BLIP" />
        <LegendRow color="#7fffae" label="TRACKED ◇" />
        <LegendRow color="#7fffae" label="AIS CIV ☐" />
        <LegendRow color="#ffb347" label="SUSPECT △" />
        <LegendRow color="#7fffae" label="EO ◇•" />
      </Section>
      <button
        onClick={onNewScenario}
        className="px-2 py-1 hover:bg-[#04200f] transition-colors tracking-widest"
        style={{ color: "#7fffae", border: "1px solid #1f6b3a" }}
      >
        [ NEW SCENARIO ]
      </button>
      <div className="mt-auto opacity-60" style={{ color: "#2f7a4e" }}>
        TRACKBALL: MOUSE / ARROWS
        <br />SELECT: CLICK / ENTER
        <br />DESEL: ESC
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 tracking-widest" style={{ color: "#2f7a4e" }}>{title}</div>
      <div className="flex flex-col gap-0.5 pl-1">{children}</div>
    </div>
  );
}
function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "#2f7a4e" }}>{k}</span>
      <span style={{ color: ok ? "#7fffae" : "#5fcf8a" }}>{v}</span>
    </div>
  );
}
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color }}>{label}</span>
    </div>
  );
}

function ContactSymbol({
  contact,
  radius,
  hovered,
  selected,
}: {
  contact: Contact;
  radius: number;
  hovered: boolean;
  selected: boolean;
}) {
  const { x, y } = polarToXY(contact.bearing, contact.range, radius);
  const now = performance.now();
  const since = now - contact.lastPaint;
  // fade out between paints
  const fade = Math.max(0.18, 1 - since / 4000);
  if (!contact.visible && contact.classification === "UNKNOWN") return null;

  // heading vector length scaled with speed
  const vecLen = Math.min(42, 6 + contact.speed * 0.8);
  const hx = Math.cos(((contact.heading - 90) * Math.PI) / 180) * vecLen;
  const hy = Math.sin(((contact.heading - 90) * Math.PI) / 180) * vecLen;

  const color =
    contact.classification === "SUSPECT"
      ? "#ffb347"
      : contact.classification === "AIS"
        ? "#9cdcff"
        : "#7fffae";

  const sym = (() => {
    switch (contact.classification) {
      case "UNKNOWN":
        return <circle r={2.2} fill={color} opacity={fade} />;
      case "TRACKED":
        return (
          <polygon
            points="0,-6 6,0 0,6 -6,0"
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            opacity={fade}
          />
        );
      case "AIS":
        return (
          <rect
            x={-5}
            y={-5}
            width={10}
            height={10}
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            opacity={fade}
          />
        );
      case "SUSPECT":
        return (
          <polygon
            points="0,-7 6,5 -6,5"
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            opacity={fade}
          />
        );
      case "EO":
        return (
          <g opacity={fade}>
            <polygon
              points="0,-6 6,0 0,6 -6,0"
              fill="none"
              stroke={color}
              strokeWidth={1.2}
            />
            <circle r={1.4} fill={color} />
            <text x={9} y={-6} fontSize={8} fill={color}>EO</text>
          </g>
        );
    }
  })();

  return (
    <g transform={`translate(${x},${y})`}>
      {/* Trail */}
      {contact.trail.map((p, i) => (
        <circle
          key={i}
          cx={p.x - x}
          cy={p.y - y}
          r={0.9}
          fill={color}
          opacity={Math.max(0, 0.5 - i * 0.04)}
        />
      ))}
      {/* Heading vector */}
      {contact.classification !== "UNKNOWN" && (
        <line x1={0} y1={0} x2={hx} y2={hy} stroke={color} strokeOpacity={fade * 0.8} strokeWidth={1} />
      )}
      {sym}
      {/* Designation brackets */}
      {(selected || contact.designated) && (
        <g stroke={color} strokeWidth={1} fill="none" opacity={0.85}>
          <path d="M-11,-11 L-11,-7 M-11,-11 L-7,-11" />
          <path d="M11,-11 L11,-7 M11,-11 L7,-11" />
          <path d="M-11,11 L-11,7 M-11,11 L-7,11" />
          <path d="M11,11 L11,7 M11,11 L7,11" />
        </g>
      )}
      {/* Hover halo */}
      {hovered && !selected && (
        <circle r={12} fill="none" stroke={color} strokeOpacity={0.5} strokeDasharray="2 2" />
      )}
      {/* Tag */}
      {(selected || hovered || contact.classification !== "UNKNOWN") && (
        <text x={10} y={-8} fontSize={9} fill={color} opacity={fade}>
          {contact.id}
        </text>
      )}
    </g>
  );
}

function Cursor({ x, y, bearing, range }: { x: number; y: number; bearing: number; range: number }) {
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <circle r={14} fill="none" stroke="#7fffae" strokeOpacity={0.7} strokeWidth={0.8} />
      <line x1={-22} y1={0} x2={-6} y2={0} stroke="#7fffae" strokeOpacity={0.8} strokeWidth={0.8} />
      <line x1={6} y1={0} x2={22} y2={0} stroke="#7fffae" strokeOpacity={0.8} strokeWidth={0.8} />
      <line x1={0} y1={-22} x2={0} y2={-6} stroke="#7fffae" strokeOpacity={0.8} strokeWidth={0.8} />
      <line x1={0} y1={6} x2={0} y2={22} stroke="#7fffae" strokeOpacity={0.8} strokeWidth={0.8} />
      <text x={18} y={-16} fontSize={9} fill="#7fffae" opacity={0.85}>
        {`B${pad(bearing)}  R${range.toFixed(1)}NM`}
      </text>
    </g>
  );
}

function TacticalOverlay({
  contact,
  size,
  onAction,
  onClose,
}: {
  contact: Contact;
  size: number;
  onAction: (a: "TRACK" | "EO" | "SUSPECT" | "DROP") => void;
  onClose: () => void;
}) {
  const radius = size / 2 - 30;
  const { x, y } = polarToXY(contact.bearing, contact.range, radius);
  // anchor near contact, clamp inside scope
  const half = size / 2;
  let left = half + x + 22;
  let top = half + y - 10;
  if (left + 220 > size) left = half + x - 240;
  if (top + 200 > size) top = size - 210;
  if (top < 8) top = 8;
  const ais = contact.ais ? "POS" : "NEG";
  return (
    <div
      className="absolute text-[10px] tracking-wider select-none"
      style={{
        left,
        top,
        width: 210,
        backgroundColor: "rgba(2,16,8,0.92)",
        border: "1px solid #1f6b3a",
        boxShadow: "0 0 0 1px #04200f inset, 0 0 24px rgba(127,255,174,0.08)",
        color: "#7fffae",
      }}
    >
      {/* Connector line drawn via pseudo border */}
      <div className="flex items-center justify-between px-2 py-1" style={{ borderBottom: "1px solid #0e3a20", backgroundColor: "#04200f" }}>
        <span>TRACK {contact.id}</span>
        <button
          onClick={onClose}
          style={{ color: "#2f7a4e" }}
          className="hover:text-[#7fffae]"
        >
          ×
        </button>
      </div>
      <div className="px-2 py-2 grid grid-cols-2 gap-y-0.5 gap-x-3">
        <DataLine k="BRG" v={`${pad(contact.bearing)}`} />
        <DataLine k="RNG" v={`${contact.range.toFixed(1)}NM`} />
        <DataLine k="SPD" v={`${Math.round(contact.speed)}KT`} />
        <DataLine k="HDG" v={`${pad(contact.heading)}`} />
        <DataLine k="AIS" v={ais} warn={!contact.ais} />
        <DataLine k="CLS" v={contact.classification} />
        <DataLine
          k="TYP"
          v={contact.vesselType ?? "---"}
          warn={!contact.vesselType}
        />
      </div>
      <div className="px-2 pb-2 flex flex-col gap-1">
        <OpBtn onClick={() => onAction("TRACK")}>[ TRACK ]</OpBtn>
        <OpBtn onClick={() => onAction("EO")}>[ EO VERIFY ]</OpBtn>
        <OpBtn onClick={() => onAction("SUSPECT")} warn>[ MARK SUSPECT ]</OpBtn>
        <OpBtn onClick={() => onAction("DROP")} danger>[ DROP TRACK ]</OpBtn>
      </div>
    </div>
  );
}

function DataLine({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "#2f7a4e" }}>{k}</span>
      <span style={{ color: warn ? "#ffb347" : "#7fffae" }}>{v}</span>
    </div>
  );
}

function OpBtn({
  children,
  onClick,
  warn,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  warn?: boolean;
  danger?: boolean;
}) {
  const color = danger ? "#ff7a6b" : warn ? "#ffb347" : "#7fffae";
  return (
    <button
      onClick={onClick}
      className="text-left px-1 py-0.5 hover:bg-[#04200f] transition-colors"
      style={{ color, border: "1px solid #0e3a20" }}
    >
      {children}
    </button>
  );
}

function BottomHud({ cursor, radius }: { cursor: { x: number; y: number }; radius: number }) {
  const b = ((Math.atan2(cursor.y, cursor.x) * 180) / Math.PI + 90 + 360) % 360;
  const r = Math.min(MAX_RANGE_NM, (Math.hypot(cursor.x, cursor.y) / radius) * MAX_RANGE_NM);
  return (
    <div
      className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] tracking-wider px-2 py-1"
      style={{ color: "#5fcf8a", borderTop: "1px solid #0e3a20", backgroundColor: "rgba(2,16,8,0.5)" }}
    >
      <span><span style={{ color: "#2f7a4e" }}>TRKBALL </span>B{pad(b)}  R{r.toFixed(1)}NM</span>
      <span style={{ color: "#2f7a4e" }}>SECTOR SCAN  000–360  //  GAIN 62%  //  STC 40%  //  FTC ON</span>
      <span><span style={{ color: "#2f7a4e" }}>CTRL </span>MOUSE • ARROWS • ENTER • ESC</span>
    </div>
  );
}

function LogPane({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <div
      className="w-64 border-l p-3 text-[10px] flex flex-col"
      style={{ borderColor: "#0a2814", backgroundColor: "#02100a", color: "#5fcf8a" }}
    >
      <div className="mb-2 tracking-widest" style={{ color: "#2f7a4e" }}>OPS LOG</div>
      <div ref={ref} className="flex-1 overflow-auto leading-relaxed pr-1">
        {log.map((e, i) => (
          <div key={i}>
            <span style={{ color: "#2f7a4e" }}>{e.t} </span>
            <span>{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RadarConsole;