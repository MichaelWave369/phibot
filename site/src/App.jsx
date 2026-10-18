import React, { useMemo, useState } from "react";

const GITHUB = "https://github.com/MichaelWave369/phibot";
const START_JOBS = [
  { id: "PHI-001", repository: "MichaelWave369/phibot", capability: "repo.steward.discover", status: "completed", attempts: 1, detail: "Roadmap and issue inventory recorded", time: "09:18" },
  { id: "PHI-002", repository: "MichaelWave369/OpenBlue", capability: "repo.steward.inspect", pr: 23, status: "completed", attempts: 1, detail: "SHA-bound check evidence observed", time: "09:24" },
  { id: "PHI-003", repository: "MichaelWave369/InfiniteCommons", capability: "repo.steward.discover", status: "queued", attempts: 0, detail: "Ready for the next read-only pass", time: "09:32" },
  { id: "PHI-004", repository: "MichaelWave369/ChippyDip", capability: "repo.steward.inspect", pr: 6, status: "queued", attempts: 0, detail: "Waiting to inspect draft checks", time: "09:37" },
  { id: "PHI-005", repository: "MichaelWave369/Domistika", capability: "repo.steward.discover", status: "completed", attempts: 1, detail: "Roadmap observation stored", time: "09:41" },
  { id: "PHI-006", repository: "MichaelWave369/PorchTalk", capability: "repo.steward.inspect", pr: 12, status: "exhausted", attempts: 2, detail: "Simulated incomplete CI evidence", time: "09:45" },
  { id: "PHI-007", repository: "MichaelWave369/PhiCade", capability: "repo.steward.discover", status: "queued", attempts: 0, detail: "Read-only inventory awaiting pass", time: "09:50" },
  { id: "PHI-008", repository: "MichaelWave369/MoreBounceMethod", capability: "repo.steward.discover", status: "completed", attempts: 1, detail: "Repository discovery receipted", time: "09:55" },
];
const START_EVENTS = [
  { id: "LOG-041", action: "OBSERVED", repository: "MoreBounceMethod", detail: "Bounded read finished", time: "09:55", variant: "done" },
  { id: "LOG-040", action: "ENQUEUED", repository: "PhiCade", detail: "Discovery read accepted", time: "09:50", variant: "pending" },
  { id: "LOG-039", action: "ATTEMPTS_EXHAUSTED", repository: "PorchTalk", detail: "Review required, no promotion", time: "09:45", variant: "warn" },
  { id: "LOG-038", action: "OBSERVED", repository: "Domistika", detail: "Observation digest recorded", time: "09:41", variant: "done" },
  { id: "LOG-037", action: "ENQUEUED", repository: "ChippyDip", detail: "CI read queued", time: "09:37", variant: "pending" },
];

const allowedRepos = [
  "MichaelWave369/phibot", "MichaelWave369/InfiniteCommons",
  "MichaelWave369/ChippyDip", "MichaelWave369/Domistika",
  "MichaelWave369/PhiCade", "MichaelWave369/OpenBlue",
];
const statusText = { completed: "Completed", queued: "Queued", exhausted: "Needs review", leased: "Leased" };
const slug = s => s.split("/").at(-1);
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Icon({ name, size = 19, ...props }) {
  const p = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></>,
    list: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h9M8 13h9"/></>,
    shield: <><path d="M12 2.7 20 6v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3.3Z"/><path d="m9 12 2 2 4-4"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    reset: <><path d="M3 11a9 9 0 1 1 2 6"/><path d="M3 4v7h7"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    github: <><path d="M9 19c-4 1-4-2-6-2m6 5v-3a3.3 3.3 0 0 1 1-2.5c-5.4-.5-7.2-3-7.2-7.4a6 6 0 0 1 1.6-4.1A5.5 5.5 0 0 1 4.5 1s2-.2 4 2a14.3 14.3 0 0 1 7 0c2-2.2 4-2 4-2a5.5 5.5 0 0 1 .1 4A6 6 0 0 1 21 9c0 4.3-2.2 6.9-7.1 7.4A3.4 3.4 0 0 1 15 19v3"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.4.6l3-3A5 5 0 0 0 13 3.6l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.4-.6l-3 3A5 5 0 0 0 11 20.4l1.7-1.7"/></>,
    cpu: <><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    book: <><path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  };
  return <svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name] || p.grid}</svg>;
}

function PhiLogo() {
  return <span className="phi-logo" aria-hidden="true"><span>Φ</span><i/></span>;
}
function NavLink({ icon, label, active, onClick }) {
  return <button type="button" className={"nav-link" + (active ? " active" : "")} onClick={onClick}>
    <Icon name={icon} size={19}/><span>{label}</span>{active && <b/>}
  </button>;
}
function Dot({ status = "completed" }) {
  return <span className={"status-dot " + status} aria-hidden="true"/>;
}
function StatusPill({ status }) {
  return <span className={"status-pill " + status}><Dot status={status}/>{statusText[status] || status}</span>;
}

function Hero({ onDemo, onReset, passNumber, queued }) {
  return <section className="hero">
    <div className="eyebrow"><span className="hero-pip"/>THE GOVERNED ENGINEERING WORKSPACE <span className="eyebrow-divider">/</span> Φ LAB</div>
    <div className="hero-grid">
      <div>
        <h1>Give your ideas<br/><em>some backup.</em></h1>
        <p>One place to see the work, the evidence, and the boundaries. Explore how PhiBot coordinates discovery, CI inspection, and human-governed repairs without trading away control.</p>
        <div className="hero-buttons">
          <button className="btn primary" onClick={onDemo} disabled={!queued}>
            <Icon name="play" size={18}/> Run simulated pass <Icon name="arrow" size={17}/>
          </button>
          <button className="btn outline" onClick={onReset}><Icon name="reset" size={17}/> Reset demo</button>
        </div>
        <div className="hero-hint"><span className="hero-light"/>Public demo only <span className="sep">·</span> Local simulation <span className="sep">·</span> {passNumber} passes this session</div>
      </div>
      <div className="hero-illustration" aria-label="Conceptual illustration of PhiBot's governed connected agents">
        <div className="orbit orbit-1"/><div className="orbit orbit-2"/><div className="orbit orbit-3"/>
        <div className="orbit-node n1"><Icon name="search" size={16}/></div>
        <div className="orbit-node n2"><Icon name="shield" size={16}/></div>
        <div className="orbit-node n3"><Icon name="receipt" size={16}/></div>
        <div className="orbit-node n4"><Icon name="cpu" size={16}/></div>
        <div className="orbit-center"><div className="orbit-halo"/><PhiLogo/><small>GOVERNED CORE</small></div>
        <div className="orbit-label top">SCOUT / READ</div>
        <div className="orbit-label bottom">LEDGER / VERIFY</div>
      </div>
    </div>
  </section>;
}
function Metric({ title, number, detail, icon, accent, label }) {
  return <div className={"metric-card " + accent}>
    <div className="metric-top"><span>{title}</span><div className="metric-icon"><Icon name={icon} size={19}/></div></div>
    <div className="metric-number">{number.toString().padStart(2, "0")}</div>
    <div className="metric-footer"><Dot status={accent === "warn" ? "exhausted" : accent === "blue" ? "queued" : "completed"}/>{detail}</div>
    {label && <span className="metric-watermark">{label}</span>}
  </div>;
}
function JobTable({ jobs, filter, onFilter, onSelect, selectedId, detailed }) {
  const filters = ["all", "queued", "completed", "exhausted"];
  const filtered = filter === "all" ? jobs : jobs.filter(j => j.status === filter);
  return <section className="panel work-panel">
    <div className="section-heading">
      <div><div className="section-kicker">01 / WORK QUEUE</div><h2>Active work <span className="light-weight">/ in view</span></h2></div>
      <span className="panel-icon"><Icon name="list" size={21}/></span>
    </div>
    <div className="table-tools"><div className="filter-row">{filters.map(f =>
      <button key={f} onClick={() => onFilter(f)} className={"filter" + (filter === f ? " selected" : "")}>{f === "all" ? "All" : statusText[f]}</button>
    )}</div><span className="meta-count">{filtered.length} illustrative jobs</span></div>
    <div className="table-scroller"><table>
      <thead><tr><th>JOB / TARGET</th><th>CAPABILITY</th><th>STATE</th><th>ATTEMPTS</th><th></th></tr></thead>
      <tbody>{filtered.map(job =>
        <tr key={job.id} className={"job-row" + (job.id === selectedId ? " chosen" : "")}>
          <td><span className="job-id">{job.id}</span><strong>{slug(job.repository)}</strong><small>{job.repository}</small></td>
          <td><span className="capability-chip">{job.capability === "repo.steward.discover" ? "Discovery" : "CI inspection"}</span>{job.pr && <small>Draft PR #{job.pr} (sample)</small>}</td>
          <td><StatusPill status={job.status}/></td>
          <td><span className="attempts">{job.attempts}<span> / 2</span></span></td>
          <td><button title={"Inspect demo job " + job.id} className="icon-button" onClick={() => onSelect(job.id === selectedId ? null : job.id)}><Icon name="arrow" size={17}/></button></td>
        </tr>
      )}</tbody>
    </table>{!filtered.length && <div className="empty-table">No demo jobs match this filter.</div>}</div>
    {detailed && <div className="job-detail">
      <div><div className="section-kicker">ILLUSTRATIVE RECORD / {detailed.id}</div><strong>{detailed.detail}</strong><p>Simulated evidence. This is not a live observation of <b>{detailed.repository}</b>, and it confers no external authority.</p></div>
      <button className="icon-button" onClick={() => onSelect(null)} aria-label="Close job detail">×</button>
    </div>}
    <div className="panel-bottom"><span><Icon name="lock" size={15}/> No write authority in public preview</span><span>Maximum 2 attempts / job</span></div>
  </section>;
}
function Ledger({ events, compact = false }) {
  return <section className={"panel ledger-panel" + (compact ? " compact" : "")}>
    <div className="section-heading"><div><div className="section-kicker">02 / PROVENANCE STREAM</div><h2>Evidence ledger</h2></div><span className="pill neutral">SIMULATED</span></div>
    <div className="timeline">{events.slice(0, compact ? 5 : 18).map(event =>
      <div className="timeline-event" key={event.id}>
        <span className={"timeline-dot " + event.variant}/><div className="timeline-content"><strong>{event.action.replaceAll("_", " ")}</strong><small>{event.repository} <span>·</span> {event.detail}</small></div><time>{event.time}</time>
      </div>
    )}</div>
    <p className="timeline-note"><Icon name="shield" size={15}/> Example receipts are generated in your browser only. No GitHub data is fetched.</p>
  </section>;
}
function BudgetCard({ jobs, passNumber }) {
  const remaining = jobs.filter(j => j.status === "queued").length;
  return <section className="panel budget-panel">
    <div className="section-kicker">03 / OPERATIONAL LIMITS</div><h2>Budget guardrails</h2>
    <div className="budget-item"><div><span>Tasks per simulated pass</span><b>2 <small>/ 5 hard max</small></b></div><div className="track"><i style={{ width: "40%" }}/></div></div>
    <div className="budget-item"><div><span>Wall-time ceiling (real worker)</span><b>60s <small>/ 300s</small></b></div><div className="track"><i style={{ width: "20%" }}/></div></div>
    <div className="budget-row"><span>Available demo jobs</span><strong>{remaining}</strong></div>
    <div className="budget-row"><span>Simulated passes</span><strong>{passNumber}</strong></div>
    <div className="budget-row"><span>GitHub writes</span><strong className="teal">Not available</strong></div>
    <div className="budget-row"><span>Model calls</span><strong className="teal">Not available</strong></div>
    <div className="safety-box"><Icon name="shield" size={21}/><div><b>Permission stays with people.</b><span>A demo task can never approve a change, create a branch, or access a local agent.</span></div></div>
  </section>;
}
function DemoEnqueue({ onEnqueue }) {
  const [repo, setRepo] = useState(allowedRepos[0]);
  const [type, setType] = useState("repo.steward.discover");
  const [pr, setPr] = useState("32");
  const [message, setMessage] = useState("");
  function submit(e) {
    e.preventDefault();
    if (type === "repo.steward.inspect" && (!Number.isSafeInteger(Number(pr)) || Number(pr) < 1)) {
      setMessage("Please enter a positive demo PR number."); return;
    }
    onEnqueue(repo, type, type === "repo.steward.inspect" ? Number(pr) : undefined);
    setMessage("Local demo job queued. No external calls were made.");
  }
  return <section className="panel enqueue-panel">
    <div className="section-kicker">04 / PLAY IN THE SANDBOX</div><h2>Queue a demo read</h2>
    <p>Try the workflow. These controls manipulate <strong>browser-only sample state</strong>, never the real queue.</p>
    <form onSubmit={submit}>
      <label htmlFor="demo-repo">EXAMPLE REPOSITORY</label>
      <select id="demo-repo" value={repo} onChange={e => setRepo(e.target.value)}>{allowedRepos.map(r => <option key={r} value={r}>{slug(r)}</option>)}</select>
      <label htmlFor="demo-type">SIMULATED CAPABILITY</label>
      <select id="demo-type" value={type} onChange={e => setType(e.target.value)}><option value="repo.steward.discover">Discover roadmap + issues</option><option value="repo.steward.inspect">Inspect PR checks</option></select>
      {type === "repo.steward.inspect" && <><label htmlFor="demo-pr">ILLUSTRATIVE PR NUMBER</label><input type="number" id="demo-pr" min="1" max="999999" value={pr} onChange={e => setPr(e.target.value)}/></>}
      <button type="submit" className="btn secondary full"><Icon name="plus" size={16}/> Add simulated job</button>
    </form>
    <p className="form-notice" role="status">{message || "Nothing leaves this browser session."}</p>
  </section>;
}
const STEPS = [
  ["01", "Discover", "Read repository roadmap and scoped issues.", "read"],
  ["02", "Inspect CI", "Bind evidence to the exact draft head SHA.", "read"],
  ["03", "Propose", "Local PatchBot suggests a bounded edit.", "propose"],
  ["04", "Question", "Independent SkepticBot challenges the proposal.", "propose"],
  ["05", "Authorize", "Reality Gate binds approval to the exact input.", "gated"],
  ["06", "Review", "A human reviews the diff and independent CI.", "human"],
];
function Architecture() {
  return <div className="architecture">
    <div className="arch-intro"><div className="section-kicker">BUILT FOR HUMAN-CONTROLLED AUTOMATION</div><h2>The chain of responsibility.</h2><p>PhiBot separates observation, reasoning, and permission. No agent crosses an authority boundary just because its output sounds convincing.</p></div>
    <div className="arch-flow">{STEPS.map((step,i) =>
      <React.Fragment key={step[0]}>
        <div className={"arch-step " + step[3]}><span className="arch-number">{step[0]} / {step[3].toUpperCase()}</span><div className="arch-icon"><Icon name={step[3] === "gated" ? "shield" : step[3] === "human" ? "check" : step[3] === "propose" ? "cpu" : "search"} size={23}/></div><strong>{step[1]}</strong><p>{step[2]}</p></div>
        {i < STEPS.length - 1 && <div className="arch-arrow"><Icon name="arrow" size={20}/></div>}
      </React.Fragment>
    )}</div>
    <div className="boundary-grid">
      <section className="boundary-card"><Icon name="search" size={24}/><h3>Read boundary</h3><p>RepoScout and CI Inspector can observe scoped sources. The queue accepts read capabilities only.</p></section>
      <section className="boundary-card"><Icon name="cpu" size={24}/><h3>Proposal boundary</h3><p>Local model output remains an untrusted hypothesis, even after a second model reviews it.</p></section>
      <section className="boundary-card"><Icon name="lock" size={24}/><h3>Write boundary</h3><p>An explicit human-approved, single-use Reality Gate grant is required for governed writes.</p></section>
    </div>
  </div>;
}
function About() {
  return <div className="about-panel">
    <div className="section-kicker">THE PHI FIELD / OPEN SOURCE</div>
    <h2>Build outward.<br/><em>Circle back.</em></h2>
    <p>The mission is simple: make it easier to finish good ideas without handing unchecked authority to automation. PhiBot is an experimental, permission-governed micro-agent framework developed as part of a wider creative and engineering ecosystem.</p>
    <div className="about-links"><a href={GITHUB} target="_blank" rel="noreferrer"><Icon name="github" size={19}/> Explore source <Icon name="external" size={15}/></a><a href={GITHUB+"/blob/main/docs/BOUNDED_WORK_QUEUE.md"} target="_blank" rel="noreferrer"><Icon name="book" size={19}/> Read the queue protocol <Icon name="external" size={15}/></a><a href={GITHUB+"/blob/main/docs/LOCAL_QUEUE_DASHBOARD.md"} target="_blank" rel="noreferrer"><Icon name="book" size={19}/> Local operator setup <Icon name="external" size={15}/></a></div>
    <div className="about-notice"><Icon name="shield" size={20}/><span>This public GitHub Pages experience is a static simulation, not a remotely connected PhiBot command center. To inspect real local queue state, use the separate localhost dashboard on a trusted machine.</span></div>
  </div>;
}

export default function App() {
  const [tab,setTab] = useState("overview");
  const [jobs,setJobs] = useState(START_JOBS);
  const [events,setEvents] = useState(START_EVENTS);
  const [filter,setFilter] = useState("all");
  const [selectedId,setSelectedId] = useState(null);
  const [passes,setPasses] = useState(0);
  const selectedJob = useMemo(() => jobs.find(j => j.id === selectedId) || null,[jobs,selectedId]);
  const totals = useMemo(() => ({
    queued: jobs.filter(j => j.status === "queued").length,
    completed: jobs.filter(j => j.status === "completed").length,
    attention: jobs.filter(j => j.status === "exhausted" || j.status === "leased").length,
  }),[jobs]);

  function addEvent(action, repository, detail, variant) {
    setEvents(prev => [{ id: "LOG-" + (Date.now() + Math.random()).toString(36), action, repository, detail, variant, time: nowTime() }, ...prev].slice(0, 32));
  }
  function enqueueDemo(repo,type,pr) {
    const id = "PHI-" + String(Math.max(8,...jobs.map(j => Number(j.id.split("-")[1]) || 0))+1).padStart(3,"0");
    setJobs(prev => [...prev,{ id, repository:repo, capability:type, pr, status:"queued", attempts:0, detail:"Demo job entered by visitor",time:nowTime() }]);
    addEvent("ENQUEUED", slug(repo), "Browser-only queue entry", "pending");
  }
  function simulate() {
    const candidates = jobs.filter(j => j.status === "queued").slice(0,2);
    if(!candidates.length) return;
    setJobs(prev => prev.map(job =>
      candidates.some(c=>c.id===job.id)
        ? {...job, status:"completed", attempts:job.attempts+1,
           detail:"Simulated read-only observation received", time:nowTime()}
        : job,
    ));
    setPasses(p => p+1);
    for (const item of candidates) addEvent("OBSERVED",slug(item.repository),"Demo observation completed (no API call)","done");
  }
  function reset() {
    setJobs(START_JOBS);setEvents(START_EVENTS);setFilter("all");setSelectedId(null);setPasses(0);
  }
  const menu = [
    ["overview","grid","Overview"],["work","list","Work queue"],["governance","shield","Governance"],["ledger","receipt","Ledger"],
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setTab("overview")}><PhiLogo/><span><strong>PHIBOT</strong><small>MISSION CONTROL</small></span></button>
      <div className="menu-title">WORKSPACE</div>
      <nav aria-label="Main navigation">{menu.map(([id,icon,label])=>
        <NavLink key={id} icon={icon} label={label} active={tab===id} onClick={()=>setTab(id)}/>)}</nav>
      <div className="side-divider"/>
      <div className="menu-title">CONNECT</div>
      <a className="nav-link external-link" href={GITHUB} target="_blank" rel="noreferrer"><Icon name="github"/><span>GitHub repository</span><Icon name="external" size={13}/></a>
      <a className="nav-link external-link" href={GITHUB+"/blob/main/docs/LOCAL_QUEUE_DASHBOARD.md"} target="_blank" rel="noreferrer"><Icon name="book"/><span>Local setup</span><Icon name="external" size={13}/></a>
      <div className="sidebar-bottom"><div className="terminal-sign"><span className="terminal-dot"/><div><strong>PUBLIC SHOWCASE</strong><small>Simulated sample data</small></div></div><div className="sidebar-foot">v0.1 · PHI / 369<br/>LEDGER ABOVE EGO</div></div>
    </aside>
    <div className="mobile-top"><button className="brand" onClick={()=>setTab("overview")}><PhiLogo/><span><strong>PHIBOT</strong><small>MISSION CONTROL</small></span></button><span className="demo-tag">DEMO MODE</span></div>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs">PHI ECOSYSTEM <span>/</span> MISSION CONTROL <span>/</span> <b>{tab.toUpperCase()}</b></div><div className="top-meta"><span className="online"><i/>INTERACTIVE PREVIEW</span><span className="demo-tag">DEMO DATA · NO LIVE ACCESS</span></div></header>
      {tab==="overview" && <>
        <Hero onDemo={simulate} onReset={reset} passNumber={passes} queued={totals.queued}/>
        <div className="section-kicker metrics-label">QUEUE SNAPSHOT <span>·</span> ILLUSTRATIVE STATE</div>
        <div className="metrics">
          <Metric title="TOTAL JOBS" number={jobs.length} detail="Browser-only demo records" icon="list" accent="cyan" label="01"/>
          <Metric title="QUEUED" number={totals.queued} detail="Available for simulated pass" icon="clock" accent="blue" label="02"/>
          <Metric title="COMPLETED" number={totals.completed} detail="Simulated observations" icon="check" accent="cyan" label="03"/>
          <Metric title="NEEDS REVIEW" number={totals.attention} detail="Exhausted or leased" icon="shield" accent="warn" label="04"/>
        </div>
        <div className="content-grid"><div className="primary-col">
          <JobTable jobs={jobs.slice(0,6)} filter={filter} onFilter={setFilter} onSelect={setSelectedId} selectedId={selectedId} detailed={selectedJob}/>
          <Ledger events={events} compact/>
        </div><div className="side-col"><BudgetCard jobs={jobs} passNumber={passes}/><DemoEnqueue onEnqueue={enqueueDemo}/></div></div>
      </>}
      {tab==="work" && <><div className="page-heading"><div className="section-kicker">OPERATOR VISIBILITY</div><h1>Work <em>queue.</em></h1><p>Explore the jobs, simulated attempts, and results. This public page never contacts GitHub or the localhost service.</p></div><div className="content-grid"><div className="primary-col"><JobTable jobs={jobs} filter={filter} onFilter={setFilter} onSelect={setSelectedId} selectedId={selectedId} detailed={selectedJob}/><Ledger events={events}/></div><div className="side-col"><BudgetCard jobs={jobs} passNumber={passes}/><DemoEnqueue onEnqueue={enqueueDemo}/><button className="btn primary full" onClick={simulate} disabled={!totals.queued}><Icon name="play" size={17}/> Run simulated pass</button><button className="btn outline full" onClick={reset}><Icon name="reset" size={17}/> Reset sample</button></div></div></>}
      {tab==="governance" && <><div className="page-heading"><div className="section-kicker">TRUST BY DESIGN</div><h1>Governance <em>first.</em></h1><p>A good assistant needs boundaries that are clearer than its ambitions. Here is the architecture behind the showcase.</p></div><Architecture/></>}
      {tab==="ledger" && <><div className="page-heading"><div className="section-kicker">PROVENANCE / RECEIPTS</div><h1>Show the <em>evidence.</em></h1><p>These illustrative receipts explain how local evidence is tracked, without publishing real queue contents or untrusted source text.</p></div><Ledger events={events}/><div className="ledger-about"><Icon name="lock" size={20}/><div><strong>No secret state is published here.</strong><p>The real ledger and work-queue live under the local operator's ignored <code>.phibot/</code> directory. This demo does not load, store, or transmit them.</p></div></div></>}
      <About/>
      <footer className="footer"><span>© PHIBOT • AN ORIGINAL Φ ECOSYSTEM PROJECT</span><span>BUILD OUTWARD. CIRCLE BACK. <b>LEDGER ABOVE EGO.</b></span></footer>
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{menu.map(([id,icon,label])=><button key={id} className={tab===id?"current":""} onClick={()=>setTab(id)}><Icon name={icon} size={19}/><span>{label}</span></button>)}</nav>
  </div>;
}
