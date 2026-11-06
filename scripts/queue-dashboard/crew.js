// PHIBOT-27: real service observer, intentionally separate from queue controls.
// Never interprets remote strings as HTML or exposes an action endpoint.
const byId = id => document.getElementById(id);
const node = (tag, className, value) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (value !== undefined && value !== null) e.textContent = String(value);
  return e;
};
function renderCrew(data) {
  const status = byId("crew-status");
  const roster = byId("crew-roster");
  const history = byId("crew-history");
  roster.replaceChildren();
  history.replaceChildren();
  if (!data.connected) {
    status.textContent = "SERVICE NOT CONNECTED";
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
      " reported active run(s) · model availability not probed"));
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
async function refreshCrew() {
  try {
    const response = await fetch("/api/crew", { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("unavailable");
    renderCrew(await response.json());
  } catch {
    byId("crew-status").textContent = "SERVICE UNAVAILABLE";
    byId("crew-roster").replaceChildren(node("p", "muted small",
      "Unable to verify the optional local service. No agent state is being claimed."));
    byId("crew-history").replaceChildren();
    byId("crew-count").textContent = "Unknown";
  }
}
byId("crew-refresh").addEventListener("click", refreshCrew);
await refreshCrew();
// Polls only the fixed local read-only projection. Never starts or changes a bot.
setInterval(() => { if (!document.hidden) refreshCrew(); }, 20000);
