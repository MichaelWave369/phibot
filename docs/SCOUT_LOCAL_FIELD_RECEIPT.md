# PHIBOT-12 · Windows local Scout field receipt

**Status:** operator-initiated candidate. CI only validates offline fixtures; no target-machine PASS is claimed.

The installed PhiBot Scout components now support one command to prove their concrete local combination, rather than treating GitHub PR checks as a field test.

## Windows PowerShell quick start

From the PhiBot repository, with **Node.js 22+** and **Ollama already running** on the same Windows PC:

```powershell
npm install
npm run scout:field -- --ack-unverified-public --model qwen3:4b
```

`qwen3:4b` is the default tag. Use the exact name of a model already installed in local Ollama; do not use cloud-only model tags. `--model` is optional. The command uses `http://127.0.0.1:11434` and refuses a remote endpoint; no API keys, cloud inference, tool calls or automatic actions are enabled.

**Before this local test**, run the separately built GitHub Actions manual cloud field qualification (**PHIBOT-10**) on main at [PhiBot Scout Public Field Qualification](https://github.com/MichaelWave369/PhiBot/actions/workflows/cloud-scout-field-qualification.yml). If its public evidence is expired, refresh the existing FieldCloudWorker observation with its own manual workflow, then rerun the qualification. This local CLI **does not claim to check** that external human/manual prerequisite.

## What the command actually does

1. Explicitly accepts only the literal `--ack-unverified-public` and optional installed model tag; no arbitrary task, URL, remote host or command argument.
2. Executes PHIBOT-09's fixed four public GitHub GETs, binds `status.json` and `phibot_mission.json` to one Git commit, checks the referenced Actions run, and refuses expired/failed observations.
3. Feeds **only hardcoded enum fields** into the existing PhiBotRuntime/Ollama shadow adapter. One logical `interpret` stage calls Ollama. Three remaining stages are inert. A narrow retry is permitted for the Ollama token-repeat failure, so one logical model call may entail two physical HTTP attempts.
4. Strictly checks the resulting shadow report, including source run ID, four network reads, exact local model/provider, no fallback, zero tool calls, no memory/admission/grants, no PhiOS qualification, no bot spawning, and zero remote inference.
5. If **and only if** the run succeeds, writes the local, redacted `qualification.json` and `qualification.sha256` under a newly created `.phibot/scout-qualification/scout-*` directory. The digest is domain-separated SHA-256, not a signature. No raw GitHub data, model prose, full prompt, or credentials are stored.

A passing output has the schema `phibot.scout-local-qualification.v0.1` and status `PASS_LOCAL_SCOUT_SHADOW`. It means a manually initiated, bounded public-read plus local Ollama reasoning exercise **completed on that host**. It is a self-reported local evidence pack, not independently witnessed.

A failing command returns nonzero and does not create a PASS receipt; inspect the local Ollama logs privately for model errors. Do not paste secrets or full verbose model traces into GitHub issues.

## What it does not prove

- It is **not** an actual remote cloud-hosted PhiBot process.
- It does **not** establish GitHub publisher source identity, physical model-call attempts, signed operator approval, PhiOS kernel isolation, CommonLine coordination, NBG memory safety in a running service, or unrestricted task autonomy.
- It does **not** replace the existing full `npm run qualify` lifecycle field qualification, which remains separately required.

**Capability is not authority. Field receipt is not deployment approval.**
