import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { RadarScope } from "./RadarScope";
import {
  advanceContacts,
  createInitialScenario,
  createScenarioFromClock,
} from "@/sim/scenarioEngine";
import {
  DEFAULT_RADAR_SETTINGS,
  detectContacts,
  runEO,
} from "@/sim/sensorModel";
import {
  bearingRangeFromPoint,
  padBearing,
  screenToBearingRange,
} from "@/sim/math";
import type {
  Contact,
  RadarSettings,
  Scenario,
  SensorTrack,
  TraineeAction,
} from "@/sim/types";

const TIME_SCALE = 180;
const DEFAULT_SIZE = 720;

export function RadarConsole() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastFrameRef = useRef(0);
  const scenarioSecondsRef = useRef(0);
  const sweepRef = useRef(0);
  const settingsRef = useRef<RadarSettings>(DEFAULT_RADAR_SETTINGS);
  const scenarioRef = useRef<Scenario | null>(null);
  const tracksRef = useRef<Map<string, SensorTrack>>(new Map());
  const [scenario, setScenario] = useState(() => createInitialScenario());
  const [contacts, setContacts] = useState<Contact[]>(() => scenario.contacts);
  const [ownHeadingDeg, setOwnHeadingDeg] = useState(
    scenario.ownShip.headingDeg,
  );
  const [settings, setSettings] = useState<RadarSettings>(
    DEFAULT_RADAR_SETTINGS,
  );
  const [tracks, setTracks] = useState<Map<string, SensorTrack>>(new Map());
  const [sweepDeg, setSweepDeg] = useState(0);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [actions, setActions] = useState<TraineeAction[]>([]);
  const selected =
    contacts.find((contact) => contact.id === selectedId) ?? null;
  const displayScenario = useMemo(
    () => ({
      ...scenario,
      ownShip: { ...scenario.ownShip, headingDeg: ownHeadingDeg },
    }),
    [scenario, ownHeadingDeg],
  );

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  const recordAction = useCallback(
    (contactId: string, action: TraineeAction["action"]) => {
      setActions((current) => [
        ...current,
        { t: scenarioSecondsRef.current, contactId, action },
      ]);
    },
    [],
  );

  const newScenario = useCallback(() => {
    const next = createScenarioFromClock();
    scenarioSecondsRef.current = 0;
    sweepRef.current = 0;
    lastFrameRef.current = 0;
    setScenario(next);
    scenarioRef.current = next;
    setOwnHeadingDeg(next.ownShip.headingDeg);
    setContacts(next.contacts);
    const initialTracks = detectContacts(
      next,
      next.contacts,
      settingsRef.current,
      0,
      new Map(),
      0,
    );
    setTracks(initialTracks);
    tracksRef.current = initialTracks;
    setSweepDeg(0);
    setSelectedId(null);
    setHoverId(null);
    setActions([]);
  }, []);

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
    const tick = (now: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const dtReal = Math.min(0.08, (now - lastFrameRef.current) / 1000);
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
          scenarioSecondsRef.current,
          currentScenario,
        );
        const detected = detectContacts(
          currentScenario,
          advanced,
          settingsRef.current,
          nextSweep,
          tracksRef.current,
          scenarioSecondsRef.current,
        );
        tracksRef.current = detected;
        setTracks(detected);
        return advanced.map((contact) => {
          const track = detected.get(contact.id);
          if (!track?.painted || contact.detectedAtSeconds !== undefined)
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
    (contactId: string | null) => {
      if (!settingsRef.current.transmitting) {
        setSelectedId(null);
        return;
      }
      if (!contactId) {
        setSelectedId(null);
        return;
      }
      setSelectedId(contactId);
      recordAction(contactId, "DESIGNATE");
      setContacts((current) =>
        current.map((contact) =>
          contact.id === contactId
            ? {
                ...contact,
                designated: true,
                classification:
                  contact.classification === "UNKNOWN"
                    ? "TRACKED"
                    : contact.classification,
              }
            : contact,
        ),
      );
    },
    [recordAction],
  );

  useEffect(() => {
    if (!settings.transmitting) {
      setSelectedId(null);
      setHoverId(null);
    }
  }, [settings.transmitting]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 22 : 7;
      if (event.key === "ArrowUp")
        setCursor((current) => ({ ...current, y: current.y - step }));
      else if (event.key === "ArrowDown")
        setCursor((current) => ({ ...current, y: current.y + step }));
      else if (event.key === "ArrowLeft")
        setCursor((current) => ({ ...current, x: current.x - step }));
      else if (event.key === "ArrowRight")
        setCursor((current) => ({ ...current, x: current.x + step }));
      else if (event.key === "Enter" && hoverId && settings.transmitting)
        selectContact(hoverId);
      else if (event.key === "Escape") setSelectedId(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverId, selectContact]);

  const updateContact = (contactId: string, patch: Partial<Contact>) => {
    setContacts((current) =>
      current.map((contact) =>
        contact.id === contactId ? { ...contact, ...patch } : contact,
      ),
    );
  };

  const handleAction = (
    action: "EO_VERIFY" | "FLAG_ANOMALOUS" | "MONITOR" | "DROP",
  ) => {
    if (!selected) return;
    recordAction(selected.id, action);

    if (action === "EO_VERIFY") {
      const result = runEO(selected, scenario, scenarioSecondsRef.current);
      updateContact(selected.id, { classification: "EO_ID", eoResult: result });
      return;
    }

    if (action === "FLAG_ANOMALOUS") {
      updateContact(selected.id, {
        classification: "ANOMALOUS",
        flaggedAtSeconds: scenarioSecondsRef.current,
      });
      return;
    }

    if (action === "MONITOR") {
      updateContact(selected.id, {
        classification:
          selected.classification === "UNKNOWN"
            ? "TRACKED"
            : selected.classification,
      });
      return;
    }

    updateContact(selected.id, { dropped: true });
    setSelectedId(null);
  };

  return (
    <div
      className="min-h-screen w-full bg-[#020604] text-[#7fffae]"
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      }}
    >
      <TopBar
        scenarioId={scenario.id}
        scenarioTitle={scenario.title}
        contacts={contacts}
        settings={settings}
        ownHeadingDeg={ownHeadingDeg}
        sweepDeg={sweepDeg}
        onNewScenario={newScenario}
      />
      <div className="flex h-[calc(100vh-44px)] min-h-[620px] w-full">
        {leftPanelOpen ? (
          <LeftRail
            scenario={displayScenario}
            contacts={contacts}
            settings={settings}
            selectedId={selectedId}
            onCollapse={() => setLeftPanelOpen(false)}
          />
        ) : (
          <button
            onClick={() => setLeftPanelOpen(true)}
            className="flex w-7 items-center justify-center border-r border-[#39413a] bg-[#080d0b] text-[10px] tracking-widest text-[#7fffae] hover:bg-[#0d1712]"
            title="Show left panel"
          >
            &gt;
          </button>
        )}
        <main
          ref={wrapRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,#041208_0%,#010402_70%,#000_100%)]"
        >
          <RadarScope
            scenario={displayScenario}
            contacts={contacts}
            tracks={tracks}
            settings={settings}
            sweepDeg={sweepDeg}
            selectedId={selectedId}
            hoverId={hoverId}
            cursor={cursor}
            size={size}
            onCursor={setCursor}
            onHover={setHoverId}
            onSelect={selectContact}
          />
          {selected && (
            <TrackPanel
              contact={selected}
              track={tracks.get(selected.id)}
              onAction={handleAction}
              onClose={() => setSelectedId(null)}
            />
          )}
          <Controls
            settings={settings}
            setSettings={setSettings}
            ownHeadingDeg={ownHeadingDeg}
            setOwnHeadingDeg={setOwnHeadingDeg}
            cursor={cursor}
            rangeNm={settings.rangeNm}
            radius={size / 2 - 34}
          />
        </main>
      </div>
    </div>
  );
}

function TopBar({
  scenarioId,
  scenarioTitle,
  contacts,
  settings,
  ownHeadingDeg,
  sweepDeg,
  onNewScenario,
}: {
  scenarioId: string;
  scenarioTitle: string;
  contacts: Contact[];
  settings: RadarSettings;
  ownHeadingDeg: number;
  sweepDeg: number;
  onNewScenario: () => void;
}) {
  const [clock, setClock] = useState("------Z");
  useEffect(() => {
    const id = window.setInterval(() => setClock(zulu(true)), 1000);
    setClock(zulu(true));
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="flex h-11 items-center gap-5 border-b border-[#39413a] bg-[#101412] px-4 text-[11px] tracking-widest text-[#d8e978]">
      <span className="text-[#7fffae]">
        ALH COPILOT TRAINER // SURFACE SEARCH
      </span>
      <Stat k="ID" v={scenarioId.replace("SCN-", "")} />
      <Stat k="SCN" v={scenarioTitle.toUpperCase()} />
      <Stat k="AIS" v={settings.transmitting ? "ON" : "OFF"} />
      <Stat k="MODE" v={settings.mode.replace("_", " ")} />
      <Stat k="HDG" v={`${formatHeading(ownHeadingDeg)} DEG`} />
      <Stat k="RNG" v={`${settings.rangeNm}NM`} />
      <Stat k="SECTOR" v={`${settings.sectorWidthDeg} DEG`} />
      <Stat k="SWP" v={`${padBearing(sweepDeg)} DEG`} />
      <Stat
        k="CONT"
        v={String(contacts.filter((c) => !c.dropped).length).padStart(2, "0")}
      />
      <button
        onClick={onNewScenario}
        className="ml-auto border border-[#1f6b3a] px-2 py-0.5 text-[#7fffae] hover:bg-[#04200f]"
      >
        [ NEW SCENARIO ]
      </button>
      <span className="text-[#7fffae]">UTC {clock}</span>
    </header>
  );
}

function LeftRail({
  scenario,
  contacts,
  settings,
  selectedId,
  onCollapse,
}: {
  scenario: Scenario;
  contacts: Contact[];
  settings: RadarSettings;
  selectedId: string | null;
  onCollapse: () => void;
}) {
  const live = contacts.filter((contact) => !contact.dropped);
  const ais = live.filter((contact) => contact.aisActive).length;
  const silentPrimary = live.filter((contact) => !contact.aisActive).length;
  const suspectMotion = live.filter(
    (contact) => contact.motionAnalysis.riskLevel === "SUSPECT",
  ).length;
  const anomalous = live.filter(
    (contact) => contact.classification === "ANOMALOUS",
  ).length;

  return (
    <aside className="flex w-56 flex-col gap-3 border-r border-[#39413a] bg-[#080d0b] p-3 text-[10px] text-[#d8e978]">
      <div className="flex items-center justify-between border-b border-[#1b2c22] pb-1 tracking-widest text-[#7fffae]">
        <span>INFO</span>
        <button
          onClick={onCollapse}
          className="border border-[#1f6b3a] px-1 text-[#7fffae] hover:bg-[#04200f]"
          title="Hide left panel"
        >
          &lt;
        </button>
      </div>
      <Section title="OBJECTIVE">
        <p className="leading-relaxed text-[#7fffae]">{scenario.objective}</p>
      </Section>
      <Section title="OWN SHIP">
        <Row k="LAT" v={scenario.ownShip.lat} />
        <Row k="LON" v={scenario.ownShip.lon} />
        <Row k="HDG" v={`${formatHeading(scenario.ownShip.headingDeg)} DEG`} />
        <Row k="SPD" v={`${scenario.ownShip.speedKts} KT`} />
        <Row k="ALT" v={`${scenario.ownShip.altitudeFt} FT`} />
      </Section>
      <Section title="SENSORS">
        <Row k="RDR" v="ON" ok />
        <Row k="AIS" v={settings.transmitting ? "ON" : "OFF"} ok={settings.transmitting} warn={!settings.transmitting} />
        <Row k="EO/IR" v="STBY" />
        <Row k="IFF" v="MK XII" />
      </Section>
      <Section title="ENVIRONMENT">
        <Row k="WX" v={scenario.weather} />
        <Row k="SEA" v={`STATE ${scenario.seaState}`} />
        <Row k="MODE" v={settings.mode} />
      </Section>
      <Section title="PICTURE">
        <Row k="CONT" v={String(live.length).padStart(2, "0")} />
        <Row k="AIS" v={String(ais).padStart(2, "0")} />
        <Row k="NO AIS" v={String(silentPrimary).padStart(2, "0")} warn={silentPrimary > 0} />
        <Row k="MOTION" v={String(suspectMotion).padStart(2, "0")} warn={suspectMotion > 0} />
        <Row
          k="ANOM"
          v={String(anomalous).padStart(2, "0")}
          warn={anomalous > 0}
        />
      </Section>
      <Section title="DESIG">
        <span className={selectedId ? "text-[#7fffae]" : "text-[#2f7a4e]"}>
          {selectedId ? `TRK ${selectedId}` : "----"}
        </span>
      </Section>
      <div className="mt-auto leading-relaxed text-[#2f7a4e]">
        PUBLIC-SOURCE PROCEDURAL TRAINER
        <br />
        TRACKBALL: MOUSE / ARROWS
        <br />
        SELECT: CLICK / ENTER
        <br />
        DESEL: ESC
      </div>
    </aside>
  );
}

function TrackPanel({
  contact,
  track,
  onAction,
  onClose,
}: {
  contact: Contact;
  track?: SensorTrack;
  onAction: (
    action: "EO_VERIFY" | "FLAG_ANOMALOUS" | "MONITOR" | "DROP",
  ) => void;
  onClose: () => void;
}) {
  const br = bearingRangeFromPoint(contact.position);
  return (
    <div className="absolute right-4 top-4 w-72 border border-[#1f6b3a] bg-[rgba(2,16,8,0.96)] text-[10px] tracking-wider text-[#7fffae] shadow-[0_0_24px_rgba(127,255,174,0.08)]">
      <div className="flex items-center justify-between border-b border-[#0e3a20] bg-[#04200f] px-2 py-1">
        <span>TRACK {contact.id}</span>
        <button
          onClick={onClose}
          className="text-[#2f7a4e] hover:text-[#7fffae]"
        >
          X
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-2 py-2">
        <Data k="BRG" v={padBearing(br.bearingDeg)} />
        <Data k="RNG" v={`${br.rangeNm.toFixed(1)}NM`} />
        <Data k="SPD" v={`${Math.round(contact.speedKts)}KT`} />
        <Data k="HDG" v={padBearing(contact.headingDeg)} />
        <Data
          k="AIS"
          v={contact.aisActive ? "CURRENT" : "NONE/STALE"}
          warn={!contact.aisActive}
        />
        <Data k="REP" v={contact.aisReportedKind ?? "---"} />
        <Data
          k="RISK"
          v={`${contact.motionAnalysis.riskLevel} ${contact.motionAnalysis.riskScore}`}
          warn={contact.motionAnalysis.riskLevel !== "LOW"}
        />
        <Data
          k="HDG Δ"
          v={`${contact.motionAnalysis.headingChangeDeg.toFixed(1)} DEG`}
          warn={contact.motionAnalysis.headingChangeDeg > 1.2}
        />
        <Data k="CLS" v={contact.classification} />
        <Data
          k="RDR"
          v={`${Math.round((track?.strength ?? 0) * 100)}%`}
          warn={track?.cluttered}
        />
      </div>
      {contact.aisMetadata && (
        <div className="border-t border-[#0e3a20] px-2 py-2">
          <div className="mb-1 text-[#2f7a4e]">AIS DATA</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <Data k="MMSI" v={contact.aisMetadata.mmsi} />
            <Data k="NAME" v={contact.aisMetadata.vesselName} />
            <Data k="FLAG" v={contact.aisMetadata.nationality} />
            <Data k="REG" v={contact.aisMetadata.registryCountry} />
            <Data k="LAST" v={contact.aisMetadata.lastPort} />
            <Data k="NEXT" v={contact.aisMetadata.nextPort} />
            <Data k="CARGO" v={contact.aisMetadata.cargo} />
            <Data
              k="DIM"
              v={`${contact.aisMetadata.lengthM}x${contact.aisMetadata.beamM}M`}
            />
          </div>
        </div>
      )}
      <div className="border-t border-[#0e3a20] px-2 py-2">
        <div className="mb-1 text-[#2f7a4e]">MOTION / AIS ANALYSIS</div>
        {contact.motionAnalysis.reasons.map((item) => (
          <div key={item} className="leading-relaxed">
            - {item}
          </div>
        ))}
        {contact.eoResult && (
          <div className="mt-2 border-t border-[#0e3a20] pt-2">
            <div className="text-[#2f7a4e]">EO RESULT</div>
            <div>{contact.eoResult.summary}</div>
            {contact.eoResult.evidence.map((item) => (
              <div key={item}>- {item}</div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 px-2 pb-2">
        <OpButton onClick={() => onAction("MONITOR")}>[ MONITOR ]</OpButton>
        <OpButton onClick={() => onAction("EO_VERIFY")}>
          [ REQUEST EO ID ]
        </OpButton>
        <OpButton onClick={() => onAction("FLAG_ANOMALOUS")} warn>
          [ FLAG ANOMALOUS ]
        </OpButton>
        <OpButton onClick={() => onAction("DROP")} danger>
          [ DROP TRACK ]
        </OpButton>
      </div>
    </div>
  );
}

function Controls({
  settings,
  setSettings,
  ownHeadingDeg,
  setOwnHeadingDeg,
  cursor,
  rangeNm,
  radius,
}: {
  settings: RadarSettings;
  setSettings: Dispatch<SetStateAction<RadarSettings>>;
  ownHeadingDeg: number;
  setOwnHeadingDeg: Dispatch<SetStateAction<number>>;
  cursor: { x: number; y: number };
  rangeNm: number;
  radius: number;
}) {
  const br = screenToBearingRange(cursor.x, cursor.y, rangeNm, radius);
  const patch = (next: Partial<RadarSettings>) =>
    setSettings((current) => ({ ...current, ...next }));

  return (
    <div className="absolute bottom-2 left-2 right-2 border-t border-[#0e3a20] bg-[rgba(2,16,8,0.78)] px-2 py-2 text-[10px] tracking-wider text-[#5fcf8a]">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          <span className="text-[#2f7a4e]">TRKBALL </span>B
          {padBearing(br.bearingDeg)} R{br.rangeNm.toFixed(1)}NM
        </span>
        <button
          onClick={() => patch({ transmitting: !settings.transmitting })}
          className={`border px-2 py-0.5 ${
            settings.transmitting
              ? "border-[#7fffae] text-[#7fffae]"
              : "border-[#ffb347] text-[#ffb347]"
          }`}
        >
          AIS {settings.transmitting ? "ON" : "OFF"}
        </button>
        <SelectNumber
          label="RNG"
          value={settings.rangeNm}
          options={[5, 10, 20, 40, 80, 120]}
          onChange={(range) => patch({ rangeNm: range })}
        />
        <SelectNumber
          label="SECTOR"
          value={settings.sectorWidthDeg}
          options={[60, 120, 180, 270, 360]}
          onChange={(sectorWidthDeg) => patch({ sectorWidthDeg })}
        />
        <HeadingInput value={ownHeadingDeg} onChange={setOwnHeadingDeg} />
        <select
          value={settings.mode}
          onChange={(event) =>
            patch({ mode: event.target.value as RadarSettings["mode"] })
          }
          className="bg-[#02100a] text-[#7fffae]"
        >
          <option value="SURFACE_SEARCH">SURF</option>
          <option value="MTI">MTI</option>
          <option value="WEATHER">WX</option>
        </select>
        <button
          onClick={() => patch({ ftc: !settings.ftc })}
          className="border border-[#1f6b3a] px-1 text-[#7fffae]"
        >
          FTC {settings.ftc ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1 tracking-widest text-[#2f7a4e]">{title}</div>
      <div className="flex flex-col gap-0.5 pl-1">{children}</div>
    </section>
  );
}

function Row({
  k,
  v,
  ok,
  warn,
}: {
  k: string;
  v: string;
  ok?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[#2f7a4e]">{k}</span>
      <span
        className={
          warn ? "text-[#ffb347]" : ok ? "text-[#7fffae]" : "text-[#d8e978]"
        }
      >
        {v}
      </span>
    </div>
  );
}

function Data({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return <Row k={k} v={v} warn={warn} />;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span className="text-[#2f7a4e]">{k} </span>
      {v}
    </span>
  );
}

function OpButton({
  children,
  onClick,
  warn,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="border border-[#0e3a20] px-1 py-0.5 text-left hover:bg-[#04200f]"
      style={{ color: danger ? "#ff7a6b" : warn ? "#ffb347" : "#7fffae" }}
    >
      {children}
    </button>
  );
}

function HeadingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[#2f7a4e]">
      HEADING
      <input
        type="number"
        step={1}
        value={Math.round(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          if (next < 0) {
            onChange(360);
            return;
          }
          if (next > 360) {
            onChange(((next % 360) + 360) % 360);
            return;
          }
          onChange(next);
        }}
        className="w-16 border border-[#0e3a20] bg-[#02100a] px-1 text-[#7fffae]"
      />
      <span className="text-[#7fffae]">DEG</span>
    </label>
  );
}

function SelectNumber({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[#2f7a4e]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="bg-[#02100a] text-[#7fffae]"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function zulu(withSeconds = false) {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return withSeconds ? `${hh}${mm}${ss}Z` : `${hh}${mm}Z`;
}

function formatHeading(value: number) {
  const rounded = Math.round(value);
  return rounded === 360 ? "360" : padBearing(rounded);
}

export default RadarConsole;
