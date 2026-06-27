import {
  bearingRangeFromPoint,
  clamp,
  isInsideSector,
  shortAngleDiff,
} from "./math";
import type {
  Contact,
  EOResult,
  RadarSettings,
  Scenario,
  SensorTrack,
} from "./types";

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  rangeNm: 80,
  sectorCenterDeg: 0,
  sectorWidthDeg: 270,
  gain: 62,
  seaClutter: 40,
  rainClutter: 35,
  stc: 42,
  ftc: true,
  mode: "SURFACE_SEARCH",
};

const RAW_PAINT_PERSISTENCE_SECONDS = 14;
const TRACK_FILE_COAST_SECONDS = 42;

export function detectContacts(
  scenario: Scenario,
  contacts: Contact[],
  settings: RadarSettings,
  sweepDeg: number,
  previous: Map<string, SensorTrack>,
  scenarioSeconds: number,
): Map<string, SensorTrack> {
  const tracks = new Map<string, SensorTrack>();

  for (const contact of contacts) {
    if (contact.dropped) continue;
    const br = bearingRangeFromPoint(contact.position);
    const old = previous.get(contact.id);
    const inRange = br.rangeNm <= settings.rangeNm;
    const inSector = isInsideSector(
      br.bearingDeg,
      settings.sectorCenterDeg,
      settings.sectorWidthDeg,
    );
    const crossed = Math.abs(shortAngleDiff(sweepDeg, br.bearingDeg)) < 5.5;
    const rainPenalty = rainPenaltyAt(contact.position, scenario, settings);
    const seaPenalty =
      br.rangeNm < 15 ? settings.seaClutter / 150 : settings.seaClutter / 320;
    const stcPenalty = br.rangeNm < 8 ? settings.stc / 160 : 0;
    const modeBonus =
      settings.mode === "MTI" && contact.speedKts > 10
        ? 0.14
        : settings.mode === "WEATHER"
          ? -0.1
          : 0;
    const sizeBonus =
      contact.kind === "TANKER" || contact.kind === "MERCHANT"
        ? 0.18
        : contact.kind === "FAST_CRAFT"
          ? -0.12
          : 0;
    const rangePenalty = br.rangeNm / 170;
    const strength = clamp(
      0.95 +
        sizeBonus +
        modeBonus -
        rainPenalty -
        seaPenalty -
        stcPenalty -
        rangePenalty,
      0,
      1,
    );
    const painted =
      inRange && inSector && crossed && strength > paintThreshold(settings);
    const trackFile =
      contact.aisActive ||
      contact.designated ||
      contact.classification === "TRACKED" ||
      contact.classification === "ANOMALOUS" ||
      contact.classification === "EO_ID";
    const lastPaintSeconds = painted
      ? scenarioSeconds
      : (old?.lastPaintSeconds ??
        (trackFile && inRange && inSector ? scenarioSeconds : -999));
    const ageSeconds = scenarioSeconds - lastPaintSeconds;
    const persistence = trackFile
      ? TRACK_FILE_COAST_SECONDS
      : RAW_PAINT_PERSISTENCE_SECONDS;
    const faded = ageSeconds > persistence;
    const cluttered = rainPenalty > 0.18 || seaPenalty + stcPenalty > 0.34;
    const merged = hasNearbyTrack(contact, contacts, settings.rangeNm);

    tracks.set(contact.id, {
      contactId: contact.id,
      bearingDeg: br.bearingDeg,
      rangeNm: br.rangeNm,
      strength,
      painted,
      visible:
        inRange &&
        inSector &&
        !faded &&
        (trackFile ? strength > 0.12 : strength > 0.18),
      trackFile,
      faded,
      cluttered,
      merged,
      lastPaintSeconds,
      ageSeconds,
    });
  }

  return tracks;
}

export function runEO(
  contact: Contact,
  scenario: Scenario,
  scenarioSeconds: number,
): EOResult {
  const { rangeNm } = bearingRangeFromPoint(contact.position);
  const weatherPenalty =
    scenario.weather === "RAIN" ? 0.32 : scenario.weather === "HAZE" ? 0.18 : 0;
  const rangePenalty = clamp((rangeNm - 22) / 42, 0, 0.45);
  const confidence = clamp(0.92 - weatherPenalty - rangePenalty, 0.15, 0.96);

  if (rangeNm > 56 || confidence < 0.22) {
    return {
      status: "NO_LINE_OF_SIGHT",
      confidence,
      summary: `EO unable to classify ${contact.id}; range/weather exceed useful identification conditions.`,
      evidence: [
        "EO line of sight or image quality insufficient",
        `Range ${rangeNm.toFixed(1)} NM`,
      ],
    };
  }

  const degraded = confidence < 0.55;
  const evidence = [
    `Visual profile consistent with ${contact.kind}`,
    `Radar course ${Math.round(contact.headingDeg).toString().padStart(3, "0")} at ${Math.round(contact.speedKts)} kt`,
    ...contact.evidence.slice(0, 2),
  ];

  return {
    status: degraded ? "DEGRADED" : "CONFIRMED",
    confidence,
    summary: `${degraded ? "Degraded" : "Positive"} EO observation at T+${Math.round(scenarioSeconds)}s.`,
    evidence,
  };
}

function paintThreshold(settings: RadarSettings) {
  return clamp(
    0.28 + (50 - settings.gain) / 220 + (settings.ftc ? -0.03 : 0.03),
    0.16,
    0.62,
  );
}

function rainPenaltyAt(
  position: { x: number; y: number },
  scenario: Scenario,
  settings: RadarSettings,
) {
  if (scenario.weather === "CLEAR" && scenario.rainCells.length === 0) return 0;
  let penalty = 0;
  for (const cell of scenario.rainCells) {
    const d = Math.hypot(
      position.x - cell.center.x,
      position.y - cell.center.y,
    );
    if (d < cell.radiusNm) {
      penalty +=
        (1 - d / cell.radiusNm) * cell.intensity * (settings.rainClutter / 75);
    }
  }
  return clamp(penalty, 0, 0.62);
}

function hasNearbyTrack(
  contact: Contact,
  contacts: Contact[],
  rangeNm: number,
) {
  return contacts.some((other) => {
    if (other.id === contact.id || other.dropped) return false;
    const d = Math.hypot(
      other.position.x - contact.position.x,
      other.position.y - contact.position.y,
    );
    return d < Math.max(0.9, rangeNm / 90);
  });
}
