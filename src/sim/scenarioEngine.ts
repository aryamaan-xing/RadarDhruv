import {
  bearingRangeFromPoint,
  clamp,
  movePoint,
  normalizeDeg,
  pointFromBearingRange,
  seededRandom,
  shortAngleDiff,
} from "./math";
import type {
  AisMetadata,
  Contact,
  MotionRiskLevel,
  MotionAnalysis,
  PointNM,
  Scenario,
  ShippingLane,
  VesselBehavior,
  VesselIntent,
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
  scenario: Scenario,
): Contact[] {
  return contacts.map((contact) => {
    if (contact.dropped) return contact;

    const routeState = updateRouteState(contact, scenario, scenarioSeconds);
    const heading = routeState.headingDeg;
    const headingChangeDeg = Math.abs(shortAngleDiff(heading, contact.headingDeg));
    const speedKts = routeState.speedKts;
    const distanceNm = (speedKts / 3600) * dtSeconds;
    let position = movePoint(contact.position, heading, distanceNm);
    let resolvedHeading = heading;
    let routeIndex = routeState.routeIndex;

    if (pointInPolygon(position, scenario.coastline)) {
      resolvedHeading = normalizeDeg(heading + 180);
      position = movePoint(contact.position, resolvedHeading, distanceNm);
      if (pointInPolygon(position, scenario.coastline)) {
        position = contact.position;
      }
    }
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
      speedKts,
      headingDeg: resolvedHeading,
      routeIndex,
      crossTrackDeviationNm: routeState.crossTrackDeviationNm,
      trail,
      motionAnalysis: analyzeMotion(
        { ...contact, speedKts, crossTrackDeviationNm: routeState.crossTrackDeviationNm },
        headingChangeDeg,
      ),
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
  const actualKind = chooseKindForBehavior(behavior, rnd);
  const intent = intentForBehavior(behavior);
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
  const aisEquipped = actualKind !== "FAST_CRAFT" && rnd() < 0.84;
  const aisActive =
    aisEquipped && behavior !== "AIS_SILENT_TRANSIT" && rnd() > 0.08;
  const aisReportedKind =
    behavior === "AIS_MISMATCH" ? pick(rnd, ROUTINE_KINDS) : actualKind;
  const kind = aisReportedKind ?? actualKind;
  const speedKts = speedFor(actualKind, behavior, rnd);
  const route = createRouteForContact(position, headingDeg, behavior, lane, rnd);
  const aisMetadata = aisActive
    ? createAisMetadata(index, rnd, actualKind, aisReportedKind, behavior)
    : undefined;
  const routeDeviationNm = Math.abs(lateral);
  const motionAnalysis = initialMotionAnalysis(
    behavior,
    speedKts,
    routeDeviationNm,
    aisActive,
    actualKind,
    aisReportedKind,
    aisMetadata,
  );
  const evidence = [
    ...evidenceFor(behavior, aisActive, kind, aisReportedKind),
    ...motionAnalysis.reasons,
  ];

  return {
    id: `T${String(index + 1).padStart(2, "0")}`,
    position,
    speedKts,
    headingDeg,
    kind,
    behavior,
    intent,
    route,
    routeIndex: 1,
    desiredSpeedKts: speedKts,
    crossTrackDeviationNm: routeDeviationNm,
    aisEquipped,
    aisActive,
    aisReportedKind,
    actualKind,
    aisMetadata,
    motionAnalysis,
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

function intentForBehavior(behavior: VesselBehavior): VesselIntent {
  if (behavior === "FISHING_PATTERN") return "FISHING";
  if (behavior === "LOITERING") return "LOITER";
  if (behavior === "RENDEZVOUS") return "RENDEZVOUS";
  if (behavior === "PROTECTED_APPROACH") return "COASTAL_APPROACH";
  if (behavior === "AIS_MISMATCH") return "AIS_SPOOF";
  if (behavior === "AIS_SILENT_TRANSIT") return "SHADOW_ROUTE";
  return "NORMAL_TRANSIT";
}

function createRouteForContact(
  position: PointNM,
  headingDeg: number,
  behavior: VesselBehavior,
  lane: ShippingLane,
  rnd: () => number,
): PointNM[] {
  if (behavior === "ROUTINE_TRANSIT" || behavior === "AIS_MISMATCH") {
    const laneDx = lane.b.x - lane.a.x;
    const laneDy = lane.b.y - lane.a.y;
    const len = Math.hypot(laneDx, laneDy) || 1;
    const along = ((position.x - lane.a.x) * laneDx + (position.y - lane.a.y) * laneDy) / len;
    const forward = rnd() > 0.5 ? 1 : -1;
    return [
      position,
      {
        x: lane.a.x + (laneDx / len) * (along + forward * 35),
        y: lane.a.y + (laneDy / len) * (along + forward * 35),
      },
      {
        x: lane.a.x + (laneDx / len) * (along + forward * 95),
        y: lane.a.y + (laneDy / len) * (along + forward * 95),
      },
    ];
  }

  if (behavior === "PROTECTED_APPROACH") {
    return [position, { x: position.x * 0.55, y: Math.max(position.y, 20) }];
  }

  if (behavior === "RENDEZVOUS") {
    return [position, { x: position.x * 0.45 + 10, y: position.y * 0.45 - 8 }];
  }

  if (behavior === "LOITERING" || behavior === "FISHING_PATTERN") {
    const radius = behavior === "LOITERING" ? 5 : 8;
    return Array.from({ length: 5 }).map((_, i) => {
      const angle = (i / 5) * Math.PI * 2 + rnd() * 0.4;
      return {
        x: position.x + Math.cos(angle) * radius,
        y: position.y + Math.sin(angle) * radius,
      };
    });
  }

  return [
    position,
    movePoint(position, headingDeg + (rnd() - 0.5) * 35, 45),
    movePoint(position, headingDeg + (rnd() - 0.5) * 70, 90),
  ];
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

function createAisMetadata(
  index: number,
  rnd: () => number,
  kind: VesselKind,
  reportedKind: VesselKind | undefined,
  behavior: VesselBehavior,
): AisMetadata {
  const registry = pick(rnd, [
    "India",
    "Panama",
    "Liberia",
    "Singapore",
    "Marshall Islands",
    "Sri Lanka",
  ]);
  const lastPort = pick(rnd, [
    "Mumbai",
    "Kochi",
    "Colombo",
    "Salalah",
    "Singapore",
    "Jebel Ali",
  ]);
  const nextPort = pick(rnd, [
    "Kandla",
    "Mangalore",
    "Chennai",
    "Male",
    "Port Klang",
    "Fujairah",
  ]);
  const reported = reportedKind ?? kind;
  const spoofCargo =
    behavior === "AIS_MISMATCH"
      ? pick(rnd, ["General cargo", "Coastal supplies", "Fish catch"])
      : cargoFor(reported);

  return {
    mmsi: `419${String(700000 + index * 137 + Math.floor(rnd() * 99)).padStart(6, "0")}`,
    vesselName: `${namePrefixFor(reported)} ${String.fromCharCode(65 + (index % 26))}${String(index + 11)}`,
    nationality: registry,
    registryCountry: registry,
    lastPort,
    nextPort,
    cargo: spoofCargo,
    lengthM: lengthFor(reported, rnd),
    beamM: beamFor(reported, rnd),
  };
}

function cargoFor(kind: VesselKind) {
  if (kind === "TANKER") return "Petroleum products";
  if (kind === "MERCHANT") return "Container cargo";
  if (kind === "FISHING") return "Fish catch";
  if (kind === "TUG") return "Harbor support";
  if (kind === "PATROL") return "Government service";
  if (kind === "FAST_CRAFT") return "Passenger transfer";
  return "Coastal supplies";
}

function namePrefixFor(kind: VesselKind) {
  if (kind === "TANKER") return "MT";
  if (kind === "MERCHANT") return "MV";
  if (kind === "FISHING") return "FV";
  if (kind === "PATROL") return "CG";
  return "MS";
}

function lengthFor(kind: VesselKind, rnd: () => number) {
  if (kind === "TANKER") return Math.round(180 + rnd() * 110);
  if (kind === "MERCHANT") return Math.round(130 + rnd() * 120);
  if (kind === "FAST_CRAFT") return Math.round(12 + rnd() * 14);
  if (kind === "PATROL") return Math.round(35 + rnd() * 45);
  if (kind === "FISHING" || kind === "DHOW") return Math.round(18 + rnd() * 28);
  return Math.round(22 + rnd() * 30);
}

function beamFor(kind: VesselKind, rnd: () => number) {
  if (kind === "TANKER" || kind === "MERCHANT") return Math.round(22 + rnd() * 22);
  if (kind === "FAST_CRAFT") return Math.round(3 + rnd() * 4);
  return Math.round(5 + rnd() * 8);
}

function initialMotionAnalysis(
  behavior: VesselBehavior,
  speedKts: number,
  routeDeviationNm: number,
  aisActive: boolean,
  kind: VesselKind,
  reportedKind?: VesselKind,
  aisMetadata?: AisMetadata,
): MotionAnalysis {
  const reasons: string[] = [];
  let score = 0;

  if (!aisActive) {
    score += 28;
    reasons.push("No current AIS while radar contact is expected to be visible.");
  }
  if (behavior === "LOITERING") {
    score += 30;
    reasons.push("Low-speed loitering away from shortest-path lane flow.");
  }
  if (behavior === "RENDEZVOUS") {
    score += 24;
    reasons.push("Course favors rendezvous with another small contact.");
  }
  if (behavior === "PROTECTED_APPROACH") {
    score += 34;
    reasons.push("Track closes a protected or high-interest coastal zone.");
  }
  if (behavior === "AIS_MISMATCH" && reportedKind && reportedKind !== kind) {
    score += 38;
    reasons.push(`AIS reports ${reportedKind}, but motion profile resembles ${kind}.`);
  }
  if (behavior === "FISHING_PATTERN") {
    score += 10;
    reasons.push("Irregular course changes are plausible for fishing but require monitoring.");
  }
  if (routeDeviationNm > 14) {
    score += 18;
    reasons.push("Route deviates from the merchant lane corridor.");
  }
  if (speedKts > 22) {
    score += 16;
    reasons.push("Speed is high for normal merchant lane traffic.");
  }
  if (aisMetadata && aisMetadata.lengthM < 40 && reportedKind === "MERCHANT") {
    score += 16;
    reasons.push("AIS dimensions are small for the reported merchant profile.");
  }
  if (score === 0) reasons.push("Steady course and speed along expected traffic lane.");

  return {
    riskScore: Math.min(100, score),
    riskLevel: riskLevel(score),
    headingChangeDeg: 0,
    routeDeviationNm,
    speedKts,
    reasons,
  };
}

function analyzeMotion(contact: Contact, headingChangeDeg: number): MotionAnalysis {
  const reasons = [...contact.motionAnalysis.reasons];
  let riskScore = contact.motionAnalysis.riskScore;

  if (headingChangeDeg > 1.2) {
    riskScore = Math.min(100, riskScore + 2);
    if (!reasons.some((reason) => reason.includes("Rapid heading alteration"))) {
      reasons.unshift("Rapid heading alteration suggests evasive or tactical routing.");
    }
  }

  if (contact.crossTrackDeviationNm > 10) {
    riskScore = Math.min(100, riskScore + 1.4);
    if (!reasons.some((reason) => reason.includes("Cross-track deviation"))) {
      reasons.unshift("Cross-track deviation from expected route is increasing.");
    }
  }

  if (Math.abs(contact.speedKts - contact.desiredSpeedKts) > 3.5) {
    riskScore = Math.min(100, riskScore + 1);
    if (!reasons.some((reason) => reason.includes("Speed changes"))) {
      reasons.unshift("Speed changes are inconsistent with steady merchant transit.");
    }
  }

  if (
    contact.intent === "AIS_SPOOF" &&
    contact.aisActive &&
    contact.aisReportedKind !== contact.actualKind
  ) {
    riskScore = Math.min(100, riskScore + 1);
    if (!reasons.some((reason) => reason.includes("AIS identity"))) {
      reasons.unshift("AIS identity is plausible, but motion does not match the declared vessel.");
    }
  }

  return {
    ...contact.motionAnalysis,
    headingChangeDeg,
    routeDeviationNm: contact.crossTrackDeviationNm,
    speedKts: contact.speedKts,
    riskScore,
    riskLevel: riskLevel(riskScore),
    reasons: reasons.slice(0, 5),
  };
}

function riskLevel(score: number): MotionRiskLevel {
  if (score >= 55) return "SUSPECT";
  if (score >= 25) return "WATCH";
  return "LOW";
}

function updateRouteState(
  contact: Contact,
  scenario: Scenario,
  scenarioSeconds: number,
) {
  const route = contact.route.length > 1 ? contact.route : [contact.position];
  let routeIndex = Math.min(contact.routeIndex, route.length - 1);
  let waypoint = route[routeIndex] ?? contact.position;
  let toWaypoint = bearingRangeFromPoint({
    x: waypoint.x - contact.position.x,
    y: waypoint.y - contact.position.y,
  });

  if (toWaypoint.rangeNm < 1.2 && route.length > 1) {
    routeIndex = (routeIndex + 1) % route.length;
    waypoint = route[routeIndex] ?? waypoint;
    toWaypoint = bearingRangeFromPoint({
      x: waypoint.x - contact.position.x,
      y: waypoint.y - contact.position.y,
    });
  }

  const routeDeviationNm = distanceToRoute(contact.position, route);
  const phase = Number(contact.id.slice(1)) || contact.id.length;
  let headingDeg = toWaypoint.rangeNm > 0.1 ? toWaypoint.bearingDeg : contact.headingDeg;
  let speedKts = contact.desiredSpeedKts;

  if (contact.intent === "NORMAL_TRANSIT") {
    headingDeg += Math.sin(scenarioSeconds / 70 + phase) * 0.6;
  } else if (contact.intent === "FISHING") {
    headingDeg += Math.sin(scenarioSeconds / 16 + phase) * 12;
    speedKts = Math.max(2, contact.desiredSpeedKts * 0.55);
  } else if (contact.intent === "LOITER") {
    headingDeg += Math.sin(scenarioSeconds / 11 + phase) * 18;
    speedKts = Math.max(1.5, contact.desiredSpeedKts * 0.45);
  } else if (contact.intent === "RENDEZVOUS") {
    headingDeg += Math.sin(scenarioSeconds / 22 + phase) * 7;
    speedKts = contact.desiredSpeedKts + Math.sin(scenarioSeconds / 18) * 2.8;
  } else if (contact.intent === "AIS_SPOOF") {
    headingDeg += Math.sin(scenarioSeconds / 18 + phase) * 9;
    speedKts = contact.desiredSpeedKts + Math.sin(scenarioSeconds / 25 + phase) * 3.4;
  } else if (contact.intent === "COASTAL_APPROACH") {
    const zone = scenario.protectedZones[0];
    if (zone) {
      const toZone = bearingRangeFromPoint({
        x: zone.center.x - contact.position.x,
        y: zone.center.y - contact.position.y,
      });
      headingDeg = toZone.bearingDeg + Math.sin(scenarioSeconds / 20 + phase) * 5;
    }
  } else if (contact.intent === "SHADOW_ROUTE") {
    headingDeg += 10 + Math.sin(scenarioSeconds / 24 + phase) * 5;
  } else if (contact.intent === "EVASIVE_RANDOM_WALK") {
    headingDeg +=
      Math.sin(scenarioSeconds / 9 + phase) * 16 +
      Math.sin(scenarioSeconds / 27 + phase) * 9;
    speedKts = contact.desiredSpeedKts + Math.sin(scenarioSeconds / 14 + phase) * 4;
  }

  return {
    headingDeg: normalizeDeg(headingDeg),
    speedKts: Math.max(1, speedKts),
    routeIndex,
    crossTrackDeviationNm: routeDeviationNm,
  };
}

function nextHeading(contact: Contact, scenarioSeconds: number) {
  const phase = Number(contact.id.slice(1)) || contact.id.length;
  if (
    contact.behavior === "LOITERING" ||
    contact.behavior === "FISHING_PATTERN"
  ) {
    return normalizeDeg(
      contact.headingDeg +
        Math.sin(scenarioSeconds / 18 + phase) * 0.42,
    );
  }
  if (contact.behavior === "RENDEZVOUS") {
    return normalizeDeg(
      contact.headingDeg + Math.sin(scenarioSeconds / 24 + phase) * 0.34,
    );
  }
  if (
    contact.behavior === "PROTECTED_APPROACH" ||
    contact.behavior === "AIS_MISMATCH"
  ) {
    return normalizeDeg(
      contact.headingDeg +
        Math.sin(scenarioSeconds / 20 + phase) * 0.28 +
        Math.sin(scenarioSeconds / 7 + phase * 0.3) * 0.12,
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

function distanceToRoute(point: PointNM, route: PointNM[]) {
  if (route.length < 2) return 0;
  return Math.min(
    ...route.slice(1).map((end, index) => {
      const start = route[index];
      return distanceToSegment(point, start, end);
    }),
  );
}

function distanceToSegment(point: PointNM, start: PointNM, end: PointNM) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function pointInPolygon(point: PointNM, polygon: PointNM[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
