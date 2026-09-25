import Link from 'next/link';
import { duration, topRows, type Report } from './model';

export function ReportUnavailable() {
  return <div className="alert alert-error" role="alert"><strong>Reporting is temporarily unavailable.</strong><p>Your tickets are still available. Refresh this page to try again.</p><Link href="/app/tickets">Open ticket queue</Link></div>;
}
export function TodayMetrics({ report }: { report: Report }) {
  const s = report.summary;
  const metrics = [
    {label:'Created',value:s.created,hint:'Tickets opened today'},
    {label:'Resolved',value:s.resolved,hint:'Tickets resolved today, including any since reopened'},
    {label:'Open',value:s.open,hint:'All unresolved tickets right now'},
    {label:'Overdue',value:s.overdue,hint:'Open tickets with a breached response or resolution SLA'},
    {label:'Avg response',value:duration(s.response),hint:'First public IT replies sent today'},
    {label:'Avg resolution',value:duration(s.resolution),hint:'Latest resolutions recorded today'},
  ];
  return <section aria-labelledby="tickets-today"><div className="tech-section-heading"><div><h2 id="tickets-today">Tickets today</h2><p>{report.today} · British Virgin Islands time</p></div><span className="muted">Updated {new Intl.DateTimeFormat('en', {timeZone:report.timezone,hour:'numeric',minute:'2-digit'}).format(new Date(report.asOf))}</span></div><dl className="report-metrics">{metrics.map(m=><div className="settings-card" key={m.label}><dt>{m.label}</dt><dd><span>{m.value}</span><p>{m.hint}</p></dd></div>)}</dl></section>;
}

type Series = { label: string; values: (number | null)[] };
export function Trend({ title, description, days, series, time = false }: {title:string;description:string;days:string[];series:Series[];time?:boolean}) {
  const all = series.flatMap(s=>s.values).filter((v):v is number=>v!==null);
  const max = Math.max(1,...all);
  const hasActivity = all.some(v=>v>0) || (time && all.length>0);
  return <section className="settings-card report-chart"><h2>{title}</h2><p>{description}</p>{hasActivity ? <><ul className="report-legend">{series.map((s,i)=><li key={s.label}><span aria-hidden="true" className={`report-line-key report-series-${i}`} />{s.label}</li>)}</ul><svg viewBox="0 0 600 150" role="img" aria-label={`${title} over the last 30 days. Exact values are available in the data table below.`}><line x1="8" x2="592" y1="140" y2="140" className="report-axis" />{series.map((s,i)=><g key={s.label} className={`report-series-${i}`}>{s.values.map((v,j)=>v===null?null:<g key={j}>{j>0 && s.values[j-1]!==null && <line x1={8+(j-1)*584/Math.max(1,days.length-1)} y1={140-(s.values[j-1] as number)/max*130} x2={8+j*584/Math.max(1,days.length-1)} y2={140-v/max*130}/>}<circle cx={8+j*584/Math.max(1,days.length-1)} cy={140-v/max*130} r="2.5"/></g>)}</g>)}</svg><div className="report-axis-labels"><span>{days[0]}</span><span>{time?duration(max):max} max</span><span>{days.at(-1)}</span></div></> : <div className="report-empty">{time?'No completed timing samples in this period.':'No activity in this period.'}</div>}<details><summary>View data for {title.toLowerCase()}</summary><div className="table-region" role="region" aria-label={`${title} data`} tabIndex={0}><table className="table table-policy"><caption>{title} · daily values</caption><thead><tr><th scope="col">Date</th>{series.map(s=><th scope="col" key={s.label}>{s.label}{time?' (elapsed time)':''}</th>)}</tr></thead><tbody>{days.map((day,i)=><tr key={day}><th scope="row">{day}</th>{series.map(s=><td key={s.label}>{time?duration(s.values[i]):s.values[i]??'No data'}</td>)}</tr>)}</tbody></table></div></details></section>;
}
export function Bars({title,description,rows,percent=false}:{title:string;description:string;rows:{label:string;value:number;detail?:string}[];percent?:boolean}) {
  const shown: {label:string;value:number;detail?:string}[] = percent ? rows : topRows(rows);
  const max = percent ? 100 : Math.max(1,...shown.map(row=>row.value));
  return <section className="settings-card report-chart"><h2>{title}</h2><p>{description}</p>{shown.length ? <ul className="report-bars">{shown.map((row,i)=><li key={`${row.label}-${i}`}><div><span>{row.label}</span><strong>{percent?`${row.value.toFixed(1)}%`:row.value}</strong></div><span className="report-bar-track" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,row.value/max*100))}%`}} /></span>{'detail' in row && <small>{row.detail}</small>}</li>)}</ul> : <div className="report-empty">{percent?'No completed SLA targets to measure.':'No tickets to show.'}</div>}</section>;
}
export function ReportCharts({report}:{report:Report}) {
  const days = report.daily.map(d=>d.day);
  const breakdown=(kind:string)=>report.breakdowns.filter(row=>row.kind===kind);
  return <div className="report-chart-grid">
    <Trend title="Ticket volume" description="Tickets created and tickets resolved each day." days={days} series={[{label:'Created',values:report.daily.map(d=>d.created)},{label:'Resolved',values:report.daily.map(d=>d.resolved)}]}/>
    <Bars title="Ticket categories" description="Tickets created in the last 30 days, by their current category." rows={breakdown('categories')}/>
    <Bars title="Technician workload" description="Currently open tickets, including unassigned work." rows={breakdown('workload')}/>
    <Trend title="Resolution time" description="Average time from creation to latest resolution, grouped by resolution day. Reopened tickets are excluded until resolved again." days={days} series={[{label:'Average resolution',values:report.daily.map(d=>d.resolution)}]} time/>
    <Trend title="Response time" description="Average time from creation to first public IT reply, grouped by reply day." days={days} series={[{label:'Average response',values:report.daily.map(d=>d.response)}]} time/>
    <Bars title="SLA compliance" description="Completed targets met on time in the last 30 days. Pending targets and missing deadlines are excluded." rows={report.sla.map(s=>({label:s.label,value:s.met/s.total*100,detail:`${s.met} of ${s.total} completed targets met`}))} percent/>
    <Trend title="Reopened tickets" description="Distinct tickets moved from resolved or closed back to an active status each day." days={days} series={[{label:'Reopened',values:report.daily.map(d=>d.reopened)}]}/>
    <Bars title="Backlog age" description="Age since creation of all currently open tickets, including those waiting on a reply." rows={breakdown('backlog')}/>
    <Bars title="Tickets by department" description="Tickets created in the last 30 days, using the requester’s current department." rows={breakdown('departments')}/>
    <Bars title="Tickets by location" description="Tickets created in the last 30 days, using the location saved on each ticket." rows={breakdown('locations')}/>
  </div>;
}
