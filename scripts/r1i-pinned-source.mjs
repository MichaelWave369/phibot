#!/usr/bin/env node
/**
 * R1-I: manually triggered, read-only, pinned GitHub source corroboration.
 * Consumer of R1-H's exact, public, inert toy packet. NEVER execute source,
 * invoke a model, issue a gate grant, create issues/PRs or modify repositories.
 *
 * Exactly THREE fixed GitHub REST GETs: claimed commit, file at exact commit,
 * and current main tip. No user-supplied repository/path/URL/network target.
 * Public source; GitHub Actions' read-only GITHUB_TOKEN is optional.
 */
import { createHash } from 'node:crypto';
import https from 'node:https';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inspectBase64Url } from './r1h-readonly-inspect.mjs';

const REPO = 'MichaelWave369/Agentora';
const TARGET = 'examples/development-board/r1h-demo-label.py';
const API = 'https://api.github.com';
const PIN = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_JSON = 64 * 1024;
const MAX_SOURCE = 2048;
const MAX_PACKET_B64 = 5500;
const OUT = 'phibot-r1i-pinned-source-review.json';

function requireCheck(value, code) {
  if (!value) throw new Error('PHIBOT_R1I_' + code);
}
function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function sha256(raw) { return createHash('sha256').update(raw).digest('hex'); }
function blobSha1(raw) {
  return createHash('sha1').update(Buffer.from('blob ' + raw.length + '\0')).update(raw).digest('hex');
}
function canonicalPayload(encoded) {
  requireCheck(typeof encoded === 'string' && encoded.length > 0
    && encoded.length <= MAX_PACKET_B64 && /^[A-Za-z0-9_-]+$/.test(encoded), 'PACKET_ENCODING');
  // This also checks ALL R1-H exact schema, source, approved toy data and no-authority fields.
  const prior = inspectBase64Url(encoded);
  requireCheck(prior.status === 'INSPECTED_EXACT_TOY_SCOPE_REVIEW_ONLY'
    && prior.repository_writes === false && prior.reality_gate_granted === false
    && prior.eligible_for_merge === false, 'R1H_REFUSED');
  const raw = Buffer.from(encoded, 'base64url');
  const packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  requireCheck(packet.repository === REPO && packet.target_path === TARGET
    && PIN.test(packet.source_commit_sha_claim)
    && SHA256.test(packet.source_before_sha256), 'SCOPE_REFUSED');
  return { packet, prior };
}

export function fixedPaths(sha) {
  requireCheck(typeof sha === 'string' && PIN.test(sha), 'PIN_FORMAT');
  return Object.freeze({
    commit: '/repos/MichaelWave369/Agentora/git/commits/' + sha,
    contents: '/repos/MichaelWave369/Agentora/contents/'
      + TARGET + '?ref=' + sha,
    branch: '/repos/MichaelWave369/Agentora/branches/main',
  });
}

/** Direct, bounded HTTPS GET. No redirect, POST, PUT, PATCH, proxies or arbitrary host. */
export async function githubGet(path, { token = '', timeoutMs = 8000 } = {}) {
  requireCheck(typeof path === 'string' && /^\/repos\/MichaelWave369\/Agentora\//.test(path)
    && path.length < 230 && !path.includes('..'), 'NETWORK_SCOPE');
  requireCheck(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000,
    'NETWORK_TIMEOUT_SCOPE');
  const safe = Object.values(fixedPaths(path.match(/[0-9a-f]{40}/)?.[0] || '0'.repeat(40)));
  requireCheck(safe.includes(path), 'NETWORK_ENDPOINT_DENIED');
  requireCheck(token === '' || (typeof token === 'string' && token.length <= 2048
    && !/[\r\n]/.test(token)), 'TOKEN_FORMAT');

  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'PhiBot-R1I-ReadOnly-Pin/0.1',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = https.get(API + path, { headers, timeout: timeoutMs }, res => {
      // Deliberately refuse redirects and never follow arbitrary Location headers.
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('PHIBOT_R1I_GITHUB_READ_REFUSED'));
        return;
      }
      const ctype = res.headers['content-type'] || '';
      if (!/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(ctype)) {
        res.resume();
        reject(new Error('PHIBOT_R1I_CONTENT_TYPE'));
        return;
      }
      const stated = res.headers['content-length'];
      if (stated && (!/^[0-9]+$/.test(stated) || Number(stated) > MAX_JSON)) {
        res.resume();
        reject(new Error('PHIBOT_R1I_RESPONSE_TOO_LARGE'));
        return;
      }
      let n = 0;
      const parts = [];
      res.on('data', part => {
        n += part.length;
        if (n > MAX_JSON) {
          req.destroy(new Error('PHIBOT_R1I_RESPONSE_TOO_LARGE'));
          return;
        }
        parts.push(part);
      });
      res.on('end', () => {
        try {
          requireCheck(n > 0, 'EMPTY_RESPONSE');
          const decoded = new TextDecoder('utf-8', { fatal: true })
            .decode(Buffer.concat(parts));
          resolve(JSON.parse(decoded));
        } catch {
          reject(new Error('PHIBOT_R1I_INVALID_JSON'));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('PHIBOT_R1I_NETWORK_TIMEOUT')));
    req.on('error', reject);
  });
}

export async function inspectPinnedSource(encoded, { fetchJson = githubGet } = {}) {
  const { packet, prior } = canonicalPayload(encoded);
  const sha = packet.source_commit_sha_claim;
  const paths = fixedPaths(sha);
  // Strict sequential requests; no unpinned branch-based content downloads.
  const commit = await fetchJson(paths.commit);
  requireCheck(isRecord(commit) && commit.sha === sha
    && isRecord(commit.tree)
    && PIN.test(commit.tree.sha), 'COMMIT_NOT_EXACT_PIN');

  const file = await fetchJson(paths.contents);
  requireCheck(isRecord(file) && file.type === 'file' && file.path === TARGET
    && file.name === 'r1h-demo-label.py'
    && file.encoding === 'base64' && PIN.test(file.sha)
    && typeof file.content === 'string', 'CONTENT_RESPONSE_SCOPE');
  // GitHub base64 contents may contain line breaks, but must be otherwise canonical.
  const content = file.content.replace(/\n/g, '');
  requireCheck(content.length > 0 && content.length <= MAX_SOURCE * 2
    && /^[A-Za-z0-9+/]+={0,2}$/.test(content), 'CONTENT_BASE64');
  const raw = Buffer.from(content, 'base64');
  requireCheck(raw.length > 0 && raw.length <= MAX_SOURCE
    && raw.toString('base64') === content, 'CONTENT_BYTES_ENCODING');
  requireCheck(file.size === raw.length && file.sha === blobSha1(raw),
    'GIT_BLOB_HASH_MISMATCH');
  requireCheck(raw.equals(Buffer.from(packet.source_before, 'utf8'))
    && sha256(raw) === packet.source_before_sha256,
    'PINNED_SOURCE_DOES_NOT_MATCH_PACKET');

  const branch = await fetchJson(paths.branch);
  requireCheck(isRecord(branch) && branch.name === 'main'
    && isRecord(branch.commit) && PIN.test(branch.commit.sha), 'BRANCH_UNVERIFIED');
  // Fail closed if source is correct historically but branch moved since handoff.
  requireCheck(branch.commit.sha === sha, 'MAIN_HAS_MOVED_REGENERATE_PACKET');

  return Object.freeze({
    schema: 'phibot.r1i.remote-pinned-source-review.v1',
    status: 'REMOTE_EXACT_SOURCE_VERIFIED_REVIEW_ONLY',
    packet_sha256: prior.packet_sha256,
    repository: REPO,
    target_path: TARGET,
    source_commit_sha_claim: sha,
    source_commit_verified_against_remote: true,
    main_head_matches_pinned_commit: true,
    source_bytes_match_packet: true,
    source_blob_sha1: file.sha,
    source_sha256: sha256(raw),
    github_https_gets: 3,
    github_api_metadata_observed: true,
    independent_attestation: false,
    agent_identity_authenticated: false,
    operator_approval_authenticated: false,
    model_invoked: false,
    source_executed: false,
    repository_writes: false,
    issue_created: false,
    pr_created: false,
    reality_gate_granted: false,
    eligible_for_merge: false,
    phibot_task_executed: false,
    human_review_required: true,
  });
}

async function main() {
  requireCheck(process.argv.length === 2, 'NO_CLI_ARGUMENTS_ALLOWED');
  const encoded = process.env.R1H_PACKET_B64;
  // Token is held by the workflow's already read-only scoped GitHub Actions identity.
  const token = process.env.GITHUB_TOKEN || '';
  const result = await inspectPinnedSource(encoded, {
    fetchJson: path => githubGet(path, { token }),
  });
  await writeFile(OUT, JSON.stringify(result, null, 2) + '\n', {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  process.stdout.write(JSON.stringify({
    status: result.status,
    packet_sha256: result.packet_sha256,
    remote_commit_verified: result.source_commit_verified_against_remote,
    source_bytes_match_packet: result.source_bytes_match_packet,
    main_head_matches_pinned_commit: result.main_head_matches_pinned_commit,
    repository_writes: false,
    eligible_for_merge: false,
  }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never echo raw source, API payload, credentials or user workflow inputs.
    const code = typeof error?.message === 'string' && /^PHIBOT_R1I_[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'PHIBOT_R1I_REFUSED';
    process.stderr.write(code + '\n');
    process.exitCode = 2;
  });
}
