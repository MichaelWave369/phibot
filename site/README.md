# PhiBot Mission Control · React public demo

Static GitHub Pages React/Vite companion to PhiBot's localhost-only operator dashboard.

- Run: `npm install && npm run dev`
- Test: `npm run test:contract`
- Build: `npm run build`
- Intended Pages path: `/phibot/`
- Public demo data: static, illustrative, browser-only
- External data access: **none**
- GitHub writes, local worker control, Ollama and Reality Gate approvals: **none**

The live operator-only Node dashboard is a **separate** component in `scripts/queue-dashboard/`; this project never connects to it.

See [PUBLIC_MISSION_CONTROL.md](../docs/PUBLIC_MISSION_CONTROL.md) for deployment and permission boundaries.

## PhiPots team showcase

The **PhiPots** navigation tab is a browser-only, six-role **design preview** for IdeaBot, BuilderBot, TestBot, AuditBot, DeployBot and LedgerBot. These are proposed specialties, not running agents or an orchestration service. See [PhiPots proposal](../docs/PHIPOTS_CREW.md).
