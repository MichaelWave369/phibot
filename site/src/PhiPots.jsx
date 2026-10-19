import React, { useState } from "react";
import "./phipots.css";

const ROLES = [
  {
    id: "idea", mark: "01", name: "IdeaBot", discipline: "SPECIFICATION",
    blurb: "Turns a parked idea into a small, reviewable brief.",
    input: "Idea note, constraints, provenance",
    output: "Scope, acceptance criteria, unanswered questions",
    boundary: "May suggest work; cannot create or authorize projects."
  },
  {
    id: "builder", mark: "02", name: "BuilderBot", discipline: "PROTOTYPE",
    blurb: "Proposes minimal original code or design changes.",
    input: "Approved brief and repository scope",
    output: "Bounded patch proposal with source references",
    boundary: "Cannot push a patch without the separately approved write path."
  },
  {
    id: "test", mark: "03", name: "TestBot", discipline: "VERIFICATION",
    blurb: "Plans tests, reviews CI evidence, and flags regressions.",
    input: "Pinned candidate SHA and named checks",
    output: "Pass, fail, missing, or unverified report",
    boundary: "Cannot declare green without check evidence."
  },
  {
    id: "audit", mark: "04", name: "AuditBot", discipline: "SKEPTICAL REVIEW",
    blurb: "Challenges assumptions, privileges, provenance, and safety.",
    input: "Proposal, permissions, and evidence",
    output: "Independent objections and risk assessment",
    boundary: "Does not issue Reality Gate grants or self-approve."
  },
  {
    id: "deploy", mark: "05", name: "DeployBot", discipline: "RELEASE PLANNING",
    blurb: "Prepares a human-readable release and rollout checklist.",
    input: "Verified candidate and release requirements",
    output: "Deploy plan, rollback plan, and approval request",
    boundary: "Cannot merge, deploy, or publish from this showcase."
  },
  {
    id: "ledger", mark: "06", name: "LedgerBot", discipline: "PROVENANCE",
    blurb: "Keeps proposed work distinct from observed and verified results.",
    input: "Job IDs, source refs, hashes, decisions",
    output: "Traceable receipt plan and status summary",
    boundary: "Never upgrades unverified claims into verified evidence."
  }
];

const HANDOFF = [
  ["PLANT", "Capture the idea and constraints"],
  ["DESIGN", "Propose a scoped plan and patch"],
  ["CHALLENGE", "Review risks and CI evidence"],
  ["APPROVE", "Human + Reality Gate for exact writes"],
  ["RECEIPT", "Record what actually happened"]
];

export default function PhiPots() {
  const [selected, setSelected] = useState(ROLES[0].id);
  const bot = ROLES.find(item => item.id === selected) || ROLES[0];

  return <section className="pots">
    <div className="page-heading pots-head">
      <div className="section-kicker">CONCEPT / PHIBOT TEAM ROSTER</div>
      <h1>Meet the <em>PhiPots.</em></h1>
      <p>Six proposed specialties. One governed PhiBot foundation. MikeyBot6000 is the playful nickname for this future development crew, not a claim that an autonomous fleet is running.</p>
      <div className="pots-disclaimer" role="note">
        <strong>DESIGN PREVIEW</strong>
        <span>These six roles are a proposed coordination layer. Selecting a bot only changes this page. No agent is spawned, no model runs, no GitHub requests occur, and no jobs are queued.</span>
      </div>
    </div>

    <div className="pots-heading-row">
      <div><div className="section-kicker">01 / THE CREW</div><h2>Choose a specialty.</h2></div>
      <span className="pots-count">6 ROLE BLUEPRINTS</span>
    </div>
    <div className="pots-grid" role="group" aria-label="PhiPots role blueprints">
      {ROLES.map(role => <button
        type="button"
        key={role.id}
        className={"pots-card" + (selected === role.id ? " selected" : "")}
        aria-pressed={selected === role.id}
        onClick={() => setSelected(role.id)}
      >
        <span className="pots-card-top"><span className="pots-mark">{role.mark}</span><span className="pots-proposed">PROPOSED</span></span>
        <strong>{role.name}</strong>
        <small>{role.discipline}</small>
        <span className="pots-card-description">{role.blurb}</span>
        <span className="pots-open">{selected === role.id ? "Viewing brief" : "View role brief"} <span aria-hidden="true">↗</span></span>
      </button>)}
    </div>

    <div className="pots-detail" aria-live="polite">
      <div className="pots-detail-heading"><span className="section-kicker">ROLE BRIEF / {bot.mark}</span><h2>{bot.name}</h2><p>{bot.blurb}</p></div>
      <div className="pots-detail-grid">
        <div><b>INTENDED INPUT</b><p>{bot.input}</p></div>
        <div><b>PROPOSED OUTPUT</b><p>{bot.output}</p></div>
        <div className="pots-boundary"><b>AUTHORITY BOUNDARY</b><p>{bot.boundary}</p></div>
      </div>
    </div>

    <div className="pots-heading-row pots-flow-heading">
      <div><div className="section-kicker">02 / TEAMWORK WITH RECEIPTS</div><h2>Ideas in. Evidence out.</h2></div>
    </div>
    <ol className="pots-flow">
      {HANDOFF.map(([name, explanation], index) => <li key={name}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <strong>{name}</strong>
        <small>{explanation}</small>
      </li>)}
    </ol>

    <div className="pots-footer-note">
      <strong>What already exists?</strong>
      <p>PhiBot has governed tooling, a bounded read-only RepoScout queue, an isolated PatchBot/SkepticBot repair proposal prototype, and human-approved Reality-Gated write candidates. PhiPots proposes how future specialist roles could coordinate around those pieces. The public showcase is not connected to the local runtime.</p>
      <a href="https://github.com/MichaelWave369/phibot/blob/main/docs/PHIPOTS_CREW.md" target="_blank" rel="noreferrer">Read proposed team protocol ↗</a>
    </div>
  </section>;
}
