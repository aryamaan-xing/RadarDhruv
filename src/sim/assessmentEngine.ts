import type {
  AssessmentItem,
  AssessmentSummary,
  Contact,
  TraineeAction,
} from "./types";

export function assessContacts(
  contacts: Contact[],
  actions: TraineeAction[],
): AssessmentSummary {
  const items: AssessmentItem[] = contacts
    .filter(
      (contact) => !contact.dropped || contact.flaggedAtSeconds !== undefined,
    )
    .map((contact) => assessContact(contact, actions));

  return {
    detected: contacts.filter(
      (contact) => contact.detectedAtSeconds !== undefined,
    ).length,
    flaggedCorrectly: items.filter((item) => item.outcome === "CORRECT").length,
    falsePositives: items.filter((item) => item.outcome === "FALSE_POSITIVE")
      .length,
    missedSuspicious: items.filter((item) => item.outcome === "MISSED_THREAT")
      .length,
    unnecessaryDrops: items.filter(
      (item) =>
        item.traineeDecision === "DROPPED" && item.groundTruth === "SUSPICIOUS",
    ).length,
    items,
  };
}

function assessContact(
  contact: Contact,
  actions: TraineeAction[],
): AssessmentItem {
  const contactActions = actions.filter(
    (action) => action.contactId === contact.id,
  );
  const flagged = contactActions.some(
    (action) => action.action === "FLAG_ANOMALOUS",
  );
  const monitored = contactActions.some(
    (action) => action.action === "MONITOR" || action.action === "EO_VERIFY",
  );
  const dropped = contactActions.some((action) => action.action === "DROP");
  const traineeDecision = flagged
    ? "FLAGGED"
    : dropped
      ? "DROPPED"
      : monitored
        ? "MONITORED"
        : "MISSED";

  if (flagged && contact.groundTruth === "SUSPICIOUS") {
    return {
      contactId: contact.id,
      groundTruth: contact.groundTruth,
      traineeDecision,
      outcome: "CORRECT",
      rationale: ["Correctly flagged anomalous behavior.", ...contact.evidence],
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
        ...contact.evidence,
      ],
    };
  }

  if (!flagged && contact.groundTruth === "SUSPICIOUS") {
    return {
      contactId: contact.id,
      groundTruth: contact.groundTruth,
      traineeDecision,
      outcome: "MISSED_THREAT",
      rationale: ["Suspicious behavior was not flagged.", ...contact.evidence],
    };
  }

  return {
    contactId: contact.id,
    groundTruth: contact.groundTruth,
    traineeDecision,
    outcome:
      monitored || contact.detectedAtSeconds !== undefined
        ? "INSUFFICIENT"
        : "INSUFFICIENT",
    rationale: [
      "Routine contact; continued monitoring is acceptable.",
      ...contact.evidence,
    ],
  };
}
