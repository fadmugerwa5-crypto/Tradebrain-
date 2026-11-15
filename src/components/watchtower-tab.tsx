import { useEffect, useState } from "react";
import { clearArchivedOpportunities, isTerminal, listOpportunities, type WatchOpportunity } from "@/lib/trade/watchtower";
import { px } from "@/lib/format";

const badge: Record<string, string> = {
  MONITORING: "border-line bg-elev-2 text-muted",
  APPROACHING_TRIGGER: "border-warn/40 bg-warn/10 text-warn",
  READY_FOR_MASTER_REVIEW: "border-up/40 bg-up/10 text-up",
  EXECUTED: "border-up/40 bg-up/10 text-up",
  REJECTED: "border-down/40 bg-down/10 text-down",
  PAUSED_DATA: "border-warn/40 bg-warn/10 text-warn",
  INVALIDATED: "border-down/40 bg-down/10 text-down",
  EXPIRED: "border-line bg-elev-2 text-faint",
};
export function WatchtowerTab() {
  const [rows, setRows] = useState<WatchOpportunity[]>([]);
  const [filter, setFilter] = useState("ACTIVE");
  useEffect(() => {
    // The colony loop re-checks every saved opportunity on its own heartbeat. This screen only reads the result.
    const refresh = () => setRows(listOpportunities());
    refresh(); const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, []);
  const visible = rows.filter(o => filter === "ACTIVE" ? !isTerminal(o.status) : filter === "ARCHIVED" ? isTerminal(o.status) : o.status === filter);
  const active = rows.filter(o => !isTerminal(o.status));
  return <section className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">Opportunity Watchtower</h2><p className="text-xs text-muted">Saved setups are re-checked every 2 seconds, even when this screen is closed. A confirmed trigger sends the market back to the colony for a fresh vote.</p></div><span className="rounded-full border border-up/30 bg-up/10 px-2 py-1 text-xs text-up">{active.length} active</span></div>
    <div className="grid grid-cols-3 gap-2"><Stat label="Monitoring" value={rows.filter(o=>o.status==="MONITORING").length}/><Stat label="Near trigger" value={rows.filter(o=>o.status==="APPROACHING_TRIGGER").length}/><Stat label="Review due" value={rows.filter(o=>o.status==="READY_FOR_MASTER_REVIEW").length}/></div>
    <div className="flex gap-2 overflow-x-auto">{["ACTIVE","APPROACHING_TRIGGER","READY_FOR_MASTER_REVIEW","ARCHIVED"].map(x=><button key={x} onClick={()=>setFilter(x)} className={`shrink-0 rounded-full border px-3 py-2 text-xs ${filter===x?"border-accent bg-accent text-accent-fg":"border-line text-muted"}`}>{x.replaceAll("_"," ")}</button>)}</div>
    {visible.length===0?<div className="tb-card p-5 text-center text-sm text-muted">No saved opportunities in this view yet. Hive WAIT decisions with a clear direction and a measurable breakout level are saved here automatically.</div>:visible.map(o=><OpportunityCard key={o.id} o={o}/>)}
    {rows.some(o=>isTerminal(o.status))&&<button className="h-10 rounded-md border border-line text-xs text-muted" onClick={()=>{clearArchivedOpportunities();setRows(listOpportunities());}}>Clear archived opportunities</button>}
    <p className="text-[11px] leading-relaxed text-faint">A Watchtower status is not an order. A confirmed trigger only starts a fresh colony review (analyst vote, Risk Guard, sizing). The colony must be armed, and the review can still say wait.</p>
  </section>;
}
function Stat({label,value}:{label:string;value:number}){return <div className="tb-card p-3"><p className="text-[11px] text-muted">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>}
function OpportunityCard({o}:{o:WatchOpportunity}){return <article className="tb-card flex flex-col gap-2 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">{o.label} <span className={o.direction==="BUY"?"text-up":"text-down"}>{o.direction}</span></p><p className="text-[11px] text-faint">{o.strategy} · {o.timeframe} · {o.source}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${badge[o.status]}`}>{o.status.replaceAll("_"," ")}</span></div><div className="grid grid-cols-3 gap-2 text-xs"><Metric label="Current" value={px(o.lastPrice)}/><Metric label={o.level?"Breakout level":"Trigger"} value={px(o.trigger)}/><Metric label="Quality" value={o.quality?`${o.quality}/100`:"Pending"}/><Metric label="Invalidation" value={o.invalidation?px(o.invalidation):o.stop?px(o.stop):"Not supplied"}/><Metric label="Target" value={o.target?px(o.target):"Not supplied"}/><Metric label="Reviews" value={`${o.reviews} / 3`}/></div><p className="text-xs leading-relaxed text-muted">{o.reason}</p><div className="flex flex-wrap gap-1">{o.missing.map(m=><span key={m} className="rounded-full bg-elev-2 px-2 py-1 text-[10px] text-muted">Missing: {m}</span>)}</div><p className="text-[10px] text-faint">Updated {new Date(o.updatedAt).toLocaleString()} · expires {new Date(o.expiresAt).toLocaleString()}</p></article>}
function Metric({label,value}:{label:string;value:string}){return <div className="rounded-lg bg-elev-2 p-2"><p className="text-[10px] text-faint">{label}</p><p className="mt-1 break-all font-medium">{value}</p></div>}
