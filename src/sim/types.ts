export type Classification =
  | "UNKNOWN"
  | "TRACKED"
  | "AIS"
  | "ANOMALOUS"
  | "EO_ID";

export type VesselKind =
  | "FISHING"
  | "MERCHANT"
  | "TANKER"
  | "DHOW"
  | "TUG"
  | "PATROL"
  | "FAST_CRAFT";

export type VesselBehavior =
  | "ROUTINE_TRANSIT"
  | "FISHING_PATTERN"
  | "COASTAL_WORK"
  | "AIS_SILENT_TRANSIT"
  | "LOITERING"
  | "RENDEZVOUS"
  | "PROTECTED_APPROACH"
  | "AIS_MISMATCH";

export type VesselIntent =
  | "NORMAL_TRANSIT"
  | "FISHING"
  | "LOITER"
  | "RENDEZVOUS"
  | "SHADOW_ROUTE"
  | "AIS_SPOOF"
  | "COASTAL_APPROACH"
  | "EVASIVE_RANDOM_WALK";

export type RadarMode = "SURFACE_SEARCH" | "WEATHER" | "MTI";

export type MotionRiskLevel = "LOW" | "WATCH" | "SUSPECT";

export interface PointNM {
  x: number;
  y: number;
}

export interface TrailPoint extends PointNM {
  ageSeconds: number;
}

export interface Contact {
  id: string;
  position: PointNM;
  speedKts: number;
  headingDeg: number;
  kind: VesselKind;
  behavior: VesselBehavior;
  intent: VesselIntent;
  route: PointNM[];
  routeIndex: number;
  desiredSpeedKts: number;
  crossTrackDeviationNm: number;
  aisEquipped: boolean;
  aisActive: boolean;
  aisReportedKind?: VesselKind;
  actualKind: VesselKind;
  aisMetadata?: AisMetadata;
  motionAnalysis: MotionAnalysis;
  lastAisUpdateSeconds: number;
  classification: Classification;
  designated: boolean;
  dropped: boolean;
  trail: TrailPoint[];
  evidence: string[];
  groundTruth: "ROUTINE" | "SUSPICIOUS";
  detectedAtSeconds?: number;
  flaggedAtSeconds?: number;
  eoResult?: EOResult;
}

export interface AisMetadata {
  mmsi: string;
  vesselName: string;
  nationality: string;
  registryCountry: string;
  lastPort: string;
  nextPort: string;
  cargo: string;
  lengthM: number;
  beamM: number;
}

export interface MotionAnalysis {
  riskScore: number;
  riskLevel: MotionRiskLevel;
  headingChangeDeg: number;
  routeDeviationNm: number;
  speedKts: number;
  reasons: string[];
}

export interface RainCell {
  center: PointNM;
  radiusNm: number;
  intensity: number;
}

export interface ShippingLane {
  a: PointNM;
  b: PointNM;
}

export interface ProtectedZone {
  center: PointNM;
  radiusNm: number;
  label: string;
}

export interface Scenario {
  id: string;
  seed: number;
  title: string;
  objective: string;
  operatingArea: string;
  weather: "CLEAR" | "HAZE" | "RAIN";
  seaState: 1 | 2 | 3 | 4 | 5;
  ownShip: {
    lat: string;
    lon: string;
    headingDeg: number;
    speedKts: number;
    altitudeFt: number;
  };
  contacts: Contact[];
  coastline: PointNM[];
  lanes: ShippingLane[];
  rainCells: RainCell[];
  protectedZones: ProtectedZone[];
}

export interface RadarSettings {
  rangeNm: number;
  sectorCenterDeg: number;
  sectorWidthDeg: number;
  transmitting: boolean;
  gain: number;
  seaClutter: number;
  rainClutter: number;
  stc: number;
  ftc: boolean;
  mode: RadarMode;
}

export interface SensorTrack {
  contactId: string;
  bearingDeg: number;
  rangeNm: number;
  strength: number;
  painted: boolean;
  visible: boolean;
  trackFile: boolean;
  faded: boolean;
  cluttered: boolean;
  merged: boolean;
  lastPaintSeconds: number;
  ageSeconds: number;
}

export interface EOResult {
  status: "CONFIRMED" | "DEGRADED" | "NO_LINE_OF_SIGHT";
  confidence: number;
  summary: string;
  evidence: string[];
}

export interface TraineeAction {
  t: number;
  contactId: string;
  action: "DESIGNATE" | "EO_VERIFY" | "FLAG_ANOMALOUS" | "MONITOR" | "DROP";
}

export interface AssessmentItem {
  contactId: string;
  groundTruth: "ROUTINE" | "SUSPICIOUS";
  traineeDecision: "FLAGGED" | "MONITORED" | "DROPPED" | "MISSED";
  outcome: "CORRECT" | "FALSE_POSITIVE" | "MISSED_THREAT" | "INSUFFICIENT";
  rationale: string[];
}

export interface AssessmentSummary {
  detected: number;
  flaggedCorrectly: number;
  falsePositives: number;
  missedSuspicious: number;
  unnecessaryDrops: number;
  items: AssessmentItem[];
}
