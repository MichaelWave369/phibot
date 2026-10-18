# PHIBOT-26: Local Queue Operations Dashboard

PHIBOT-26 adds an original, dependency-free **localhost-only** UI to view PHIBOT-25's persisted queue and execute explicitly requested, budgeted **read-only** jobs. This is not a GitHub Pages app, a deployed remote service, a scheduler, or a write-capable agent. The dashboard serves its own HTML/CSS/JavaScript and uses only Node's built-in HTTP server.

## Windows 11 quick start

From your locally cloned PhiBot repository, after merging PHIBOT-26, with Node 22+:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
$env:PHIBOT_QUEUE_MAX_JOBS = '2'
$env:PHIBOT_QUEUE_MAX_MS = '60000'
# Optional for public repo discovery; mandatory for private repo access and CI inspection.
$env:PHIBOT_GITHUB_TOKEN = '<retrieve a narrowly scoped READ token from local secure storage>'
npm.cmd run queue:dashboard
```

Open the exact address printed to your terminal, by default **http://127.0.0.1:43969/**. The default mode is **view-only**. You can inspect local job counts, statuses, lease expiry, last outcome, recent event receipts, per-pass budgets, and the worker lock. Browser refreshing/polling reads only **local queue metadata**. It never starts a job.

For explicit per-session operator controls, stop the service and restart it with:

```powershell
$env:PHIBOT_QUEUE_DASHBOARD_ACTIONS = '1'
npm.cmd run queue:dashboard
```

The UI then enables **Queue read-only job** and **Run one bounded pass**. Choose an explicitly allowlisted repository and either discovery or an existing draft PR's CI check inspection. For CI inspection, provide the precise PR number and 1–20 exact required checks. The queue only supports `repo.steward.discover` and `repo.steward.inspect`. Actions do not issue Reality Gate grants, perform model inference, execute local repository code, create branches, commit changes, merge or deploy.

Stop the dashboard with Ctrl+C. This process does **not** auto-install a Windows service, startup item, Task Scheduler job or background process.

## Security properties

- The server listens **only on 127.0.0.1**, with a port set by `PHIBOT_QUEUE_DASHBOARD_PORT` (default `43969`). No `0.0.0.0`, IPv6 wildcard, Starlink-facing or LAN listener is provided.
- Requests must arrive from loopback with the exact local **Host** value. This rejects remote clients and browser DNS-rebinding hostnames.
- All responses disable caching and set a strict **Content Security Policy** (same-origin scripts/styles/API only, no images, iframes, inline scripts, base URI or form actions). The dashboard uses no external fonts, scripts, trackers, dependencies or CDNs.
- Local **GET** endpoints serve static assets, a local queue metadata snapshot, and a short-lived session token. They **never** run jobs. The token is provided only when operator actions were explicitly enabled at startup.
- **POST** action requests require both a fresh in-memory random session token sent as `X-PhiBot-Session` and a matching exact `Origin` header. Cross-site request headers and unexpected routes/methods are rejected. There is no CORS opt-in.
- The server has exactly two POST actions: `/api/enqueue` (local job creation) and `/api/run-once` (operator-triggered queue read work). Inputs are size-bounded, schema-validated and scoped to the existing allowlist. Unknown input fields and all write capabilities are refused.
- One in-process activity guard and PHIBOT-25's filesystem worker lock prevent duplicate concurrent passes on the same local queue.
- All source/issue strings from GitHub are treated as untrusted. Only sanitized metadata is sent to the browser, and the JavaScript uses **textContent / DOM nodes**, not `innerHTML`, for dynamic data.
- A session token is **not** a multi-user authorization system; another local process running under the same user's rights can access the loopback interface. Use only on a trusted local Windows profile. Do not expose the port through a proxy, tunnel or port-forward.

## Budget and evidence

The UI reads **the same** queue files and budget settings as the CLI. A worker pass still attempts at most two jobs by default, with a maximum of five after explicit configuration. Failed read jobs have at most two attempts across operator invocations. Leases recover only under the existing expired/dead-local-PID rules. State and events are written to ignored `.phibot/work-queue/` files.

The dashboard shows metadata-only queue records and a bounded tail of recent transition events, not raw model text, complete GitHub source, secrets or tool inputs. The last observation digest is for correlation, **not** cryptographic authenticity or proof of correctness. No remote writes are performed by this UI.

## Qualification limits

Automated CI uses local Node HTTP requests, mocked read-only execution, and queue filesystem fixtures. It verifies the default view-only policy, localhost/origin/session restrictions, forbidden write jobs, execution budgets and metadata-only projections. A real Windows 11 browser and real GitHub/Ollama workflow are **not** claimed to be tested by that mocked suite. Field qualification should check Windows Defender Firewall, loopback binding, LAN denial, proper authorization for a real allowed repository, and interruption/recovery behavior.

**Ledger Above Ego. Local observability should increase trust, not quietly increase authority.**
