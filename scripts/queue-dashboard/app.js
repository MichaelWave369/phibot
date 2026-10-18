const $ = id => document.getElementById(id);
let token = null;
let actionsEnabled = false;
let busy = false;
let lastState = null;

function create(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined && value !== null) el.textContent = String(value);
  return el;
}
function showError(message) {
  const banner = $("banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}
function clearError() { $("banner").classList.add("hidden"); }
function summaryText(job) {
  const ev = job.evidence;
  if (!ev || typeof ev !== "object") return "Awaiting observation";
  if (ev.checkStatus) return ev.checkStatus.replaceAll("_", " ");
  if (Number.isInteger(ev.tasks) && Number.isInteger(ev.issues))
    return ev.tasks + " tasks · " + ev.issues + " issues";
  return "Receipt " + String(ev.digest || "").slice(0, 10);
}
function fillJobs(jobs) {
  const tbody = $("jobs");
  tbody.replaceChildren();
  if (!jobs.length) {
    const tr = create("tr");
    const td = create("td", "empty", "No local jobs yet. Add a read-only observation to begin.");
    td.colSpan = 4;
    tr.append(td); tbody.append(tr); return;
  }
  for (const job of jobs) {
    const tr = create("tr");
    const name = create("td");
    name.append(create("div", "jobcap", job.capability.replace("repo.steward.", "")));
    name.append(create("div", "jobmeta", job.repository +
      (job.prNumber ? " · PR #" + job.prNumber : "") + " · " + job.id.slice(0, 10)));
    const state = create("td");
    state.append(create("span", "state " + job.state, job.state));
    const attempts = create("td", "digits", job.attempts + " / 2");
    const evidence = create("td", "evidence", summaryText(job));
    tr.append(name, state, attempts, evidence);
    tbody.append(tr);
  }
}
function fillEvents(events) {
  const region = $("events");
  region.replaceChildren();
  if (!events.length) { region.append(create("div", "empty", "No transitions recorded yet.")); return; }
  for (const event of events) {
    const row = create("div", "event");
    row.append(create("span", "dot"));
    const details = create("div");
    details.append(create("strong", "", event.event.replaceAll("_", " ")));
    details.append(create("small", "", "Job " + event.id +
      (event.attempts === null ? "" : " · Attempt " + event.attempts)));
    row.append(details);
    const time = create("time", "", event.at ?
      new Date(event.at).toLocaleString() : "Unknown time");
    row.append(time);
    region.append(row);
  }
}
function fillRepos(repos) {
  const select = $("repository"), selected = select.value;
  select.replaceChildren();
  for (const repo of repos) {
    const option = create("option", "", repo);
    option.value = repo; select.append(option);
  }
  if (repos.includes(selected)) select.value = selected;
}
function controlState() {
  const enabled = actionsEnabled && !busy;
  $("run").disabled = !enabled;
  $("enqueue").disabled = !enabled;
  $("repository").disabled = !enabled;
  $("capability").disabled = !enabled;
  $("pr").disabled = !enabled;
  $("checks").disabled = !enabled;
  $("run").textContent = busy ? "Working on one pass…" : "▶   Run one bounded pass";
}
function applyState(s) {
  lastState = s;
  const jobs = Array.isArray(s.jobs) ? s.jobs : [];
  const count = state => jobs.filter(j => j.state === state).length;
  $("total").textContent = jobs.length;
  $("queued").textContent = count("queued");
  $("completed").textContent = count("completed");
  $("attention").textContent = count("leased") + count("exhausted");
  $("job-counter").textContent = jobs.length + (jobs.length === 1 ? " observation" : " observations");
  fillJobs(jobs);
  fillEvents(Array.isArray(s.events) ? s.events : []);
  $("max-jobs").textContent = String(s.budget.maxJobs) + " / 5";
  $("max-ms").textContent = (s.budget.maxMs / 1000) + "s / 300s";
  $("jobs-meter").style.width = (s.budget.maxJobs * 20) + "%";
  $("time-meter").style.width = (s.budget.maxMs / 300000 * 100) + "%";
  $("lock").textContent = s.worker?.state === "LOCK_PRESENT" ? "ACTIVE / PRESENT" :
    s.worker?.state === "NO_LOCK" ? "CLEAR" : "VERIFY LOCALLY";
  fillRepos(s.allowlist || []);
  $("updated").textContent = "Last local refresh " + new Date().toLocaleTimeString();
  actionsEnabled = !!s.actionsEnabled && !!token;
  $("conn").textContent = "LOCAL • " + (actionsEnabled ? "OPERATOR MODE" : "VIEW ONLY");
  $("action-note").textContent = actionsEnabled
    ? "Manual controls active. Every worker pass is limited to the read-only tool catalog."
    : "Viewer mode. To enable queue controls, restart with PHIBOT_QUEUE_DASHBOARD_ACTIONS=1.";
  controlState();
}
async function get(url) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error("Local queue state is unavailable (" + response.status + ").");
  return response.json();
}
async function update() {
  try {
    const state = await get("/api/state");
    clearError();
    applyState(state);
  } catch (error) { showError(String(error.message)); }
}
async function act(path, input) {
  if (!actionsEnabled || busy || !token) return;
  busy = true;
  clearError(); controlState();
  try {
    const response = await fetch(path, {
      method: "POST", credentials: "omit", cache: "no-store",
      headers: { "content-type": "application/json", "x-phibot-session": token },
      body: JSON.stringify(input),
    });
    const output = await response.json();
    if (!response.ok) throw new Error(output.code || "Operator request refused");
    $("enqueue-note").textContent = path === "/api/enqueue"
      ? (output.status || "Queued") + " · " + String(output.id || "").slice(0, 12)
      : (output.completed || 0) + " completed, " + (output.retryable || 0) +
        " queued for next operator pass";
  } catch (error) { showError("Operator request refused: " + error.message); }
  finally { busy = false; await update(); controlState(); }
}
$("refresh").addEventListener("click", update);
$("run").addEventListener("click", () => act("/api/run-once", {}));
$("capability").addEventListener("change", () => {
  $("inspect-fields").classList.toggle("hidden", $("capability").value !== "repo.steward.inspect");
});
$("enqueue").addEventListener("click", () => {
  const capability = $("capability").value;
  const input = { repository: $("repository").value };
  if (capability === "repo.steward.inspect") {
    const n = Number($("pr").value);
    const checks = $("checks").value.split(",").map(s => s.trim()).filter(Boolean);
    if (!Number.isSafeInteger(n) || n < 1 || checks.length < 1 || checks.length > 20) {
      showError("Enter a valid PR number and 1 to 20 exact required check names."); return;
    }
    input.prNumber = n;
    input.requiredChecks = checks;
  }
  act("/api/enqueue", { capability, input });
});
try {
  const session = await get("/api/session");
  token = session.token;
  actionsEnabled = !!session.actionsEnabled;
  await update();
} catch (error) { showError("Local dashboard could not initialize: " + error.message); }
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !busy) update();
});
// This polls only localhost queue metadata; it does NOT run jobs.
setInterval(() => { if (!document.hidden && !busy) update(); }, 20000);
