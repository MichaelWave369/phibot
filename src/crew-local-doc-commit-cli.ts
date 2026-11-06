#!/usr/bin/env node
/**
 * PHIBOT-42: explicit, TTY-only Reality Gate for ONE local Git commit.
 * No remote network action, push, PR, CI claim, merge or deployment.
 */
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { FileLedger } from "./core/ledger.js";
import { validateManifest } from "./core/manifest.js";
import { RealityGate } from "./gate/reality-gate.js";
import { ToolExecutor } from "./tools/executor.js";
import { ToolCapabilityRegistry } from "./tools/registry.js";
import {
  registerLocalDocCommit, LOCAL_DOC_COMMIT_CAPABILITY,
} from "./tools/crew-local-doc-commit.js";
import { previewLocalDocCommit, verifyLocalDocCommit } from "./crew-local-doc-commit.js";

function args(argv: string[]): {
  command: "commit" | "verify";
  repoDir: string;
  draftId: string;
  allowedRoots: string[];
} {
  if ((argv[0] !== "commit" && argv[0] !== "verify") || argv.length !== 5)
    throw Error("Usage: crew:commit or crew:commit:verify -- --draft <uuid> --repo <root>");
  const flags: Record<string, string> = {};
  for (let i=1;i<5;i+=2) {
    const name=argv[i], value=argv[i+1];
    if (!name || !value || !["--draft", "--repo"].includes(name) ||
        flags[name] !== undefined) throw Error("CREW_COMMIT_CLI_ARGS_INVALID");
    flags[name] = value;
  }
  const repoDir=flags["--repo"], draftId=flags["--draft"];
  const allowlist=process.env.PHIBOT_CREW_REPO_ALLOWLIST;
  if (!repoDir || !draftId || !allowlist)
    throw Error("CREW_COMMIT_ALLOWLIST_AND_DRAFT_REQUIRED");
  return {
    command: argv[0] as "commit" | "verify",
    repoDir, draftId,
    allowedRoots: allowlist.split(";").map(v => v.trim()).filter(Boolean),
  };
}
async function main(argv=process.argv.slice(2)): Promise<void> {
  const options=args(argv);
  if (options.command === "verify") {
    stdout.write(JSON.stringify(await verifyLocalDocCommit(options), null, 2) + "\n");
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY)
    throw Error("CREW_COMMIT_INTERACTIVE_TTY_REQUIRED");
  if (process.env.PHIBOT_ENABLE_LOCAL_DOC_COMMIT !== "1")
    throw Error("CREW_COMMIT_EXPLICIT_OPT_IN_REQUIRED");
  const secret=process.env.PHIBOT_REALITY_GATE_SECRET ?? "";
  if (secret.length < 32 || secret.length > 256 || /[\r\n]/.test(secret))
    throw Error("CREW_COMMIT_GATE_SECRET_REQUIRED");

  const prepared=await previewLocalDocCommit(options);
  const root=await realpath(resolve(options.repoDir));
  const stateDir=join(root, ".phibot");
  await mkdir(stateDir, { recursive:true, mode:0o700 });
  if (await realpath(stateDir) !== stateDir)
    throw Error("CREW_COMMIT_LOCAL_STATE_SYMLINK");

  const ledger=new FileLedger(join(stateDir, "ledger.ndjson"));
  const gate=new RealityGate({ secret, ledger, defaultTtlMs:60000 });
  const registry=registerLocalDocCommit(new ToolCapabilityRegistry(), options.allowedRoots);
  const executor=new ToolExecutor(registry, ledger, {timeoutMs:30000}, gate);
  const manifest=validateManifest({
    id:"human-doc-commit-operator", name:"Human Local Doc Commit",
    role:"one_preapproved_local_commit",version:"1.0.0",
    description:"Human Reality Gate for one documentation commit without remote write",
    model:{provider:"operator",name:"human"},
    memory:{scope:"none",maxDepth:0},
    capabilities:[LOCAL_DOC_COMMIT_CAPABILITY],
    authority:{read:true,propose:false,write:"gated",deploy:false},
    escalation:{target:"human",confidenceBelow:1},
  });
  const runId=randomUUID();
  const pending=await executor.execute(manifest, {
    capability:LOCAL_DOC_COMMIT_CAPABILITY,input:prepared.intent,
  },runId);
  if (pending.status !== "gated" || !pending.gateRequest)
    throw Error("CREW_COMMIT_GATE_NOT_ISSUED");

  stdout.write([
    "\nPHIBOT-42 / HUMAN-APPROVED LOCAL DOCUMENTATION COMMIT",
    "Canonical repository root: "+prepared.intent.repoRoot,
    "Dedicated branch: "+prepared.intent.branch,
    "Current HEAD: "+prepared.intent.oldHead,
    "Target: "+prepared.intent.target,
    "Source/after SHA-256: "+prepared.intent.expectedSha256,
    "PHIBOT-41 apply receipt SHA-256: "+prepared.intent.applyReceiptDigest,
    "Commit message: "+prepared.intent.message,
    "Reality Gate exact intent SHA-256: "+pending.gateRequest.inputDigest,
    "",
    "ONE target only. Git staging, commit-tree and branch update.",
    "No push, GitHub PR, CI success, merge, deploy or broad bot write permission.",
    "Re-check the existing source via git diff before consenting.",
  ].join("\n")+"\n\n");

  const phrase="COMMIT "+pending.gateRequest.inputDigest.slice(0,16);
  const io=createInterface({input:stdin,output:stdout});
  let response="";
  try { response=await io.question("Type exactly '"+phrase+"' to create ONE local commit: "); }
  finally { io.close(); }
  if (response!==phrase) {
    await gate.decide(pending.gateRequest,{
      outcome:"deny",reason:"Local commit operator declined exact request",
    });
    stdout.write("DECLINED. No staging or commit attempted.\n");
    return;
  }
  const decision=await gate.decide(pending.gateRequest,{
    outcome:"approve",reason:"Operator approved exact, local-only documentation commit",
  });
  if (!decision.grant) throw Error("CREW_COMMIT_GATE_GRANT_MISSING");
  const completed=await executor.execute(manifest,{
    capability:LOCAL_DOC_COMMIT_CAPABILITY,
    input:prepared.intent, grant:decision.grant,
  },runId);
  if (completed.status!=="executed")
    throw Error("CREW_COMMIT_FAILED_OR_AMBIGUOUS_INSPECT_LOCAL_INDEX_AND_ATTEMPT");
  stdout.write(JSON.stringify({
    status:"LOCAL_COMMIT_CREATED_NOT_PUSHED_CI_UNVERIFIED",
    result:completed.output,
    nextStep:"crew:commit:verify, git show, local tests; push requires a separate human decision.",
  },null,2)+"\n");
}
main().catch(error=>{
  process.stderr.write("Local commit refused: "+
    (error instanceof Error?error.message:"unknown")+"\n");
  process.exitCode=1;
});
