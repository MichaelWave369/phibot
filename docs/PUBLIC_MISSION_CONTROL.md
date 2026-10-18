# PhiBot Mission Control: React GitHub Pages showcase

This is the **public, static React experience** for PhiBot Mission Control.

## Public and local are different by design

The Pages frontend under `site/` has a **visibly labeled sample dataset**. Visitors can browse demonstration jobs, filter the queue, enqueue a demo item, trigger one simulated batch, read illustrative receipts, and explore PhiBot's permission boundaries. All of that runs only in **temporary React state in the browser**. Refreshing the page restores the original sample. The page intentionally contains:

- **No tokens or credentials**, local paths, personal operator data, telemetry endpoints, CORS bridge or backend.
- **No remote API calls**, including no GitHub API, no localhost fetch and no Ollama calls.
- **No working real GitHub mutations**, Reality Gate grants, source patch approvals, scheduling, branch creation, merging or deployments.
- **No real queue-state publishing**. The private local `.phibot/` directory is not copied into the site.

This is a **companion** to the separate operator-only Node dashboard in `scripts/queue-dashboard/`, which listens on `127.0.0.1` and remains unavailable from public Pages.

## Build locally

From the repo root on Node 22+:

```bash
cd site
npm install
npm run test:contract
npm run dev
```

Vite prints a local preview URL. For a release build:

```bash
npm run build
npm run preview
```

The site is a standard React + Vite static app, configured with `base: "/phibot/"` for GitHub Pages project hosting. It has original CSS, no downloaded fonts or stock graphics, and no runtime dependency on GitHub services.

## Enable live GitHub Pages

The workflow `.github/workflows/pages.yml`:

1. Builds and tests the site for pull requests, but **never deploys unmerged PRs**.
2. Builds the static project and uploads the Pages artifact on changes merged into `main`.
3. Deploys the artifact through the repository's **github-pages environment** with the limited `pages: write` and `id-token: write` job permissions.

**One-time repository setting may be needed:** open **Settings → Pages → Build and deployment → Source**, and choose **GitHub Actions**. The public URL should then be:

**https://michaelwave369.github.io/phibot/**

This is the intended URL, not evidence the site has already deployed. Confirm a successful **PhiBot React Pages** deployment in GitHub Actions and open the page before calling it live.

## What remains local

To control actual queued observations on the Windows PC:

```powershell
git pull origin main
npm.cmd install
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
npm.cmd run queue:dashboard
```

The local dashboard starts view-only. See [LOCAL_QUEUE_DASHBOARD.md](LOCAL_QUEUE_DASHBOARD.md) for enabling explicit read-only operator actions. Do not publish, tunnel or port-forward the local dashboard to make it accessible from the public React site.

## Contract tests and limitations

`npm run test:contract` checks the Pages project subpath, visible demo labeling, browser-only state, and absence of network/API access in the React source. The separate **PhiBot React Pages** workflow runs the production build to validate bundling. This does not validate any real agent functionality or a live Windows/Ollama field connection. GitHub Pages availability also depends on repository settings and the deployment job's success.

**Ledger Above Ego. Public visibility is not remote operator authority.**
