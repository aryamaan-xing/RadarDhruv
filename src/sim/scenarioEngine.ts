import {
  bearingRangeFromPoint,
  clamp,
  movePoint,
  normalizeDeg,
  pointFromBearingRange,
  seededRandom,
} from "./math";
import type {
  Contact,
  PointNM,
  Scenario,
  ShippingLane,
  VesselBehavior,
  VesselKind,
} from "./types";

const CONTACT_COUNT = 34;

const ROUTINE_KINDS: VesselKind[] = [
  "FISHING",
  "MERCHANT",
  "TANKER",
  "DHOW",
  "TUG",
];
const SUSPICIOUS_BEHAVIORS: VesselBehavior[] = [
  "AIS_SILENT_TRANSIT",
  "LOITERING",
  "RENDEZVOUS",
  "PROTECTED_APPROACH",
  "AIS_MISMATCH",
];

const ROUTINE_BEHAVIORS: VesselBehavior[] = [
  "ROUTINE_TRANSIT",
  "FISHING_PATTERN",
  "COASTAL_WORK",
];

export function createInitialScenario(seed = 20260601): Scenario {
  const rnd = seededRandom(seed);
  const area = pick(rnd, [
    {
      title: "Coastal lane surveillance",
      objective:
        "Build the surface picture across busy traffic lanes, correlate AIS, and flag behavior that does not match the lane pattern.",
      operatingArea: "Western seaboard traffic lane training area",
    },
    {
      title: "Offshore security screen",
      objective:
        "Monitor contacts approaching a protected coastal zone, prioritize dark targets, and request EO when behavior warrants.",
      operatingArea: "Offshore security screen, public-source procedural model",
    },
    {
      title: "Post-rain clutter search",
      objective:
        "Tune clutter controls, maintain track continuity through weather returns, and identify anomalous small craft.",
      operatingArea: "Littoral rain-clutter training box",
    },
  ]);
  const weatherRoll = rnd();
  const weather =
    weatherRoll > 0.78 ? "RAIN" : weatherRoll > 0.56 ? "HAZE" : "CLEAR";
  const seaState = (
    weather === "RAIN" ? 4 : weather === "HAZE" ? 3 : 2
  ) as Scenario["seaState"];

  const lanes = createShippingLanes(rnd);
  const protectedZones = [
    {
      center: { x: -24 + rnd() * 48, y: 18 + rnd() * 30 },
      radiusNm: 7 + rnd() * 4,
      label: "COASTAL SECURITY ZONE",
    },
  ];
  const contacts: Contact[] = [];

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
      altitudeFt: 1200,
    },
    contacts,
    coastline: createCoastline(rnd),
    lanes,
    rainCells:
      weather === "RAIN"
        ? [
            { center: { x: 15, y: 34 }, radiusNm: 14, intensity: 0.7 },
            { center: { x: -28, y: -12 }, radiusNm: 9, intensity: 0.48 },
          ]
        : weather === "HAZE"
          ? [{ center: { x: 26, y: -24 }, radiusNm: 10, intensity: 0.3 }]
          : [],
    protectedZones,
  };
}

export function advanceContacts(
  contacts: Contact[],
  dtSeconds: number,
  scenarioSeconds: number,
): Contact[] {
  return contacts.map((contact) => {
    if (contact.dropped) return contact;

    const heading = nextHeading(contact, scenarioSeconds);
    const distanceNm = (contact.speedKts / 3600) * dtSeconds;
    let position = movePoint(contact.position, heading, distanceNm);
    const br = bearingRangeFromPoint(position);

    if (br.rangeNm > 126) {
      const spawnBearing = normalizeDeg(br.bearingDeg + 180);
      position = pointFromBearingRange(spawnBearing, 118);
    }

    const trail = [{ ...position, ageSeconds: 0 }, ...contact.trail]
      .slice(0, 18)
      .map((p) => ({ ...p, ageSeconds: p.ageSeconds + dtSeconds }));

    return {
      ...contact,
      position,
      headingDeg: heading,
      trail,
      lastAisUpdateSeconds:
        contact.aisActive && scenarioSeconds - contact.lastAisUpdateSeconds > 35
          ? scenarioSeconds
          : contact.lastAisUpdateSeconds,
    };
  });
}

export function createScenarioFromClock() {
  return createInitialScenario(
    Math.floor((Date.now() + Math.random() * 1_000_000) % 1_000_000_000),
  );
}

function createContact(
  index: number,
  rnd: () => number,
  lanes: ShippingLane[],
): Contact {
  const suspicious = rnd() < 0.24;
  const behavior = pick(
    rnd,
    suspicious ? SUSPICIOUS_BEHAVIORS : ROUTINE_BEHAVIORS,
  );
  const kind = chooseKindForBehavior(behavior, rnd);
  const lane = pick(rnd, lanes);
  const along = -0.46 + rnd() * 0.92;
  const lateral = (rnd() - 0.5) * (behavior === "LOITERING" ? 30 : 9);
  const laneDx = lane.b.x - lane.a.x;
  const laneDy = lane.b.y - lane.a.y;
  const base = {
    x: lane.a.x + laneDx * (along + 0.5),
    y: lane.a.y + laneDy * (along + 0.5),
  };
  const len = Math.hypot(laneDx, laneDy) || 1;
  const position = {
    x: clamp(base.x + (-laneDy / len) * lateral, -105, 105),
    y: clamp(base.y + (laneDx / len) * lateral, -105, 105),
  };
  const laneHeading = normalizeDeg(
    (Math.atan2(laneDx, laneDy) * 180) / Math.PI,
  );
  const headingDeg =
    behavior === "FISHING_PATTERN" || behavior === "LOITERING"
      ? normalizeDeg(rnd() * 360)
      : behavior === "PROTECTED_APPROACH"
        ? normalizeDeg(315 + (rnd() - 0.5) * 28)
        : normalizeDeg(
            laneHeading + (rnd() > 0.5 ? 0 : 180) + (rnd() - 0.5) * 10,
          );
  const aisEquipped = kind !== "FAST_CRAFT" && rnd() < 0.84;
  const aisActive =
    aisEquipped && behavior !== "AIS_SILENT_TRANSIT" && rnd() > 0.08;
  const aisReportedKind =
    behavior === "AIS_MISMATCH" ? pick(rnd, ROUTINE_KINDS) : kind;
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
    groundTruth: suspicious ? "SUSPICIOUS" : "ROUTINE",
  };
}

function createShippingLanes(rnd: () => number): ShippingLane[] {
  const baseBearing = 42 + rnd() * 70;
  const laneGap = 28 + rnd() * 18;
  return [0, 1].map((laneIndex) => {
    const bearing = normalizeDeg(baseBearing + laneIndex * (78 + rnd() * 22));
    const offset = (laneIndex === 0 ? -laneGap : laneGap) + (rnd() - 0.5) * 18;
    const along = pointFromBearingRange(bearing, 115);
    const cross = pointFromBearingRange(bearing + 90, offset);
    return {
      a: { x: -along.x + cross.x, y: -along.y + cross.y },
      b: { x: along.x + cross.x, y: along.y + cross.y },
    };
  });
}

function createCoastline(rnd: () => number): PointNM[] {
  const edge = pick(rnd, ["NORTH", "SOUTH", "WEST"] as const);
  const points: PointNM[] = [];
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

function chooseKindForBehavior(
  behavior: VesselBehavior,
  rnd: () => number,
): VesselKind {
  if (behavior === "PROTECTED_APPROACH")
    return rnd() > 0.45 ? "FAST_CRAFT" : "DHOW";
  if (behavior === "RENDEZVOUS") return rnd() > 0.5 ? "DHOW" : "FISHING";
  if (behavior === "AIS_MISMATCH") return rnd() > 0.5 ? "FAST_CRAFT" : "PATROL";
  if (behavior === "FISHING_PATTERN") return rnd() > 0.2 ? "FISHING" : "DHOW";
  return pick(rnd, ROUTINE_KINDS);
}

function speedFor(
  kind: VesselKind,
  behavior: VesselBehavior,
  rnd: () => number,
) {
  if (behavior === "LOITERING") return 2 + rnd() * 4;
  if (kind === "FAST_CRAFT") return 24 + rnd() * 18;
  if (kind === "PATROL") return 18 + rnd() * 14;
  if (kind === "FISHING" || kind === "DHOW") return 5 + rnd() * 7;
  if (kind === "TUG") return 6 + rnd() * 6;
  return 11 + rnd() * 10;
}

function nextHeading(contact: Contact, scenarioSeconds: number) {
  if (
    contact.behavior === "LOITERING" ||
    contact.behavior === "FISHING_PATTERN"
  ) {
    return normalizeDeg(
      contact.headingDeg +
        Math.sin(scenarioSeconds / 38 + contact.id.length) * 0.18,
    );
  }
  if (contact.behavior === "RENDEZVOUS") {
    return normalizeDeg(
      contact.headingDeg + Math.sin(scenarioSeconds / 55) * 0.08,
    );
  }
  return contact.headingDeg;
}

function evidenceFor(
  behavior: VesselBehavior,
  aisActive: boolean,
  kind: VesselKind,
  reportedKind?: VesselKind,
) {
  const evidence: string[] = [];
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

function pick<T>(rnd: () => number, values: T[]) {
  return values[Math.floor(rnd() * values.length)];
}
