// PHIBOT-27 + PHIBOT-34: live crew observer and review-only Ollama planner.
// This script has NO model-switch, bot-spawn, tool execution or approval action.
const byId = id => document.getElementById(id);
const node = (tag, className, value) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (value !== undefined && value !== null) e.textContent = String(value);
  return e;
};
let crew = null;
let catalog = null;
let plannerEnabled = false;
let plannerToken = null;
let planning = false;
const MISSIONS = ["scout", "patch", "skeptic", "test", "memory"];
const choices = new Map();

function notice(message) {
  byId("crew-plan-status").textContent = message;
}
function picker(card, bot) {
  const models = catalog?.connected ? catalog.models : [];
  const group = node("div", "crew-picker");
  const modelLabel = node("label", "", "CANDIDATE OLLAMA MODEL");
  const model = node("select");
  model.setAttribute("aria-label", "Model candidate for " + bot.name);
  const empty = node("option", "", models.length ? "Choose installed tag" : "No local Ollama tags");
  empty.value = "";
  model.append(empty);
  for (const name of models) {
    const option = node("option", "", name);
    option.value = name; model.append(option);
  }
  const saved = choices.get(bot.id);
  if (saved && models.includes(saved.model)) model.value = saved.model;
  const missionLabel = node("label", "", "PROPOSED CREW ASSIGNMENT");
  const mission = node("select");
  mission.setAttribute("aria-label", "Mission for " + bot.name);
  for (const name of MISSIONS) {
    const option = node("option", "", name);
    option.value = name; mission.append(option);
  }
  if (saved && MISSIONS.includes(saved.mission)) mission.value = saved.mission;
  const button = node("button", "button secondary small", "Review assignment");
  button.type = "button";
  const isIdle = bot.state === "idle" && bot.activeRuns === 0;
  button.disabled = !plannerEnabled || !plannerToken || !isIdle || !models.length || planning;
  button.addEventListener("click", async () => {
    choices.set(bot.id, { model: model.value, mission: mission.value });
    await propose(bot.id, model.value, mission.value);
  });
  model.addEventListener("change", () => choices.set(bot.id, {
    model: model.value, mission: mission.value,
  }));
  mission.addEventListener("change", () => choices.set(bot.id, {
    model: model.value, mission: mission.value,
  }));
  group.append(modelLabel, model, missionLabel, mission, button);
  card.append(group);
}
function renderCrew(data) {
  const status = byId("crew-status");
  const roster = byId("crew-roster");
  const history = byId("crew-history");
  roster.replaceChildren();
  history.replaceChildren();
  if (!data.connected) {
    status.textContent = "SERVICE NOT CONNECTED";
    byId("crew-count").textContent = "Not connected";
    roster.append(node("p", "muted small",
      "No live service linked. Start PhiBot service separately, then configure PHIBOT_CREW_SERVICE_PORT."));
    history.append(node("p", "muted small", "No live service events available."));
    return;
  }
  status.textContent = "SERVICE REPORTED • NOT ATTESTED";
  byId("crew-count").textContent = String(data.bots.length) + " registered";
  if (!data.bots.length)
    roster.append(node("p", "muted small", "The connected service has no registered bots."));
  for (const bot of data.bots) {
    const card = node("article", "crew-card");
    const head = node("div", "crew-card-head");
    head.append(node("strong", "", bot.name));
    head.append(node("span", "state " + bot.state, bot.state));
    card.append(head);
    card.append(node("p", "muted small", bot.role + " · " + bot.id));
    card.append(node("p", "crew-model", "Configured model: " +
      bot.model.provider + " / " + bot.model.name));
    card.append(node("p", "muted small", String(bot.activeRuns) +
      " reported active run(s) · configured model not probed"));
    picker(card, bot);
    roster.append(card);
  }
  if (!data.events.length)
    history.append(node("p", "muted small", "No service events observed in this process."));
  for (const event of data.events.slice().reverse()) {
    const line = node("div", "crew-event");
    line.append(node("span", "", event.type +
      (event.botId ? " · " + event.botId : "")));
    line.append(node("time", "muted small", new Date(event.timestamp).toLocaleTimeString()));
    history.append(line);
  }
}
async function get(path) {
  const response = await fetch(path, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw Error("Local data unavailable");
  return response.json();
}
async function refreshModels() {
  try {
    catalog = await get("/api/models");
    byId("crew-model-status").textContent = catalog.connected
      ? catalog.models.length + " TAGS REPORTED · NOT INFERENCE TESTED"
      : "OLLAMA NOT CONFIGURED";
  } catch {
    catalog = null;
    byId("crew-model-status").textContent = "OLLAMA UNAVAILABLE";
  }
}
async function refreshCrew() {
  try {
    crew = await get("/api/crew");
    renderCrew(crew);
  } catch {
    crew = null;
    byId("crew-status").textContent = "SERVICE UNAVAILABLE";
    byId("crew-roster").replaceChildren(node("p", "muted small",
      "Unable to verify the optional local service. No agent state is being claimed."));
    byId("crew-history").replaceChildren();
    byId("crew-count").textContent = "Unknown";
  }
}
async function refreshAll() {
  await refreshModels();
  await refreshCrew();
}
async function propose(botId, modelName, mission) {
  if (!plannerEnabled || !plannerToken || planning || !modelName) return;
  planning = true;
  notice("Rechecking current service and local model tags…");
  try {
    const response = await fetch("/api/crew/plan", {
      method: "POST", cache: "no-store", credentials: "omit",
      headers: { "content-type": "application/json",
        "x-phibot-session": plannerToken },
      body: JSON.stringify({ botId, modelName, mission }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.code || "review refused");
    const plan = result.plan;
    if (result.recheck !== "REVIEW_ONLY_RECHECK_PASSED_NO_ACTION" ||
        plan?.action !== "REVIEW_ONLY_NO_EXECUTION")
      throw Error("Proposal failed source recheck");
    byId("crew-proposal").replaceChildren(
      node("strong", "", "REVIEW-ONLY PROPOSAL · NO CHANGE MADE"),
      node("p", "", plan.botId + " · " + plan.mission),
      node("p", "", plan.current.provider + " / " + plan.current.name +
        " → " + plan.candidate.provider + " / " + plan.candidate.name),
      node("p", "muted small", "Proposal SHA-256: " + plan.digest),
      node("p", "muted small", "Source roster and tags rechecked by the server. No model readiness or successful inference has been proved."),
    );
    notice("Proposal checked. No service model changed, and no mission was sent.");
  } catch (error) {
    byId("crew-proposal").replaceChildren();
    notice("Review refused: " + error.message);
  } finally {
    planning = false;
    await refreshAll();
  }
}
byId("crew-refresh").addEventListener("click", refreshAll);
try {
  const session = await get("/api/session");
  plannerEnabled = !!session.plannerEnabled;
  plannerToken = plannerEnabled ? session.token : null;
  byId("crew-plan-mode").textContent = plannerEnabled
    ? "LOCAL REVIEW MODE • NO WRITES"
    : "PLANNING DISABLED • SET PHIBOT_CREW_PLANNER_ACTIONS=1 TO REVIEW";
  await refreshAll();
} catch {
  notice("Could not load local crew planning session.");
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !planning) refreshAll();
});
setInterval(() => { if (!document.hidden && !planning) refreshAll(); }, 20000);
