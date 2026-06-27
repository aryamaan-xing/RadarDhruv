import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { RadarScope } from "./RadarScope";
import { assessContacts } from "@/sim/assessmentEngine";
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
  AssessmentSummary,
  Contact,
  RadarSettings,
  Scenario,
  SensorTrack,
  TraineeAction,
} from "@/sim/types";

const TIME_SCALE = 180;
const DEFAULT_SIZE = 720;

interface LogEntry {
  t: string;
  msg: string;
}

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
  const [settings, setSettings] = useState<RadarSettings>(
    DEFAULT_RADAR_SETTINGS,
  );
  const [tracks, setTracks] = useState<Map<string, SensorTrack>>(new Map());
  const [sweepDeg, setSweepDeg] = useState(0);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actions, setActions] = useState<TraineeAction[]>([]);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([
    { t: "0000Z", msg: "TRAINER READY  PUBLIC-SOURCE PROCEDURAL MODEL" },
    { t: "0000Z", msg: "SURFACE SEARCH  270 DEG SECTOR  80NM" },
  ]);

  const assessment = useMemo(
    () => assessContacts(contacts, actions),
    [contacts, actions],
  );
  const selected =
    contacts.find((contact) => contact.id === selectedId) ?? null;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  const appendLog = useCallback((msg: string) => {
    setLog((current) => [...current.slice(-48), { t: zulu(), msg }]);
  }, []);

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
    setDebriefOpen(false);
    appendLog(
      `NEW ${next.id}  ${next.weather}  SEA ${next.seaState}  ${next.contacts.length} CONTACTS`,
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
      appendLog(`TRACK ${contactId} DESIGNATED`);
    },
    [appendLog, recordAction],
  );

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
      else if (event.key === "Enter" && hoverId) selectContact(hoverId);
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
      appendLog(`EO SLEW REQUEST  ${selected.id}`);
      const result = runEO(selected, scenario, scenarioSecondsRef.current);
      updateContact(selected.id, { classification: "EO_ID", eoResult: result });
      appendLog(
        `${selected.id} EO ${result.status}  CONF ${(result.confidence * 100).toFixed(0)}%`,
      );
      return;
    }

    if (action === "FLAG_ANOMALOUS") {
      updateContact(selected.id, {
        classification: "ANOMALOUS",
        flaggedAtSeconds: scenarioSecondsRef.current,
      });
      appendLog(`${selected.id} FLAGGED ANOMALOUS`);
      return;
    }

    if (action === "MONITOR") {
      updateContact(selected.id, {
        classification:
          selected.classification === "UNKNOWN"
            ? "TRACKED"
            : selected.classification,
      });
      appendLog(`${selected.id} RETAINED FOR MONITORING`);
      return;
    }

    updateContact(selected.id, { dropped: true });
    setSelectedId(null);
    appendLog(`${selected.id} TRACK DROPPED BY TRAINEE`);
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
        sweepDeg={sweepDeg}
        onNewScenario={newScenario}
      />
      <div className="flex h-[calc(100vh-44px)] min-h-[620px] w-full">
        <LeftRail
          scenario={scenario}
          contacts={contacts}
          settings={settings}
          assessment={assessment}
          selectedId={selectedId}
        />
        <main
          ref={wrapRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,#041208_0%,#010402_70%,#000_100%)]"
        >
          <RadarScope
            scenario={scenario}
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
            cursor={cursor}
            rangeNm={settings.rangeNm}
            radius={size / 2 - 34}
            onDebrief={() => setDebriefOpen(true)}
          />
          {debriefOpen && (
            <Debrief
              assessment={assessment}
              contacts={contacts}
              onClose={() => setDebriefOpen(false)}
            />
          )}
        </main>
        <LogPane log={log} />
      </div>
    </div>
  );
}

function TopBar({
  scenarioId,
  scenarioTitle,
  contacts,
  settings,
  sweepDeg,
  onNewScenario,
}: {
  scenarioId: string;
  scenarioTitle: string;
  contacts: Contact[];
  settings: RadarSettings;
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
    <header className="flex h-11 items-center gap-5 border-b border-[#0a2814] bg-[#03110a] px-4 text-[11px] tracking-widest text-[#5fcf8a]">
      <span className="text-[#7fffae]">
        ALH COPILOT TRAINER // SURFACE SEARCH
      </span>
      <Stat k="ID" v={scenarioId.replace("SCN-", "")} />
      <Stat k="SCN" v={scenarioTitle.toUpperCase()} />
      <Stat k="MODE" v={settings.mode.replace("_", " ")} />
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
  assessment,
  selectedId,
}: {
  scenario: Scenario;
  contacts: Contact[];
  settings: RadarSettings;
  assessment: AssessmentSummary;
  selectedId: string | null;
}) {
  const live = contacts.filter((contact) => !contact.dropped);
  const ais = live.filter((contact) => contact.aisActive).length;
  const anomalous = live.filter(
    (contact) => contact.classification === "ANOMALOUS",
  ).length;

  return (
    <aside className="flex w-56 flex-col gap-3 border-r border-[#0a2814] bg-[#02100a] p-3 text-[10px] text-[#5fcf8a]">
      <Section title="OBJECTIVE">
        <p className="leading-relaxed text-[#7fffae]">{scenario.objective}</p>
      </Section>
      <Section title="OWN SHIP">
        <Row k="LAT" v={scenario.ownShip.lat} />
        <Row k="LON" v={scenario.ownShip.lon} />
        <Row k="HDG" v={`${scenario.ownShip.headingDeg} DEG`} />
        <Row k="SPD" v={`${scenario.ownShip.speedKts} KT`} />
        <Row k="ALT" v={`${scenario.ownShip.altitudeFt} FT`} />
      </Section>
      <Section title="SENSORS">
        <Row k="RDR" v="ON" ok />
        <Row k="AIS" v="RX" ok />
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
        <Row k="DARK" v={String(live.length - ais).padStart(2, "0")} />
        <Row
          k="ANOM"
          v={String(anomalous).padStart(2, "0")}
          warn={anomalous > 0}
        />
      </Section>
      <Section title="ASSESSMENT">
        <Row k="DETECT" v={String(assessment.detected).padStart(2, "0")} />
        <Row
          k="CORRECT"
          v={String(assessment.flaggedCorrectly).padStart(2, "0")}
          ok
        />
        <Row
          k="FALSE"
          v={String(assessment.falsePositives).padStart(2, "0")}
          warn={assessment.falsePositives > 0}
        />
        <Row
          k="MISSED"
          v={String(assessment.missedSuspicious).padStart(2, "0")}
          warn={assessment.missedSuspicious > 0}
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
        <Data k="CLS" v={contact.classification} />
        <Data
          k="RDR"
          v={`${Math.round((track?.strength ?? 0) * 100)}%`}
          warn={track?.cluttered}
        />
      </div>
      <div className="border-t border-[#0e3a20] px-2 py-2">
        <div className="mb-1 text-[#2f7a4e]">OBSERVABLE EVIDENCE</div>
        {contact.evidence.map((item) => (
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
  cursor,
  rangeNm,
  radius,
  onDebrief,
}: {
  settings: RadarSettings;
  setSettings: Dispatch<SetStateAction<RadarSettings>>;
  cursor: { x: number; y: number };
  rangeNm: number;
  radius: number;
  onDebrief: () => void;
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
        <SelectNumber
          label="CENTER"
          value={settings.sectorCenterDeg}
          options={[0, 45, 90, 135, 180, 225, 270, 315]}
          onChange={(sectorCenterDeg) => patch({ sectorCenterDeg })}
        />
        <Slider
          label="GAIN"
          value={settings.gain}
          onChange={(gain) => patch({ gain })}
        />
        <Slider
          label="SEA"
          value={settings.seaClutter}
          onChange={(seaClutter) => patch({ seaClutter })}
        />
        <Slider
          label="RAIN"
          value={settings.rainClutter}
          onChange={(rainClutter) => patch({ rainClutter })}
        />
        <Slider
          label="STC"
          value={settings.stc}
          onChange={(stc) => patch({ stc })}
        />
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
        <button
          onClick={onDebrief}
          className="ml-auto border border-[#1f6b3a] px-2 text-[#ffb347]"
        >
          [ DEBRIEF ]
        </button>
      </div>
    </div>
  );
}

function Debrief({
  assessment,
  contacts,
  onClose,
}: {
  assessment: AssessmentSummary;
  contacts: Contact[];
  onClose: () => void;
}) {
  const notable = assessment.items
    .filter((item) => item.outcome !== "INSUFFICIENT")
    .slice(0, 10);
  return (
    <div className="absolute inset-8 overflow-auto border border-[#1f6b3a] bg-[rgba(1,8,4,0.97)] p-4 text-[11px] text-[#7fffae]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm tracking-widest">TRAINING DEBRIEF</h2>
        <button onClick={onClose} className="border border-[#1f6b3a] px-2">
          CLOSE
        </button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        <Metric k="DETECTED" v={assessment.detected} />
        <Metric k="CORRECT FLAGS" v={assessment.flaggedCorrectly} />
        <Metric k="FALSE POS" v={assessment.falsePositives} />
        <Metric k="MISSED" v={assessment.missedSuspicious} />
        <Metric
          k="LIVE CONTACTS"
          v={contacts.filter((contact) => !contact.dropped).length}
        />
      </div>
      <div className="mt-4 text-[#2f7a4e]">EVIDENCE REVIEW</div>
      <div className="mt-2 grid gap-2">
        {notable.map((item) => (
          <div key={item.contactId} className="border border-[#0e3a20] p-2">
            <div className="mb-1 text-[#ffb347]">
              {item.contactId} // {item.outcome} // TRAINEE{" "}
              {item.traineeDecision} // TRUTH {item.groundTruth}
            </div>
            {item.rationale.map((line) => (
              <div key={line}>- {line}</div>
            ))}
          </div>
        ))}
        {notable.length === 0 && (
          <div>
            No decisive training events yet. Continue the sortie and flag
            contacts only when evidence supports escalation.
          </div>
        )}
      </div>
    </div>
  );
}

function LogPane({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <aside className="flex w-72 flex-col border-l border-[#0a2814] bg-[#02100a] p-3 text-[10px] text-[#5fcf8a]">
      <div className="mb-2 tracking-widest text-[#2f7a4e]">OPS LOG</div>
      <div ref={ref} className="flex-1 overflow-auto leading-relaxed">
        {log.map((entry, i) => (
          <div key={`${entry.t}-${i}`}>
            <span className="text-[#2f7a4e]">{entry.t} </span>
            {entry.msg}
          </div>
        ))}
      </div>
    </aside>
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
          warn ? "text-[#ffb347]" : ok ? "text-[#7fffae]" : "text-[#5fcf8a]"
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

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[#2f7a4e]">
      {label}
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-16 accent-[#7fffae]"
      />
      <span className="w-6 text-[#7fffae]">{Math.round(value)}</span>
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

function Metric({ k, v }: { k: string; v: number }) {
  return (
    <div className="border border-[#0e3a20] p-2">
      <div className="text-[#2f7a4e]">{k}</div>
      <div className="text-lg text-[#7fffae]">{v}</div>
    </div>
  );
}

function zulu(withSeconds = false) {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return withSeconds ? `${hh}${mm}${ss}Z` : `${hh}${mm}Z`;
}

export default RadarConsole;
