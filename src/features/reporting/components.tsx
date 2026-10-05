import Link from 'next/link';
import { duration, topRows, type Report } from './model';

export function ReportUnavailable() {
  return <div className="alert alert-error" role="alert"><strong>Reporting is temporarily unavailable.</strong><p>Your tickets are still available. Refresh this page to try again.</p><Link className="button button-secondary" href="/app/tickets">Open ticket queue</Link></div>;
}
export function TodayMetrics({ report, title = "Tickets today" }: { report: Report | null; title?: string }) {
  const s = report?.summary;
  const metrics = [
    {label:'Created',value:s?.created ?? '—',hint:'Tickets opened today'},
    {label:'Resolved',value:s?.resolved ?? '—',hint:'Tickets resolved today, including any since reopened'},
    {label:'Open',value:s?.open ?? '—',hint:'All unresolved tickets right now'},
    {label:'Overdue',value:s?.overdue ?? '—',hint:'Open tickets with a breached response or resolution SLA'},
    {label:'Avg response',value:s ? duration(s.response) : '—',hint:'First public IT replies sent today'},
    {label:'Avg resolution',value:s ? duration(s.resolution) : '—',hint:'Latest resolutions recorded today'},
  ];
  return <section aria-labelledby="tickets-today" aria-busy={!report}><div className="tech-section-heading"><div><h2 id="tickets-today">{title}</h2><p>{report ? `${report.today} · British Virgin Islands time` : <span role="status">Loading today’s metrics…</span>}</p></div>{report && <span className="muted">Updated {new Intl.DateTimeFormat('en', {timeZone:report.timezone,hour:'numeric',minute:'2-digit'}).format(new Date(report.asOf))}</span>}</div><dl className="report-metrics">{metrics.map(m=><div className="settings-card" key={m.label}><dt>{m.label}</dt><dd><span>{m.value}</span><p>{m.hint}</p></dd></div>)}</dl></section>;
}

type Series = { label: string; values: (number | null)[] };
export function Trend({ title, description, days, series, time = false }: {title:string;description:string;days:string[];series:Series[];time?:boolean}) {
  const all = series.flatMap(s=>s.values).filter((v):v is number=>v!==null);
  const max = Math.max(1,...all);
  const hasActivity = all.some(v=>v>0) || (time && all.length>0);
  return <section className="settings-card report-chart"><h3>{title}</h3><p>{description}</p>{hasActivity ? <><ul className="report-legend">{series.map((s,i)=><li key={s.label}><span aria-hidden="true" className={`report-line-key report-series-${i}`} />{s.label}</li>)}</ul><svg viewBox="0 0 600 150" role="img" aria-label={`${title} over ${days.length} days. Exact values are available in the data table below.`}><line x1="8" x2="592" y1="140" y2="140" className="report-axis" />{series.map((s,i)=><g key={s.label} className={`report-series-${i}`}>{s.values.map((v,j)=>v===null?null:<g key={j}>{j>0 && s.values[j-1]!==null && <line x1={8+(j-1)*584/Math.max(1,days.length-1)} y1={140-(s.values[j-1] as number)/max*130} x2={8+j*584/Math.max(1,days.length-1)} y2={140-v/max*130}/>}<circle cx={8+j*584/Math.max(1,days.length-1)} cy={140-v/max*130} r="2.5"/></g>)}</g>)}</svg><div className="report-axis-labels"><span>{days[0]}</span><span>{time?duration(max):max} max</span><span>{days.at(-1)}</span></div></> : <div className="report-empty">{time?'No completed timing samples in this period.':'No activity in this period.'}</div>}<details><summary>View data for {title.toLowerCase()} · {days.length} days</summary><div className="table-region report-data-region" role="region" aria-label={`${title} data`} tabIndex={0}><table className="table table-policy"><caption>{title} · daily values</caption><thead><tr><th scope="col">Date</th>{series.map(s=><th scope="col" key={s.label}>{s.label}{time?' (elapsed time)':''}</th>)}</tr></thead><tbody>{days.map((day,i)=><tr key={day}><th scope="row">{day}</th>{series.map(s=><td key={s.label}>{time?duration(s.values[i]):s.values[i]??'No data'}</td>)}</tr>)}</tbody></table></div></details></section>;
}
export function Bars({title,description,rows,percent=false,allRows=false}:{title:string;description:string;rows:{label:string;value:number;detail?:string}[];percent?:boolean;allRows?:boolean}) {
  const shown: {label:string;value:number;detail?:string}[] = percent || allRows ? rows : topRows(rows);
  const max = percent ? 100 : Math.max(1,...shown.map(row=>row.value));
  return <section className="settings-card report-chart"><h3>{title}</h3><p>{description}</p>{shown.length ? <ul className="report-bars">{shown.map((row,i)=><li key={`${row.label}-${i}`}><div><span>{row.label}</span><strong>{percent?`${row.value.toFixed(1)}%`:row.value}</strong></div><span className="report-bar-track" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,row.value/max*100))}%`}} /></span>{'detail' in row && <small>{row.detail}</small>}</li>)}</ul> : <div className="report-empty">{percent?'No completed SLA targets to measure.':'No tickets to show.'}</div>}</section>;
}
export function ServiceLevels({ report, canViewTargets = false }: { report: Report; canViewTargets?: boolean }) {
  const samples = report.sla.filter(target => target.total > 0);
  return <section className="settings-card report-service-levels" aria-labelledby="report-sla-title">
    <header className="overview-section-heading">
      <div><h2 id="report-sla-title">Service levels</h2><p>Are tickets getting a response and resolution on time?</p></div>
      {canViewTargets && <Link className="button button-secondary" href="/app/administration/slas">View SLA targets</Link>}
    </header>
    <div className="report-sla-grid">
      <div>
        <h3>On-time completion <span className="muted">· Last 30 days</span></h3>
        {samples.length ? <ul className="report-bars">{samples.map(target => <li key={target.label}>
          <div><span>{target.label}</span><strong>{(target.met / target.total * 100).toFixed(1)}%</strong></div>
          <span className="report-bar-track" aria-hidden="true"><span style={{ width: `${target.met / target.total * 100}%` }}/></span>
          <small>{target.met} of {target.total} completed targets met on time</small>
        </li>)}</ul> : <div className="report-empty"><strong>No completed targets yet</strong><p>Compliance appears after tickets receive a first response or are resolved. No samples does not mean 0% compliance.</p></div>}
        <p className="report-footnote">Only completed targets with a recorded deadline are measured. Pending targets are excluded. SLAs use calendar hours, including weekends.</p>
      </div>
      <div className="report-sla-current">
        <h3>Needs attention <span className="muted">· Right now</span></h3>
        <p className="report-sla-count"><strong>{report.summary.overdue}</strong><span>{report.summary.overdue === 1 ? 'open ticket past an SLA deadline' : 'open tickets past an SLA deadline'}</span></p>
        <p className="muted">{report.summary.overdue ? 'Review overdue responses and resolutions in the ticket queue.' : 'No open tickets are past their response or resolution deadline.'}</p>
        <Link className="button button-secondary" href="/app/tickets?view=all&sla=breached&sort=sla">Review breached tickets</Link>
      </div>
    </div>
  </section>;
}

export function ReportCharts({report}:{report:Report}) {
  const days = report.daily.map(d=>d.day);
  const breakdown=(kind:string)=>report.breakdowns.filter(row=>row.kind===kind);
  return <>
    <section className="report-section" aria-labelledby="report-trends-title">
      <header className="overview-section-heading"><div><h2 id="report-trends-title">Activity & turnaround</h2><p>Last 30 days · Includes today. Timing measures elapsed calendar hours.</p></div></header>
      <div className="report-chart-grid">
        <Trend title="Ticket volume" description="Tickets created and resolved each day." days={days} series={[{label:'Created',values:report.daily.map(d=>d.created)},{label:'Resolved',values:report.daily.map(d=>d.resolved)}]}/>
        <Trend title="Reopened tickets" description="Distinct tickets returned to an active status each day." days={days} series={[{label:'Reopened',values:report.daily.map(d=>d.reopened)}]}/>
        <Trend title="Response time" description="Average time to the first public IT reply, by reply day." days={days} series={[{label:'Average response',values:report.daily.map(d=>d.response)}]} time/>
        <Trend title="Resolution time" description="Average time to latest resolution, by resolution day. Reopened tickets are excluded until resolved again." days={days} series={[{label:'Average resolution',values:report.daily.map(d=>d.resolution)}]} time/>
      </div>
    </section>
    <section className="report-section" aria-labelledby="report-workload-title">
      <header className="overview-section-heading"><div><h2 id="report-workload-title">Current workload</h2><p>All unresolved tickets right now, regardless of when they were created.</p></div><Link className="button button-secondary" href="/app/tickets?view=unassigned">Review unassigned tickets</Link></header>
      <div className="report-chart-grid">
        <Bars title="Technician workload" description="Open tickets by technician, including unassigned work." rows={breakdown('workload')}/>
        <Bars title="Backlog age" description="Time since creation, including tickets waiting on a reply." rows={breakdown('backlog')}/>
      </div>
    </section>
    <section className="report-section" aria-labelledby="report-breakdowns-title">
      <header className="overview-section-heading"><div><h2 id="report-breakdowns-title">Where requests come from</h2><p>Tickets created in the last 30 days.</p></div></header>
      <div className="report-chart-grid">
        <Bars title="Ticket categories" description="Grouped by current category." rows={breakdown('categories')}/>
        <Bars title="Tickets by department" description="Using the requester’s current department." rows={breakdown('departments')}/>
        <Bars title="Tickets by location" description="Using the location saved on each ticket." rows={breakdown('locations')}/>
      </div>
    </section>
  </>;
}
