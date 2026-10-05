"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { formatTicketDate } from "./presentation";
import { ticketSla, type SlaTicket, type SlaResult, type SlaState } from "./sla";

const Clock = createContext(0);
export function SlaClock({ initialNow, children }: { initialNow: number; children: ReactNode }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return <Clock value={now}>{children}</Clock>;
}
const presentation: Record<SlaState, { tone: string; icon: string }> = {
  on_track: { tone: "neutral", icon: "◷" }, warning: { tone: "warning", icon: "⚠" },
  breached: { tone: "danger", icon: "!" }, met: { tone: "success", icon: "✓" },
  missed: { tone: "danger", icon: "!" }, missing: { tone: "warning", icon: "⚠" },
  unavailable: { tone: "neutral", icon: "—" },
};
function Objective({ label, result, compact }: { label: string; result: SlaResult; compact: boolean }) {
  const style = presentation[result.state];
  return <div className={`sla-objective sla-${style.tone}`}>
    <strong>{label} SLA</strong>
    <div className="sla-label"><span aria-hidden="true">{style.icon}</span><span>{result.label}</span></div>
    {result.deadline && <time className={compact ? "sr-only" : "sla-date"} dateTime={result.deadline}>Due {formatTicketDate(result.deadline)}</time>}
    {!compact && result.completedAt && <time className="sla-date" dateTime={result.completedAt}>Completed {formatTicketDate(result.completedAt)}</time>}
  </div>;
}
export function SlaIndicator({ ticket, compact = false }: { ticket: SlaTicket; compact?: boolean }) {
  const now = useContext(Clock);
  const sla = ticketSla(ticket, now);
  return <div className={`sla-indicator ${compact ? "sla-compact" : ""}`}>
    {!compact && <span className="sr-only" role="status">Response SLA: {sla.response.state.replaceAll("_", " ")}. Resolution SLA: {sla.resolution.state.replaceAll("_", " ")}.</span>}
    <Objective label="Response" result={sla.response} compact={compact}/>
    <Objective label="Resolution" result={sla.resolution} compact={compact}/>
  </div>;
}
