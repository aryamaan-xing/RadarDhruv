import { jsxs, jsx } from "react/jsx-runtime";
import { useMemo, useEffect, useRef, useState, useCallback } from "react";
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function normalizeDeg(value) {
  return (value % 360 + 360) % 360;
}
function shortAngleDiff(a, b) {
  return (normalizeDeg(a) - normalizeDeg(b) + 540) % 360 - 180;
}
function bearingRangeFromPoint(p) {
  const rangeNm = Math.hypot(p.x, p.y);
  const bearingDeg = normalizeDeg(Math.atan2(p.x, p.y) * 180 / Math.PI);
  return { bearingDeg, rangeNm };
}
function pointFromBearingRange(bearingDeg, rangeNm) {
  const a = bearingDeg * Math.PI / 180;
  return {
    x: Math.sin(a) * rangeNm,
    y: Math.cos(a) * rangeNm
  };
}
function movePoint(position, headingDeg, distanceNm) {
  const delta = pointFromBearingRange(headingDeg, distanceNm);
  return {
    x: position.x + delta.x,
    y: position.y + delta.y
  };
}
function nmToScreen(point, rangeNm, radiusPx) {
  const s = radiusPx / rangeNm;
  return { x: point.x * s, y: -point.y * s };
}
function screenToBearingRange(x, y, rangeNm, radiusPx) {
  const nx = x / radiusPx * rangeNm;
  const ny = -y / radiusPx * rangeNm;
  return bearingRangeFromPoint({ x: nx, y: ny });
}
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function padBearing(value) {
  return String(Math.round(normalizeDeg(value))).padStart(3, "0");
}
function isInsideSector(bearingDeg, centerDeg, widthDeg) {
  return Math.abs(shortAngleDiff(bearingDeg, centerDeg)) <= widthDeg / 2;
}
const ACQUISITION_GATE_PX = 30;
function RadarScope({
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
  onSelect
}) {
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
    radius
  );
  const clutter = useMemo(
    () => makeClutter(scenario.seed, radius, settings, scenario),
    [scenario, radius, settings]
  );
  const nearestId = useMemo(
    () => findNearest(cursor, visibleContacts, settings.rangeNm, radius),
    [cursor, visibleContacts, settings.rangeNm, radius]
  );
  useEffect(() => {
    onHover(nearestId);
  }, [nearestId, onHover]);
  const handleMove = (event) => {
    onCursor(mouseToScopePoint(event, size));
  };
  const handleClick = (event) => {
    const clickCursor = mouseToScopePoint(event, size);
    const clickedId = findNearest(
      clickCursor,
      visibleContacts,
      settings.rangeNm,
      radius
    );
    onCursor(clickCursor);
    onSelect(clickedId);
  };
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`,
      onMouseMove: handleMove,
      onClick: handleClick,
      style: { cursor: "none" },
      role: "img",
      "aria-label": "ALH procedural maritime radar scope",
      children: [
        /* @__PURE__ */ jsxs("defs", { children: [
          /* @__PURE__ */ jsx("clipPath", { id: "scopeClip", children: /* @__PURE__ */ jsx("circle", { r: radius }) }),
          /* @__PURE__ */ jsxs("radialGradient", { id: "sweepGrad", cx: "0", cy: "0", r: "1", children: [
            /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "#7fffae", stopOpacity: "0.28" }),
            /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "#7fffae", stopOpacity: "0" })
          ] })
        ] }),
        /* @__PURE__ */ jsx("circle", { r: radius + 13, fill: "none", stroke: "#0c2a18", strokeWidth: 2 }),
        /* @__PURE__ */ jsx("circle", { r: radius, fill: "#021008", stroke: "#1d6a3c", strokeWidth: 1.2 }),
        /* @__PURE__ */ jsxs("g", { clipPath: "url(#scopeClip)", children: [
          /* @__PURE__ */ jsx(
            Coastline,
            {
              points: scenario.coastline,
              rangeNm: settings.rangeNm,
              radius
            }
          ),
          /* @__PURE__ */ jsx(
            ProtectedZones,
            {
              scenario,
              rangeNm: settings.rangeNm,
              radius
            }
          ),
          /* @__PURE__ */ jsx(
            ShippingLanes,
            {
              scenario,
              rangeNm: settings.rangeNm,
              radius
            }
          ),
          /* @__PURE__ */ jsx(
            Weather,
            {
              scenario,
              rangeNm: settings.rangeNm,
              radius
            }
          ),
          clutter.map((dot, i) => /* @__PURE__ */ jsx(
            "circle",
            {
              cx: dot.x,
              cy: dot.y,
              r: dot.r,
              fill: "#6effa2",
              opacity: dot.opacity
            },
            i
          ))
        ] }),
        rings.map((nm) => {
          const r = nm / settings.rangeNm * radius;
          return /* @__PURE__ */ jsxs("g", { children: [
            /* @__PURE__ */ jsx(
              "circle",
              {
                r,
                fill: "none",
                stroke: "#0e6b3a",
                strokeOpacity: 0.5,
                strokeDasharray: "2 5",
                strokeWidth: 0.75
              }
            ),
            /* @__PURE__ */ jsxs("text", { x: 5, y: -r - 3, fill: "#3aa468", fontSize: 9, children: [
              nm,
              "NM"
            ] })
          ] }, nm);
        }),
        Array.from({ length: 36 }).map((_, i) => {
          const deg = i * 10;
          const p1 = pointFromBearingRange(
            deg,
            settings.rangeNm * (i % 3 === 0 ? 0.94 : 0.975)
          );
          const p2 = pointFromBearingRange(deg, settings.rangeNm);
          const a = nmToScreen(p1, settings.rangeNm, radius);
          const b = nmToScreen(p2, settings.rangeNm, radius);
          return /* @__PURE__ */ jsx(
            "line",
            {
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
              stroke: "#1d6a3c",
              strokeOpacity: i % 3 === 0 ? 0.9 : 0.45
            },
            deg
          );
        }),
        Array.from({ length: 12 }).map((_, i) => {
          const deg = i * 30;
          const p = nmToScreen(
            pointFromBearingRange(deg, settings.rangeNm * 0.9),
            settings.rangeNm,
            radius
          );
          return /* @__PURE__ */ jsx(
            "text",
            {
              x: p.x,
              y: p.y + 3,
              fill: "#3aa468",
              fontSize: 9,
              textAnchor: "middle",
              children: padBearing(deg)
            },
            deg
          );
        }),
        /* @__PURE__ */ jsx(
          "line",
          {
            x1: -radius,
            y1: 0,
            x2: radius,
            y2: 0,
            stroke: "#0e3a20",
            strokeWidth: 0.6
          }
        ),
        /* @__PURE__ */ jsx(
          "line",
          {
            x1: 0,
            y1: -radius,
            x2: 0,
            y2: radius,
            stroke: "#0e3a20",
            strokeWidth: 0.6
          }
        ),
        /* @__PURE__ */ jsx(SectorOverlay, { settings, radius }),
        /* @__PURE__ */ jsxs("g", { transform: `rotate(${sweepDeg - 90})`, children: [
          /* @__PURE__ */ jsx(
            "path",
            {
              d: `M0,0 L${radius},0 A${radius},${radius} 0 0 0 ${radius * Math.cos(-24 * Math.PI / 180)},${radius * Math.sin(-24 * Math.PI / 180)} Z`,
              fill: "url(#sweepGrad)"
            }
          ),
          /* @__PURE__ */ jsx(
            "path",
            {
              d: `M0,0 L${radius},0 A${radius},${radius} 0 0 1 ${radius * Math.cos(7 * Math.PI / 180)},${radius * Math.sin(7 * Math.PI / 180)} Z`,
              fill: "#7fffae",
              opacity: 0.08
            }
          ),
          /* @__PURE__ */ jsx(
            "line",
            {
              x1: 0,
              y1: 0,
              x2: radius,
              y2: 0,
              stroke: "#7fffae",
              strokeOpacity: 0.85
            }
          )
        ] }),
        visibleContacts.map((contact) => /* @__PURE__ */ jsx(
          ContactSymbol,
          {
            contact,
            track: tracks.get(contact.id),
            rangeNm: settings.rangeNm,
            radius,
            selected: selectedId === contact.id,
            hovered: hoverId === contact.id
          },
          contact.id
        )),
        /* @__PURE__ */ jsx(
          Cursor,
          {
            x: cursor.x,
            y: cursor.y,
            bearing: cursorBR.bearingDeg,
            range: cursorBR.rangeNm
          }
        ),
        /* @__PURE__ */ jsx(
          "text",
          {
            x: 0,
            y: -radius - 10,
            fill: "#7fffae",
            fontSize: 11,
            textAnchor: "middle",
            children: "N"
          }
        )
      ]
    }
  );
}
function ContactSymbol({
  contact,
  track,
  rangeNm,
  radius,
  selected,
  hovered
}) {
  const p = nmToScreen(contact.position, rangeNm, radius);
  const color = contact.classification === "ANOMALOUS" ? "#ffb347" : contact.classification === "AIS" ? "#9cdcff" : "#7fffae";
  const rawFade = track?.trackFile ? 1 : Math.max(0.18, 1 - (track?.ageSeconds ?? 14) / 14);
  const opacity = Math.max(0.14, (track?.strength ?? 0.4) * rawFade);
  const heading = nmToScreen(
    pointFromBearingRange(
      contact.headingDeg,
      Math.min(8, 1 + contact.speedKts / 6)
    ),
    rangeNm,
    radius
  );
  return /* @__PURE__ */ jsxs("g", { transform: `translate(${p.x},${p.y})`, opacity, children: [
    contact.trail.slice(1, 12).map((trail, i) => {
      const t = nmToScreen(trail, rangeNm, radius);
      return /* @__PURE__ */ jsx(
        "circle",
        {
          cx: t.x - p.x,
          cy: t.y - p.y,
          r: 1,
          fill: color,
          opacity: 0.42 - i * 0.03
        },
        i
      );
    }),
    track?.painted && /* @__PURE__ */ jsx("circle", { r: 8, fill: "none", stroke: "#7fffae", strokeOpacity: 0.3 }),
    track?.trackFile && /* @__PURE__ */ jsx(
      "line",
      {
        x1: 0,
        y1: 0,
        x2: heading.x,
        y2: heading.y,
        stroke: color,
        strokeOpacity: 0.85,
        strokeWidth: 1
      }
    ),
    symbolFor(contact.classification, color),
    (selected || contact.designated) && /* @__PURE__ */ jsx(Brackets, { color }),
    hovered && !selected && /* @__PURE__ */ jsx(
      "circle",
      {
        r: 13,
        fill: "none",
        stroke: color,
        strokeDasharray: "2 2",
        opacity: 0.65
      }
    ),
    (hovered || selected || track?.trackFile) && /* @__PURE__ */ jsx("text", { x: 10, y: -8, fontSize: 9, fill: color, children: contact.id }),
    track?.trackFile && track.ageSeconds > 18 && /* @__PURE__ */ jsx("text", { x: 10, y: 4, fontSize: 8, fill: "#ffb347", children: "COAST" }),
    track?.cluttered && /* @__PURE__ */ jsx("text", { x: 10, y: 4, fontSize: 8, fill: "#ffb347", children: "CLTR" }),
    track?.merged && /* @__PURE__ */ jsx("text", { x: 10, y: 15, fontSize: 8, fill: "#ffb347", children: "MERGE" })
  ] });
}
function symbolFor(classification, color) {
  if (classification === "AIS")
    return /* @__PURE__ */ jsx(
      "rect",
      {
        x: -5,
        y: -5,
        width: 10,
        height: 10,
        fill: "none",
        stroke: color,
        strokeWidth: 1.2
      }
    );
  if (classification === "ANOMALOUS")
    return /* @__PURE__ */ jsx(
      "polygon",
      {
        points: "0,-7 6,5 -6,5",
        fill: "none",
        stroke: color,
        strokeWidth: 1.2
      }
    );
  if (classification === "EO_ID") {
    return /* @__PURE__ */ jsxs("g", { children: [
      /* @__PURE__ */ jsx(
        "polygon",
        {
          points: "0,-6 6,0 0,6 -6,0",
          fill: "none",
          stroke: color,
          strokeWidth: 1.2
        }
      ),
      /* @__PURE__ */ jsx("circle", { r: 1.5, fill: color })
    ] });
  }
  if (classification === "TRACKED")
    return /* @__PURE__ */ jsx(
      "polygon",
      {
        points: "0,-6 6,0 0,6 -6,0",
        fill: "none",
        stroke: color,
        strokeWidth: 1.2
      }
    );
  return /* @__PURE__ */ jsx("circle", { r: 2.4, fill: color });
}
function Brackets({ color }) {
  return /* @__PURE__ */ jsxs("g", { stroke: color, strokeWidth: 1, fill: "none", children: [
    /* @__PURE__ */ jsx("path", { d: "M-11,-11 L-11,-7 M-11,-11 L-7,-11" }),
    /* @__PURE__ */ jsx("path", { d: "M11,-11 L11,-7 M11,-11 L7,-11" }),
    /* @__PURE__ */ jsx("path", { d: "M-11,11 L-11,7 M-11,11 L-7,11" }),
    /* @__PURE__ */ jsx("path", { d: "M11,11 L11,7 M11,11 L7,11" })
  ] });
}
function Cursor({
  x,
  y,
  bearing,
  range
}) {
  return /* @__PURE__ */ jsxs("g", { transform: `translate(${x},${y})`, pointerEvents: "none", children: [
    /* @__PURE__ */ jsx("circle", { r: 14, fill: "none", stroke: "#7fffae", strokeOpacity: 0.72 }),
    /* @__PURE__ */ jsx("line", { x1: -22, y1: 0, x2: -6, y2: 0, stroke: "#7fffae" }),
    /* @__PURE__ */ jsx("line", { x1: 6, y1: 0, x2: 22, y2: 0, stroke: "#7fffae" }),
    /* @__PURE__ */ jsx("line", { x1: 0, y1: -22, x2: 0, y2: -6, stroke: "#7fffae" }),
    /* @__PURE__ */ jsx("line", { x1: 0, y1: 6, x2: 0, y2: 22, stroke: "#7fffae" }),
    /* @__PURE__ */ jsxs("text", { x: 18, y: -16, fontSize: 9, fill: "#7fffae", children: [
      "B",
      padBearing(bearing),
      " R",
      range.toFixed(1),
      "NM"
    ] })
  ] });
}
function Coastline({
  points,
  rangeNm,
  radius
}) {
  const path = points.map((point, i) => {
    const p = nmToScreen(point, rangeNm, radius);
    return `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join(" ");
  return /* @__PURE__ */ jsx(
    "path",
    {
      d: `${path} Z`,
      fill: "#0a2a16",
      fillOpacity: 0.58,
      stroke: "#1f6b3a",
      strokeWidth: 0.8
    }
  );
}
function ShippingLanes({
  scenario,
  rangeNm,
  radius
}) {
  return /* @__PURE__ */ jsx("g", { children: scenario.lanes.map((lane, i) => {
    const a = nmToScreen(lane.a, rangeNm, radius);
    const b = nmToScreen(lane.b, rangeNm, radius);
    return /* @__PURE__ */ jsx(
      "line",
      {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: "#1d6a3c",
        strokeDasharray: "5 6",
        opacity: 0.55
      },
      i
    );
  }) });
}
function ProtectedZones({
  scenario,
  rangeNm,
  radius
}) {
  return /* @__PURE__ */ jsx("g", { children: scenario.protectedZones.map((zone) => {
    const p = nmToScreen(zone.center, rangeNm, radius);
    return /* @__PURE__ */ jsx(
      "circle",
      {
        cx: p.x,
        cy: p.y,
        r: zone.radiusNm / rangeNm * radius,
        fill: "none",
        stroke: "#ffb347",
        strokeDasharray: "4 4",
        opacity: 0.35
      },
      zone.label
    );
  }) });
}
function Weather({
  scenario,
  rangeNm,
  radius
}) {
  return /* @__PURE__ */ jsx("g", { children: scenario.rainCells.map((cell, i) => {
    const p = nmToScreen(cell.center, rangeNm, radius);
    return /* @__PURE__ */ jsx(
      "circle",
      {
        cx: p.x,
        cy: p.y,
        r: cell.radiusNm / rangeNm * radius,
        fill: "#78ffae",
        fillOpacity: 0.06 * cell.intensity,
        stroke: "#7fffae",
        strokeDasharray: "1 4",
        opacity: 0.4
      },
      i
    );
  }) });
}
function SectorOverlay({
  settings,
  radius
}) {
  if (settings.sectorWidthDeg >= 359) return null;
  const start = settings.sectorCenterDeg - settings.sectorWidthDeg / 2;
  const end = settings.sectorCenterDeg + settings.sectorWidthDeg / 2;
  const a = pointFromBearingRange(start, 1);
  const b = pointFromBearingRange(end, 1);
  return /* @__PURE__ */ jsxs("g", { opacity: 0.45, children: [
    /* @__PURE__ */ jsx(
      "line",
      {
        x1: 0,
        y1: 0,
        x2: a.x * radius,
        y2: -a.y * radius,
        stroke: "#ffb347",
        strokeDasharray: "3 5"
      }
    ),
    /* @__PURE__ */ jsx(
      "line",
      {
        x1: 0,
        y1: 0,
        x2: b.x * radius,
        y2: -b.y * radius,
        stroke: "#ffb347",
        strokeDasharray: "3 5"
      }
    )
  ] });
}
function ringScale(rangeNm) {
  if (rangeNm <= 10) return [2, 5, 10].filter((r) => r <= rangeNm);
  if (rangeNm <= 20) return [5, 10, 15, 20].filter((r) => r <= rangeNm);
  if (rangeNm <= 40) return [10, 20, 30, 40].filter((r) => r <= rangeNm);
  return [20, 40, 80, 120].filter((r) => r <= rangeNm);
}
function findNearest(cursor, contacts, rangeNm, radius) {
  let best = null;
  for (const contact of contacts) {
    const p = nmToScreen(contact.position, rangeNm, radius);
    const d = Math.hypot(cursor.x - p.x, cursor.y - p.y);
    if (d < ACQUISITION_GATE_PX && (!best || d < best.d))
      best = { id: contact.id, d };
  }
  return best?.id ?? null;
}
function mouseToScopePoint(event, size) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left - size / 2,
    y: event.clientY - rect.top - size / 2
  };
}
function makeClutter(seed, radius, settings, scenario) {
  const count = 80 + Math.round(settings.gain * 0.7) + scenario.rainCells.length * 70;
  let value = seed + Math.round(radius) + settings.rangeNm * 11 + settings.seaClutter * 3 + settings.rainClutter;
  const random = () => {
    value = value * 1664525 + 1013904223 >>> 0;
    return value / 4294967296;
  };
  return Array.from({ length: count }).map(() => {
    const angle = random() * Math.PI * 2;
    const rr = Math.sqrt(random()) * radius;
    return {
      x: Math.cos(angle) * rr,
      y: Math.sin(angle) * rr,
      r: 0.55 + random() * 0.85,
      opacity: 0.03 + random() * (settings.mode === "WEATHER" ? 0.2 : 0.12)
    };
  });
}
function assessContacts(contacts, actions) {
  const items = contacts.filter(
    (contact) => !contact.dropped || contact.flaggedAtSeconds !== void 0
  ).map((contact) => assessContact(contact, actions));
  return {
    detected: contacts.filter(
      (contact) => contact.detectedAtSeconds !== void 0
    ).length,
    flaggedCorrectly: items.filter((item) => item.outcome === "CORRECT").length,
    falsePositives: items.filter((item) => item.outcome === "FALSE_POSITIVE").length,
    missedSuspicious: items.filter((item) => item.outcome === "MISSED_THREAT").length,
    unnecessaryDrops: items.filter(
      (item) => item.traineeDecision === "DROPPED" && item.groundTruth === "SUSPICIOUS"
    ).length,
    items
  };
}
function assessContact(contact, actions) {
  const contactActions = actions.filter(
    (action) => action.contactId === contact.id
  );
  const flagged = contactActions.some(
    (action) => action.action === "FLAG_ANOMALOUS"
  );
  const monitored = contactActions.some(
    (action) => action.action === "MONITOR" || action.action === "EO_VERIFY"
  );
  const dropped = contactActions.some((action) => action.action === "DROP");
  const traineeDecision = flagged ? "FLAGGED" : dropped ? "DROPPED" : monitored ? "MONITORED" : "MISSED";
  if (flagged && contact.groundTruth === "SUSPICIOUS") {
    return {
      contactId: contact.id,
      groundTruth: contact.groundTruth,
      traineeDecision,
      outcome: "CORRECT",
      rationale: ["Correctly flagged anomalous behavior.", ...contact.evidence]
    };
  }
  if (flagged && contact.groundTruth === "ROUTINE") {
    return {
      contactId: contact.id,
      groundTruth: contact.groundTruth,
      traineeDecision,
      outcome: "FALSE_POSITIVE",
      rationale: [
        "Routine contact was escalated without enough evidence.",
        ...contact.evidence
      ]
    };
  }
  if (!flagged && contact.groundTruth === "SUSPICIOUS") {
    return {
      contactId: contact.id,
      groundTruth: contact.groundTruth,
      traineeDecision,
      outcome: "MISSED_THREAT",
      rationale: ["Suspicious behavior was not flagged.", ...contact.evidence]
    };
  }
  return {
    contactId: contact.id,
    groundTruth: contact.groundTruth,
    traineeDecision,
    outcome: monitored || contact.detectedAtSeconds !== void 0 ? "INSUFFICIENT" : "INSUFFICIENT",
    rationale: [
      "Routine contact; continued monitoring is acceptable.",
      ...contact.evidence
    ]
  };
}
const CONTACT_COUNT = 34;
const ROUTINE_KINDS = [
  "FISHING",
  "MERCHANT",
  "TANKER",
  "DHOW",
  "TUG"
];
const SUSPICIOUS_BEHAVIORS = [
  "AIS_SILENT_TRANSIT",
  "LOITERING",
  "RENDEZVOUS",
  "PROTECTED_APPROACH",
  "AIS_MISMATCH"
];
const ROUTINE_BEHAVIORS = [
  "ROUTINE_TRANSIT",
  "FISHING_PATTERN",
  "COASTAL_WORK"
];
function createInitialScenario(seed = 20260601) {
  const rnd = seededRandom(seed);
  const area = pick(rnd, [
    {
      title: "Coastal lane surveillance",
      objective: "Build the surface picture across busy traffic lanes, correlate AIS, and flag behavior that does not match the lane pattern.",
      operatingArea: "Western seaboard traffic lane training area"
    },
    {
      title: "Offshore security screen",
      objective: "Monitor contacts approaching a protected coastal zone, prioritize dark targets, and request EO when behavior warrants.",
      operatingArea: "Offshore security screen, public-source procedural model"
    },
    {
      title: "Post-rain clutter search",
      objective: "Tune clutter controls, maintain track continuity through weather returns, and identify anomalous small craft.",
      operatingArea: "Littoral rain-clutter training box"
    }
  ]);
  const weatherRoll = rnd();
  const weather = weatherRoll > 0.78 ? "RAIN" : weatherRoll > 0.56 ? "HAZE" : "CLEAR";
  const seaState = weather === "RAIN" ? 4 : weather === "HAZE" ? 3 : 2;
  const lanes = createShippingLanes(rnd);
  const protectedZones = [
    {
      center: { x: -24 + rnd() * 48, y: 18 + rnd() * 30 },
      radiusNm: 7 + rnd() * 4,
      label: "COASTAL SECURITY ZONE"
    }
  ];
  const contacts = [];
  for (let i = 0; i < CONTACT_COUNT; i++) {
    contacts.push(createContact(i, rnd, lanes));
  }
  return {
    id: `SCN-${seed}`,
    seed,
    title: area.title,
    objective: area.objective,
    operatingArea: area.operatingArea,
    weather,
    seaState,
    ownShip: {
      lat: "12°54.3'N",
      lon: "074°06.8'E",
      headingDeg: 284,
      speedKts: 120,
      altitudeFt: 1200
    },
    contacts,
    coastline: createCoastline(rnd),
    lanes,
    rainCells: weather === "RAIN" ? [
      { center: { x: 15, y: 34 }, radiusNm: 14, intensity: 0.7 },
      { center: { x: -28, y: -12 }, radiusNm: 9, intensity: 0.48 }
    ] : weather === "HAZE" ? [{ center: { x: 26, y: -24 }, radiusNm: 10, intensity: 0.3 }] : [],
    protectedZones
  };
}
function advanceContacts(contacts, dtSeconds, scenarioSeconds) {
  return contacts.map((contact) => {
    if (contact.dropped) return contact;
    const heading = nextHeading(contact, scenarioSeconds);
    const distanceNm = contact.speedKts / 3600 * dtSeconds;
    let position = movePoint(contact.position, heading, distanceNm);
    const br = bearingRangeFromPoint(position);
    if (br.rangeNm > 126) {
      const spawnBearing = normalizeDeg(br.bearingDeg + 180);
      position = pointFromBearingRange(spawnBearing, 118);
    }
    const trail = [{ ...position, ageSeconds: 0 }, ...contact.trail].slice(0, 18).map((p) => ({ ...p, ageSeconds: p.ageSeconds + dtSeconds }));
    return {
      ...contact,
      position,
      headingDeg: heading,
      trail,
      lastAisUpdateSeconds: contact.aisActive && scenarioSeconds - contact.lastAisUpdateSeconds > 35 ? scenarioSeconds : contact.lastAisUpdateSeconds
    };
  });
}
function createScenarioFromClock() {
  return createInitialScenario(
    Math.floor((Date.now() + Math.random() * 1e6) % 1e9)
  );
}
function createContact(index, rnd, lanes) {
  const suspicious = rnd() < 0.24;
  const behavior = pick(
    rnd,
    suspicious ? SUSPICIOUS_BEHAVIORS : ROUTINE_BEHAVIORS
  );
  const kind = chooseKindForBehavior(behavior, rnd);
  const lane = pick(rnd, lanes);
  const along = -0.46 + rnd() * 0.92;
  const lateral = (rnd() - 0.5) * (behavior === "LOITERING" ? 30 : 9);
  const laneDx = lane.b.x - lane.a.x;
  const laneDy = lane.b.y - lane.a.y;
  const base = {
    x: lane.a.x + laneDx * (along + 0.5),
    y: lane.a.y + laneDy * (along + 0.5)
  };
  const len = Math.hypot(laneDx, laneDy) || 1;
  const position = {
    x: clamp(base.x + -laneDy / len * lateral, -105, 105),
    y: clamp(base.y + laneDx / len * lateral, -105, 105)
  };
  const laneHeading = normalizeDeg(
    Math.atan2(laneDx, laneDy) * 180 / Math.PI
  );
  const headingDeg = behavior === "FISHING_PATTERN" || behavior === "LOITERING" ? normalizeDeg(rnd() * 360) : behavior === "PROTECTED_APPROACH" ? normalizeDeg(315 + (rnd() - 0.5) * 28) : normalizeDeg(
    laneHeading + (rnd() > 0.5 ? 0 : 180) + (rnd() - 0.5) * 10
  );
  const aisEquipped = kind !== "FAST_CRAFT" && rnd() < 0.84;
  const aisActive = aisEquipped && behavior !== "AIS_SILENT_TRANSIT" && rnd() > 0.08;
  const aisReportedKind = behavior === "AIS_MISMATCH" ? pick(rnd, ROUTINE_KINDS) : kind;
  const evidence = evidenceFor(behavior, aisActive, kind, aisReportedKind);
  return {
    id: `T${String(index + 1).padStart(2, "0")}`,
    position,
    speedKts: speedFor(kind, behavior, rnd),
    headingDeg,
    kind,
    behavior,
    aisEquipped,
    aisActive,
    aisReportedKind,
    lastAisUpdateSeconds: 0,
    classification: aisActive ? "AIS" : "UNKNOWN",
    designated: false,
    dropped: false,
    trail: [],
    evidence,
    groundTruth: suspicious ? "SUSPICIOUS" : "ROUTINE"
  };
}
function createShippingLanes(rnd) {
  const baseBearing = 42 + rnd() * 70;
  const laneGap = 28 + rnd() * 18;
  return [0, 1].map((laneIndex) => {
    const bearing = normalizeDeg(baseBearing + laneIndex * (78 + rnd() * 22));
    const offset = (laneIndex === 0 ? -laneGap : laneGap) + (rnd() - 0.5) * 18;
    const along = pointFromBearingRange(bearing, 115);
    const cross = pointFromBearingRange(bearing + 90, offset);
    return {
      a: { x: -along.x + cross.x, y: -along.y + cross.y },
      b: { x: along.x + cross.x, y: along.y + cross.y }
    };
  });
}
function createCoastline(rnd) {
  const edge = pick(rnd, ["NORTH", "SOUTH", "WEST"]);
  const points = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const along = -120 + t * 240;
    const scallop = Math.sin(t * Math.PI * 4 + rnd() * 0.8) * (4 + rnd() * 5);
    if (edge === "NORTH") {
      points.push({ x: along, y: 50 + rnd() * 22 + scallop });
    } else if (edge === "SOUTH") {
      points.push({ x: along, y: -58 - rnd() * 18 + scallop });
    } else {
      points.push({ x: -62 - rnd() * 20 + scallop, y: along });
    }
  }
  if (edge === "NORTH")
    return [...points, { x: 120, y: 120 }, { x: -120, y: 120 }];
  if (edge === "SOUTH")
    return [...points, { x: 120, y: -120 }, { x: -120, y: -120 }];
  return [...points, { x: -120, y: 120 }, { x: -120, y: -120 }];
}
function chooseKindForBehavior(behavior, rnd) {
  if (behavior === "PROTECTED_APPROACH")
    return rnd() > 0.45 ? "FAST_CRAFT" : "DHOW";
  if (behavior === "RENDEZVOUS") return rnd() > 0.5 ? "DHOW" : "FISHING";
  if (behavior === "AIS_MISMATCH") return rnd() > 0.5 ? "FAST_CRAFT" : "PATROL";
  if (behavior === "FISHING_PATTERN") return rnd() > 0.2 ? "FISHING" : "DHOW";
  return pick(rnd, ROUTINE_KINDS);
}
function speedFor(kind, behavior, rnd) {
  if (behavior === "LOITERING") return 2 + rnd() * 4;
  if (kind === "FAST_CRAFT") return 24 + rnd() * 18;
  if (kind === "PATROL") return 18 + rnd() * 14;
  if (kind === "FISHING" || kind === "DHOW") return 5 + rnd() * 7;
  if (kind === "TUG") return 6 + rnd() * 6;
  return 11 + rnd() * 10;
}
function nextHeading(contact, scenarioSeconds) {
  if (contact.behavior === "LOITERING" || contact.behavior === "FISHING_PATTERN") {
    return normalizeDeg(
      contact.headingDeg + Math.sin(scenarioSeconds / 38 + contact.id.length) * 0.18
    );
  }
  if (contact.behavior === "RENDEZVOUS") {
    return normalizeDeg(
      contact.headingDeg + Math.sin(scenarioSeconds / 55) * 0.08
    );
  }
  return contact.headingDeg;
}
function evidenceFor(behavior, aisActive, kind, reportedKind) {
  const evidence = [];
  if (!aisActive) evidence.push("No current AIS return");
  if (behavior === "LOITERING")
    evidence.push("Low-speed loitering outside normal lane flow");
  if (behavior === "RENDEZVOUS")
    evidence.push("Course favors close approach to another small contact");
  if (behavior === "PROTECTED_APPROACH")
    evidence.push("Track closes the coastal security zone");
  if (behavior === "AIS_MISMATCH" && reportedKind && reportedKind !== kind) {
    evidence.push(`AIS reports ${reportedKind}, motion resembles ${kind}`);
  }
  if (behavior === "FISHING_PATTERN")
    evidence.push("Irregular but plausible fishing pattern");
  if (behavior === "ROUTINE_TRANSIT")
    evidence.push("Steady course and speed along shipping lane");
  if (behavior === "COASTAL_WORK")
    evidence.push("Slow coastal work pattern near lane boundary");
  return evidence;
}
function pick(rnd, values) {
  return values[Math.floor(rnd() * values.length)];
}
const DEFAULT_RADAR_SETTINGS = {
  rangeNm: 80,
  sectorCenterDeg: 0,
  sectorWidthDeg: 270,
  gain: 62,
  seaClutter: 40,
  rainClutter: 35,
  stc: 42,
  ftc: true,
  mode: "SURFACE_SEARCH"
};
const RAW_PAINT_PERSISTENCE_SECONDS = 14;
const TRACK_FILE_COAST_SECONDS = 42;
function detectContacts(scenario, contacts, settings, sweepDeg, previous, scenarioSeconds) {
  const tracks = /* @__PURE__ */ new Map();
  for (const contact of contacts) {
    if (contact.dropped) continue;
    const br = bearingRangeFromPoint(contact.position);
    const old = previous.get(contact.id);
    const inRange = br.rangeNm <= settings.rangeNm;
    const inSector = isInsideSector(
      br.bearingDeg,
      settings.sectorCenterDeg,
      settings.sectorWidthDeg
    );
    const crossed = Math.abs(shortAngleDiff(sweepDeg, br.bearingDeg)) < 5.5;
    const rainPenalty = rainPenaltyAt(contact.position, scenario, settings);
    const seaPenalty = br.rangeNm < 15 ? settings.seaClutter / 150 : settings.seaClutter / 320;
    const stcPenalty = br.rangeNm < 8 ? settings.stc / 160 : 0;
    const modeBonus = settings.mode === "MTI" && contact.speedKts > 10 ? 0.14 : settings.mode === "WEATHER" ? -0.1 : 0;
    const sizeBonus = contact.kind === "TANKER" || contact.kind === "MERCHANT" ? 0.18 : contact.kind === "FAST_CRAFT" ? -0.12 : 0;
    const rangePenalty = br.rangeNm / 170;
    const strength = clamp(
      0.95 + sizeBonus + modeBonus - rainPenalty - seaPenalty - stcPenalty - rangePenalty,
      0,
      1
    );
    const painted = inRange && inSector && crossed && strength > paintThreshold(settings);
    const trackFile = contact.aisActive || contact.designated || contact.classification === "TRACKED" || contact.classification === "ANOMALOUS" || contact.classification === "EO_ID";
    const lastPaintSeconds = painted ? scenarioSeconds : old?.lastPaintSeconds ?? (trackFile && inRange && inSector ? scenarioSeconds : -999);
    const ageSeconds = scenarioSeconds - lastPaintSeconds;
    const persistence = trackFile ? TRACK_FILE_COAST_SECONDS : RAW_PAINT_PERSISTENCE_SECONDS;
    const faded = ageSeconds > persistence;
    const cluttered = rainPenalty > 0.18 || seaPenalty + stcPenalty > 0.34;
    const merged = hasNearbyTrack(contact, contacts, settings.rangeNm);
    tracks.set(contact.id, {
      contactId: contact.id,
      bearingDeg: br.bearingDeg,
      rangeNm: br.rangeNm,
      strength,
      painted,
      visible: inRange && inSector && !faded && (trackFile ? strength > 0.12 : strength > 0.18),
      trackFile,
      faded,
      cluttered,
      merged,
      lastPaintSeconds,
      ageSeconds
    });
  }
  return tracks;
}
function runEO(contact, scenario, scenarioSeconds) {
  const { rangeNm } = bearingRangeFromPoint(contact.position);
  const weatherPenalty = scenario.weather === "RAIN" ? 0.32 : scenario.weather === "HAZE" ? 0.18 : 0;
  const rangePenalty = clamp((rangeNm - 22) / 42, 0, 0.45);
  const confidence = clamp(0.92 - weatherPenalty - rangePenalty, 0.15, 0.96);
  if (rangeNm > 56 || confidence < 0.22) {
    return {
      status: "NO_LINE_OF_SIGHT",
      confidence,
      summary: `EO unable to classify ${contact.id}; range/weather exceed useful identification conditions.`,
      evidence: [
        "EO line of sight or image quality insufficient",
        `Range ${rangeNm.toFixed(1)} NM`
      ]
    };
  }
  const degraded = confidence < 0.55;
  const evidence = [
    `Visual profile consistent with ${contact.kind}`,
    `Radar course ${Math.round(contact.headingDeg).toString().padStart(3, "0")} at ${Math.round(contact.speedKts)} kt`,
    ...contact.evidence.slice(0, 2)
  ];
  return {
    status: degraded ? "DEGRADED" : "CONFIRMED",
    confidence,
    summary: `${degraded ? "Degraded" : "Positive"} EO observation at T+${Math.round(scenarioSeconds)}s.`,
    evidence
  };
}
function paintThreshold(settings) {
  return clamp(
    0.28 + (50 - settings.gain) / 220 + (settings.ftc ? -0.03 : 0.03),
    0.16,
    0.62
  );
}
function rainPenaltyAt(position, scenario, settings) {
  if (scenario.weather === "CLEAR" && scenario.rainCells.length === 0) return 0;
  let penalty = 0;
  for (const cell of scenario.rainCells) {
    const d = Math.hypot(
      position.x - cell.center.x,
      position.y - cell.center.y
    );
    if (d < cell.radiusNm) {
      penalty += (1 - d / cell.radiusNm) * cell.intensity * (settings.rainClutter / 75);
    }
  }
  return clamp(penalty, 0, 0.62);
}
function hasNearbyTrack(contact, contacts, rangeNm) {
  return contacts.some((other) => {
    if (other.id === contact.id || other.dropped) return false;
    const d = Math.hypot(
      other.position.x - contact.position.x,
      other.position.y - contact.position.y
    );
    return d < Math.max(0.9, rangeNm / 90);
  });
}
const TIME_SCALE = 180;
const DEFAULT_SIZE = 720;
function RadarConsole() {
  const wrapRef = useRef(null);
  const lastFrameRef = useRef(0);
  const scenarioSecondsRef = useRef(0);
  const sweepRef = useRef(0);
  const settingsRef = useRef(DEFAULT_RADAR_SETTINGS);
  const scenarioRef = useRef(null);
  const tracksRef = useRef(/* @__PURE__ */ new Map());
  const [scenario, setScenario] = useState(() => createInitialScenario());
  const [contacts, setContacts] = useState(() => scenario.contacts);
  const [settings, setSettings] = useState(
    DEFAULT_RADAR_SETTINGS
  );
  const [tracks, setTracks] = useState(/* @__PURE__ */ new Map());
  const [sweepDeg, setSweepDeg] = useState(0);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hoverId, setHoverId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [actions, setActions] = useState([]);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [log, setLog] = useState([
    { t: "0000Z", msg: "TRAINER READY  PUBLIC-SOURCE PROCEDURAL MODEL" },
    { t: "0000Z", msg: "SURFACE SEARCH  270 DEG SECTOR  80NM" }
  ]);
  const assessment = useMemo(
    () => assessContacts(contacts, actions),
    [contacts, actions]
  );
  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);
  const appendLog = useCallback((msg) => {
    setLog((current) => [...current.slice(-48), { t: zulu(), msg }]);
  }, []);
  const recordAction = useCallback(
    (contactId, action) => {
      setActions((current) => [
        ...current,
        { t: scenarioSecondsRef.current, contactId, action }
      ]);
    },
    []
  );
  const newScenario = useCallback(() => {
    const next = createScenarioFromClock();
    scenarioSecondsRef.current = 0;
    sweepRef.current = 0;
    lastFrameRef.current = 0;
    setScenario(next);
    scenarioRef.current = next;
    setContacts(next.contacts);
    const initialTracks = detectContacts(
      next,
      next.contacts,
      settingsRef.current,
      0,
      /* @__PURE__ */ new Map(),
      0
    );
    setTracks(initialTracks);
    tracksRef.current = initialTracks;
    setSweepDeg(0);
    setSelectedId(null);
    setHoverId(null);
    setActions([]);
    setDebriefOpen(false);
    appendLog(
      `NEW ${next.id}  ${next.weather}  SEA ${next.seaState}  ${next.contacts.length} CONTACTS`
    );
  }, [appendLog]);
  useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setSize(Math.max(460, Math.min(rect.width, rect.height)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    let raf = 0;
    const tick = (now) => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const dtReal = Math.min(0.08, (now - lastFrameRef.current) / 1e3);
      lastFrameRef.current = now;
      const dtSim = dtReal * TIME_SCALE;
      scenarioSecondsRef.current += dtSim;
      const currentScenario = scenarioRef.current;
      if (!currentScenario) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const nextSweep = (sweepRef.current + dtReal * 72) % 360;
      sweepRef.current = nextSweep;
      setSweepDeg(nextSweep);
      setContacts((current) => {
        const advanced = advanceContacts(
          current,
          dtSim,
          scenarioSecondsRef.current
        );
        const detected = detectContacts(
          currentScenario,
          advanced,
          settingsRef.current,
          nextSweep,
          tracksRef.current,
          scenarioSecondsRef.current
        );
        tracksRef.current = detected;
        setTracks(detected);
        return advanced.map((contact) => {
          const track = detected.get(contact.id);
          if (!track?.painted || contact.detectedAtSeconds !== void 0)
            return contact;
          return { ...contact, detectedAtSeconds: scenarioSecondsRef.current };
        });
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const selectContact = useCallback(
    (contactId) => {
      if (!contactId) {
        setSelectedId(null);
        return;
      }
      setSelectedId(contactId);
      recordAction(contactId, "DESIGNATE");
      setContacts(
        (current) => current.map(
          (contact) => contact.id === contactId ? {
            ...contact,
            designated: true,
            classification: contact.classification === "UNKNOWN" ? "TRACKED" : contact.classification
          } : contact
        )
      );
      appendLog(`TRACK ${contactId} DESIGNATED`);
    },
    [appendLog, recordAction]
  );
  useEffect(() => {
    const onKey = (event) => {
      const step = event.shiftKey ? 22 : 7;
      if (event.key === "ArrowUp")
        setCursor((current) => ({ ...current, y: current.y - step }));
      else if (event.key === "ArrowDown")
        setCursor((current) => ({ ...current, y: current.y + step }));
      else if (event.key === "ArrowLeft")
        setCursor((current) => ({ ...current, x: current.x - step }));
      else if (event.key === "ArrowRight")
        setCursor((current) => ({ ...current, x: current.x + step }));
      else if (event.key === "Enter" && hoverId) selectContact(hoverId);
      else if (event.key === "Escape") setSelectedId(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverId, selectContact]);
  const updateContact = (contactId, patch) => {
    setContacts(
      (current) => current.map(
        (contact) => contact.id === contactId ? { ...contact, ...patch } : contact
      )
    );
  };
  const handleAction = (action) => {
    if (!selected) return;
    recordAction(selected.id, action);
    if (action === "EO_VERIFY") {
      appendLog(`EO SLEW REQUEST  ${selected.id}`);
      const result = runEO(selected, scenario, scenarioSecondsRef.current);
      updateContact(selected.id, { classification: "EO_ID", eoResult: result });
      appendLog(
        `${selected.id} EO ${result.status}  CONF ${(result.confidence * 100).toFixed(0)}%`
      );
      return;
    }
    if (action === "FLAG_ANOMALOUS") {
      updateContact(selected.id, {
        classification: "ANOMALOUS",
        flaggedAtSeconds: scenarioSecondsRef.current
      });
      appendLog(`${selected.id} FLAGGED ANOMALOUS`);
      return;
    }
    if (action === "MONITOR") {
      updateContact(selected.id, {
        classification: selected.classification === "UNKNOWN" ? "TRACKED" : selected.classification
      });
      appendLog(`${selected.id} RETAINED FOR MONITORING`);
      return;
    }
    updateContact(selected.id, { dropped: true });
    setSelectedId(null);
    appendLog(`${selected.id} TRACK DROPPED BY TRAINEE`);
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "min-h-screen w-full bg-[#020604] text-[#7fffae]",
      style: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      },
      children: [
        /* @__PURE__ */ jsx(
          TopBar,
          {
            scenarioId: scenario.id,
            scenarioTitle: scenario.title,
            contacts,
            settings,
            sweepDeg,
            onNewScenario: newScenario
          }
        ),
        /* @__PURE__ */ jsxs("div", { className: "flex h-[calc(100vh-44px)] min-h-[620px] w-full", children: [
          /* @__PURE__ */ jsx(
            LeftRail,
            {
              scenario,
              contacts,
              settings,
              assessment,
              selectedId
            }
          ),
          /* @__PURE__ */ jsxs(
            "main",
            {
              ref: wrapRef,
              className: "relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,#041208_0%,#010402_70%,#000_100%)]",
              children: [
                /* @__PURE__ */ jsx(
                  RadarScope,
                  {
                    scenario,
                    contacts,
                    tracks,
                    settings,
                    sweepDeg,
                    selectedId,
                    hoverId,
                    cursor,
                    size,
                    onCursor: setCursor,
                    onHover: setHoverId,
                    onSelect: selectContact
                  }
                ),
                selected && /* @__PURE__ */ jsx(
                  TrackPanel,
                  {
                    contact: selected,
                    track: tracks.get(selected.id),
                    onAction: handleAction,
                    onClose: () => setSelectedId(null)
                  }
                ),
                /* @__PURE__ */ jsx(
                  Controls,
                  {
                    settings,
                    setSettings,
                    cursor,
                    rangeNm: settings.rangeNm,
                    radius: size / 2 - 34,
                    onDebrief: () => setDebriefOpen(true)
                  }
                ),
                debriefOpen && /* @__PURE__ */ jsx(
                  Debrief,
                  {
                    assessment,
                    contacts,
                    onClose: () => setDebriefOpen(false)
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsx(LogPane, { log })
        ] })
      ]
    }
  );
}
function TopBar({
  scenarioId,
  scenarioTitle,
  contacts,
  settings,
  sweepDeg,
  onNewScenario
}) {
  const [clock, setClock] = useState("------Z");
  useEffect(() => {
    const id = window.setInterval(() => setClock(zulu(true)), 1e3);
    setClock(zulu(true));
    return () => window.clearInterval(id);
  }, []);
  return /* @__PURE__ */ jsxs("header", { className: "flex h-11 items-center gap-5 border-b border-[#0a2814] bg-[#03110a] px-4 text-[11px] tracking-widest text-[#5fcf8a]", children: [
    /* @__PURE__ */ jsx("span", { className: "text-[#7fffae]", children: "ALH COPILOT TRAINER // SURFACE SEARCH" }),
    /* @__PURE__ */ jsx(Stat, { k: "ID", v: scenarioId.replace("SCN-", "") }),
    /* @__PURE__ */ jsx(Stat, { k: "SCN", v: scenarioTitle.toUpperCase() }),
    /* @__PURE__ */ jsx(Stat, { k: "MODE", v: settings.mode.replace("_", " ") }),
    /* @__PURE__ */ jsx(Stat, { k: "RNG", v: `${settings.rangeNm}NM` }),
    /* @__PURE__ */ jsx(Stat, { k: "SECTOR", v: `${settings.sectorWidthDeg} DEG` }),
    /* @__PURE__ */ jsx(Stat, { k: "SWP", v: `${padBearing(sweepDeg)} DEG` }),
    /* @__PURE__ */ jsx(
      Stat,
      {
        k: "CONT",
        v: String(contacts.filter((c) => !c.dropped).length).padStart(2, "0")
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onNewScenario,
        className: "ml-auto border border-[#1f6b3a] px-2 py-0.5 text-[#7fffae] hover:bg-[#04200f]",
        children: "[ NEW SCENARIO ]"
      }
    ),
    /* @__PURE__ */ jsxs("span", { className: "text-[#7fffae]", children: [
      "UTC ",
      clock
    ] })
  ] });
}
function LeftRail({
  scenario,
  contacts,
  settings,
  assessment,
  selectedId
}) {
  const live = contacts.filter((contact) => !contact.dropped);
  const ais = live.filter((contact) => contact.aisActive).length;
  const anomalous = live.filter(
    (contact) => contact.classification === "ANOMALOUS"
  ).length;
  return /* @__PURE__ */ jsxs("aside", { className: "flex w-56 flex-col gap-3 border-r border-[#0a2814] bg-[#02100a] p-3 text-[10px] text-[#5fcf8a]", children: [
    /* @__PURE__ */ jsx(Section, { title: "OBJECTIVE", children: /* @__PURE__ */ jsx("p", { className: "leading-relaxed text-[#7fffae]", children: scenario.objective }) }),
    /* @__PURE__ */ jsxs(Section, { title: "OWN SHIP", children: [
      /* @__PURE__ */ jsx(Row, { k: "LAT", v: scenario.ownShip.lat }),
      /* @__PURE__ */ jsx(Row, { k: "LON", v: scenario.ownShip.lon }),
      /* @__PURE__ */ jsx(Row, { k: "HDG", v: `${scenario.ownShip.headingDeg} DEG` }),
      /* @__PURE__ */ jsx(Row, { k: "SPD", v: `${scenario.ownShip.speedKts} KT` }),
      /* @__PURE__ */ jsx(Row, { k: "ALT", v: `${scenario.ownShip.altitudeFt} FT` })
    ] }),
    /* @__PURE__ */ jsxs(Section, { title: "SENSORS", children: [
      /* @__PURE__ */ jsx(Row, { k: "RDR", v: "ON", ok: true }),
      /* @__PURE__ */ jsx(Row, { k: "AIS", v: "RX", ok: true }),
      /* @__PURE__ */ jsx(Row, { k: "EO/IR", v: "STBY" }),
      /* @__PURE__ */ jsx(Row, { k: "IFF", v: "MK XII" })
    ] }),
    /* @__PURE__ */ jsxs(Section, { title: "ENVIRONMENT", children: [
      /* @__PURE__ */ jsx(Row, { k: "WX", v: scenario.weather }),
      /* @__PURE__ */ jsx(Row, { k: "SEA", v: `STATE ${scenario.seaState}` }),
      /* @__PURE__ */ jsx(Row, { k: "MODE", v: settings.mode })
    ] }),
    /* @__PURE__ */ jsxs(Section, { title: "PICTURE", children: [
      /* @__PURE__ */ jsx(Row, { k: "CONT", v: String(live.length).padStart(2, "0") }),
      /* @__PURE__ */ jsx(Row, { k: "AIS", v: String(ais).padStart(2, "0") }),
      /* @__PURE__ */ jsx(Row, { k: "DARK", v: String(live.length - ais).padStart(2, "0") }),
      /* @__PURE__ */ jsx(
        Row,
        {
          k: "ANOM",
          v: String(anomalous).padStart(2, "0"),
          warn: anomalous > 0
        }
      )
    ] }),
    /* @__PURE__ */ jsxs(Section, { title: "ASSESSMENT", children: [
      /* @__PURE__ */ jsx(Row, { k: "DETECT", v: String(assessment.detected).padStart(2, "0") }),
      /* @__PURE__ */ jsx(
        Row,
        {
          k: "CORRECT",
          v: String(assessment.flaggedCorrectly).padStart(2, "0"),
          ok: true
        }
      ),
      /* @__PURE__ */ jsx(
        Row,
        {
          k: "FALSE",
          v: String(assessment.falsePositives).padStart(2, "0"),
          warn: assessment.falsePositives > 0
        }
      ),
      /* @__PURE__ */ jsx(
        Row,
        {
          k: "MISSED",
          v: String(assessment.missedSuspicious).padStart(2, "0"),
          warn: assessment.missedSuspicious > 0
        }
      )
    ] }),
    /* @__PURE__ */ jsx(Section, { title: "DESIG", children: /* @__PURE__ */ jsx("span", { className: selectedId ? "text-[#7fffae]" : "text-[#2f7a4e]", children: selectedId ? `TRK ${selectedId}` : "----" }) }),
    /* @__PURE__ */ jsxs("div", { className: "mt-auto leading-relaxed text-[#2f7a4e]", children: [
      "PUBLIC-SOURCE PROCEDURAL TRAINER",
      /* @__PURE__ */ jsx("br", {}),
      "TRACKBALL: MOUSE / ARROWS",
      /* @__PURE__ */ jsx("br", {}),
      "SELECT: CLICK / ENTER",
      /* @__PURE__ */ jsx("br", {}),
      "DESEL: ESC"
    ] })
  ] });
}
function TrackPanel({
  contact,
  track,
  onAction,
  onClose
}) {
  const br = bearingRangeFromPoint(contact.position);
  return /* @__PURE__ */ jsxs("div", { className: "absolute right-4 top-4 w-72 border border-[#1f6b3a] bg-[rgba(2,16,8,0.96)] text-[10px] tracking-wider text-[#7fffae] shadow-[0_0_24px_rgba(127,255,174,0.08)]", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between border-b border-[#0e3a20] bg-[#04200f] px-2 py-1", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "TRACK ",
        contact.id
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          onClick: onClose,
          className: "text-[#2f7a4e] hover:text-[#7fffae]",
          children: "X"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-2 gap-x-4 gap-y-1 px-2 py-2", children: [
      /* @__PURE__ */ jsx(Data, { k: "BRG", v: padBearing(br.bearingDeg) }),
      /* @__PURE__ */ jsx(Data, { k: "RNG", v: `${br.rangeNm.toFixed(1)}NM` }),
      /* @__PURE__ */ jsx(Data, { k: "SPD", v: `${Math.round(contact.speedKts)}KT` }),
      /* @__PURE__ */ jsx(Data, { k: "HDG", v: padBearing(contact.headingDeg) }),
      /* @__PURE__ */ jsx(
        Data,
        {
          k: "AIS",
          v: contact.aisActive ? "CURRENT" : "NONE/STALE",
          warn: !contact.aisActive
        }
      ),
      /* @__PURE__ */ jsx(Data, { k: "REP", v: contact.aisReportedKind ?? "---" }),
      /* @__PURE__ */ jsx(Data, { k: "CLS", v: contact.classification }),
      /* @__PURE__ */ jsx(
        Data,
        {
          k: "RDR",
          v: `${Math.round((track?.strength ?? 0) * 100)}%`,
          warn: track?.cluttered
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "border-t border-[#0e3a20] px-2 py-2", children: [
      /* @__PURE__ */ jsx("div", { className: "mb-1 text-[#2f7a4e]", children: "OBSERVABLE EVIDENCE" }),
      contact.evidence.map((item) => /* @__PURE__ */ jsxs("div", { className: "leading-relaxed", children: [
        "- ",
        item
      ] }, item)),
      contact.eoResult && /* @__PURE__ */ jsxs("div", { className: "mt-2 border-t border-[#0e3a20] pt-2", children: [
        /* @__PURE__ */ jsx("div", { className: "text-[#2f7a4e]", children: "EO RESULT" }),
        /* @__PURE__ */ jsx("div", { children: contact.eoResult.summary }),
        contact.eoResult.evidence.map((item) => /* @__PURE__ */ jsxs("div", { children: [
          "- ",
          item
        ] }, item))
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-1 px-2 pb-2", children: [
      /* @__PURE__ */ jsx(OpButton, { onClick: () => onAction("MONITOR"), children: "[ MONITOR ]" }),
      /* @__PURE__ */ jsx(OpButton, { onClick: () => onAction("EO_VERIFY"), children: "[ REQUEST EO ID ]" }),
      /* @__PURE__ */ jsx(OpButton, { onClick: () => onAction("FLAG_ANOMALOUS"), warn: true, children: "[ FLAG ANOMALOUS ]" }),
      /* @__PURE__ */ jsx(OpButton, { onClick: () => onAction("DROP"), danger: true, children: "[ DROP TRACK ]" })
    ] })
  ] });
}
function Controls({
  settings,
  setSettings,
  cursor,
  rangeNm,
  radius,
  onDebrief
}) {
  const br = screenToBearingRange(cursor.x, cursor.y, rangeNm, radius);
  const patch = (next) => setSettings((current) => ({ ...current, ...next }));
  return /* @__PURE__ */ jsx("div", { className: "absolute bottom-2 left-2 right-2 border-t border-[#0e3a20] bg-[rgba(2,16,8,0.78)] px-2 py-2 text-[10px] tracking-wider text-[#5fcf8a]", children: /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [
    /* @__PURE__ */ jsxs("span", { children: [
      /* @__PURE__ */ jsx("span", { className: "text-[#2f7a4e]", children: "TRKBALL " }),
      "B",
      padBearing(br.bearingDeg),
      " R",
      br.rangeNm.toFixed(1),
      "NM"
    ] }),
    /* @__PURE__ */ jsx(
      SelectNumber,
      {
        label: "RNG",
        value: settings.rangeNm,
        options: [5, 10, 20, 40, 80, 120],
        onChange: (range) => patch({ rangeNm: range })
      }
    ),
    /* @__PURE__ */ jsx(
      SelectNumber,
      {
        label: "SECTOR",
        value: settings.sectorWidthDeg,
        options: [60, 120, 180, 270, 360],
        onChange: (sectorWidthDeg) => patch({ sectorWidthDeg })
      }
    ),
    /* @__PURE__ */ jsx(
      SelectNumber,
      {
        label: "CENTER",
        value: settings.sectorCenterDeg,
        options: [0, 45, 90, 135, 180, 225, 270, 315],
        onChange: (sectorCenterDeg) => patch({ sectorCenterDeg })
      }
    ),
    /* @__PURE__ */ jsx(
      Slider,
      {
        label: "GAIN",
        value: settings.gain,
        onChange: (gain) => patch({ gain })
      }
    ),
    /* @__PURE__ */ jsx(
      Slider,
      {
        label: "SEA",
        value: settings.seaClutter,
        onChange: (seaClutter) => patch({ seaClutter })
      }
    ),
    /* @__PURE__ */ jsx(
      Slider,
      {
        label: "RAIN",
        value: settings.rainClutter,
        onChange: (rainClutter) => patch({ rainClutter })
      }
    ),
    /* @__PURE__ */ jsx(
      Slider,
      {
        label: "STC",
        value: settings.stc,
        onChange: (stc) => patch({ stc })
      }
    ),
    /* @__PURE__ */ jsxs(
      "select",
      {
        value: settings.mode,
        onChange: (event) => patch({ mode: event.target.value }),
        className: "bg-[#02100a] text-[#7fffae]",
        children: [
          /* @__PURE__ */ jsx("option", { value: "SURFACE_SEARCH", children: "SURF" }),
          /* @__PURE__ */ jsx("option", { value: "MTI", children: "MTI" }),
          /* @__PURE__ */ jsx("option", { value: "WEATHER", children: "WX" })
        ]
      }
    ),
    /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: () => patch({ ftc: !settings.ftc }),
        className: "border border-[#1f6b3a] px-1 text-[#7fffae]",
        children: [
          "FTC ",
          settings.ftc ? "ON" : "OFF"
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: onDebrief,
        className: "ml-auto border border-[#1f6b3a] px-2 text-[#ffb347]",
        children: "[ DEBRIEF ]"
      }
    )
  ] }) });
}
function Debrief({
  assessment,
  contacts,
  onClose
}) {
  const notable = assessment.items.filter((item) => item.outcome !== "INSUFFICIENT").slice(0, 10);
  return /* @__PURE__ */ jsxs("div", { className: "absolute inset-8 overflow-auto border border-[#1f6b3a] bg-[rgba(1,8,4,0.97)] p-4 text-[11px] text-[#7fffae]", children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-3 flex items-center justify-between", children: [
      /* @__PURE__ */ jsx("h2", { className: "text-sm tracking-widest", children: "TRAINING DEBRIEF" }),
      /* @__PURE__ */ jsx("button", { onClick: onClose, className: "border border-[#1f6b3a] px-2", children: "CLOSE" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-5 gap-2", children: [
      /* @__PURE__ */ jsx(Metric, { k: "DETECTED", v: assessment.detected }),
      /* @__PURE__ */ jsx(Metric, { k: "CORRECT FLAGS", v: assessment.flaggedCorrectly }),
      /* @__PURE__ */ jsx(Metric, { k: "FALSE POS", v: assessment.falsePositives }),
      /* @__PURE__ */ jsx(Metric, { k: "MISSED", v: assessment.missedSuspicious }),
      /* @__PURE__ */ jsx(
        Metric,
        {
          k: "LIVE CONTACTS",
          v: contacts.filter((contact) => !contact.dropped).length
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { className: "mt-4 text-[#2f7a4e]", children: "EVIDENCE REVIEW" }),
    /* @__PURE__ */ jsxs("div", { className: "mt-2 grid gap-2", children: [
      notable.map((item) => /* @__PURE__ */ jsxs("div", { className: "border border-[#0e3a20] p-2", children: [
        /* @__PURE__ */ jsxs("div", { className: "mb-1 text-[#ffb347]", children: [
          item.contactId,
          " // ",
          item.outcome,
          " // TRAINEE",
          " ",
          item.traineeDecision,
          " // TRUTH ",
          item.groundTruth
        ] }),
        item.rationale.map((line) => /* @__PURE__ */ jsxs("div", { children: [
          "- ",
          line
        ] }, line))
      ] }, item.contactId)),
      notable.length === 0 && /* @__PURE__ */ jsx("div", { children: "No decisive training events yet. Continue the sortie and flag contacts only when evidence supports escalation." })
    ] })
  ] });
}
function LogPane({ log }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return /* @__PURE__ */ jsxs("aside", { className: "flex w-72 flex-col border-l border-[#0a2814] bg-[#02100a] p-3 text-[10px] text-[#5fcf8a]", children: [
    /* @__PURE__ */ jsx("div", { className: "mb-2 tracking-widest text-[#2f7a4e]", children: "OPS LOG" }),
    /* @__PURE__ */ jsx("div", { ref, className: "flex-1 overflow-auto leading-relaxed", children: log.map((entry, i) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("span", { className: "text-[#2f7a4e]", children: [
        entry.t,
        " "
      ] }),
      entry.msg
    ] }, `${entry.t}-${i}`)) })
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { children: [
    /* @__PURE__ */ jsx("div", { className: "mb-1 tracking-widest text-[#2f7a4e]", children: title }),
    /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-0.5 pl-1", children })
  ] });
}
function Row({
  k,
  v,
  ok,
  warn
}) {
  return /* @__PURE__ */ jsxs("div", { className: "flex justify-between gap-2", children: [
    /* @__PURE__ */ jsx("span", { className: "text-[#2f7a4e]", children: k }),
    /* @__PURE__ */ jsx(
      "span",
      {
        className: warn ? "text-[#ffb347]" : ok ? "text-[#7fffae]" : "text-[#5fcf8a]",
        children: v
      }
    )
  ] });
}
function Data({ k, v, warn }) {
  return /* @__PURE__ */ jsx(Row, { k, v, warn });
}
function Stat({ k, v }) {
  return /* @__PURE__ */ jsxs("span", { children: [
    /* @__PURE__ */ jsxs("span", { className: "text-[#2f7a4e]", children: [
      k,
      " "
    ] }),
    v
  ] });
}
function OpButton({
  children,
  onClick,
  warn,
  danger
}) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      onClick,
      className: "border border-[#0e3a20] px-1 py-0.5 text-left hover:bg-[#04200f]",
      style: { color: danger ? "#ff7a6b" : warn ? "#ffb347" : "#7fffae" },
      children
    }
  );
}
function Slider({
  label,
  value,
  onChange
}) {
  return /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[#2f7a4e]", children: [
    label,
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "range",
        min: 0,
        max: 100,
        value,
        onChange: (event) => onChange(Number(event.target.value)),
        className: "w-16 accent-[#7fffae]"
      }
    ),
    /* @__PURE__ */ jsx("span", { className: "w-6 text-[#7fffae]", children: Math.round(value) })
  ] });
}
function SelectNumber({
  label,
  value,
  options,
  onChange
}) {
  return /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[#2f7a4e]", children: [
    label,
    /* @__PURE__ */ jsx(
      "select",
      {
        value,
        onChange: (event) => onChange(Number(event.target.value)),
        className: "bg-[#02100a] text-[#7fffae]",
        children: options.map((option) => /* @__PURE__ */ jsx("option", { value: option, children: option }, option))
      }
    )
  ] });
}
function Metric({ k, v }) {
  return /* @__PURE__ */ jsxs("div", { className: "border border-[#0e3a20] p-2", children: [
    /* @__PURE__ */ jsx("div", { className: "text-[#2f7a4e]", children: k }),
    /* @__PURE__ */ jsx("div", { className: "text-lg text-[#7fffae]", children: v })
  ] });
}
function zulu(withSeconds = false) {
  const now = /* @__PURE__ */ new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return withSeconds ? `${hh}${mm}${ss}Z` : `${hh}${mm}Z`;
}
function Index() {
  return /* @__PURE__ */ jsx(RadarConsole, {});
}
export {
  Index as component
};
