# R35A · PhiBot local queue to PhiMadaPrime Crew Deck

This is an **operator-mediated file bridge**, not a network listener or
live agent connection. It reads PhiBot's real **PHIBOT-25 persisted read-only
queue** and exports an allowlisted, narrow metadata-only snapshot. It is
not proof of active models or a complete software fleet.

## Local workflow (Windows 11, Node 22+)

In a local clone of MichaelWave369/PhiBot:

1. Update the repository, install dependencies and run npm test.
2. Set PHIBOT_REPO_ALLOWLIST to the explicit owner-scoped repositories
   you want to disclose; set PHIBOT_OWNER=MichaelWave369 if needed.
3. Run:

   npm run crew:export -- --ack-repository-disclosure

4. The command prints a newly created path under the ignored
   .phibot/work-queue/crew-exports directory. It does NOT print private
   repository names in the terminal result and does not upload the file.
5. Open PhiMadaPrime Mission Board > PhiBot Crew Deck. In R35 Local Queue
   Bridge, choose the JSON file in the manual file picker.

**Privacy:** the export intentionally contains the repository names from
your explicit queue allowlist. Inspect it before importing or sharing it.
Do not attach these exports to public GitHub issues, commits or Pages
deployment workflows. The PhiMadaPrime importer only displays jobs whose
repository identity matches its real public catalog; private/unrecognized
rows cause the import to fail, rather than being published.

## Schema and evidence

- schema: phibot.queue-crew-export.v1
- classification: LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED
- producer: MichaelWave369/phibot
- scope.origin: LOCAL_PERSISTED_READ_ONLY_QUEUE
- counts: exact counts of this local queue snapshot, maximum 100 jobs
- jobs: id, repository, capability, state, attempts, updatedAt, safe outcome

No untrusted GitHub source, full request inputs, raw model output,
tool receipts, credential material, or hidden queue data are exported.
A completed job proves a locally recorded **read-only observation**,
not an online worker, finished task, passing CI, merge, or deployment.
A leased job is not proof that a live process still exists.
No cryptographic signing or independent attestation is claimed.

## Security and verification

- Explicit acknowledgement flag required.
- No network, local server, background timers or shell execution.
- Records are validated against PhiBot's actual work-queue files and
  repository allowlist before export.
- Export is bounded to 100 jobs and 100 KB, written with exclusive
  creation permissions into an ignored local directory.
- No GitHub writes, Reality Gate grants, model calls, PR changes or
  autonomous authorization are introduced.
- npm test exercises safe projection, negative inputs, filesystem mode,
  empty queues, private payload exclusion, and real local queue records.
- Field check: export real local queue and manually import in
  PhiMadaPrime. CI fixture tests are not device acceptance.

## Next
R35B can add an optional operator-only authenticated loopback viewer,
after explicit threat review. Do not enable cross-origin access from
public GitHub Pages to a loopback service. R36 remains human-approved
task handoff through the existing Reality Gate.
