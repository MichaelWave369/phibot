#!/usr/bin/env node
/**
 * R1-J: manual cloud experiment on a FIXED, PUBLIC, toy Python change.
 * Prepare: strict R1-H packet + fresh R1-I pinned GitHub GETs, then write
 * only exact candidate source to an exclusive scratch directory.
 * Verify: check fresh immutable candidate bytes and bounded Docker test JSON.
 * This script never executes Python or shell; the manual Actions YAML owns the
 * one offline Docker run. Never creates PRs, grants or repository changes.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectBase64Url } from './r1h-readonly-inspect.mjs';
import { inspectPinnedSource, githubGet } from './r1i-pinned-source.mjs';

const WORKDIR = 'r1j-scratch';
const RESULT = 'r1j-container-tests.json';
const REPORT = 'phibot-r1j-code-validation.json';
const EXPECTED_SOURCE = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    if not isinstance(value, str):\n'
  + '        raise TypeError("label must be text")\n'
  + '    return " ".join(value.split())\n';
const EXPECTED_CHECKS = Object.freeze([
  'collapses_whitespace', 'preserves_single_word', 'preserves_empty_string',
  'rejects_integer_input', 'rejects_none_input',
]);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const hash = raw => createHash('sha256').update(raw).digest('hex');
const EXACT_SHA = hash(Buffer.from(EXPECTED_SOURCE, 'utf8'));
const SOURCE_LIMIT = 2048;
const RESULTS_LIMIT = 4096;

function requireCheck(value, code) {
  if (!value) throw new Error('PHIBOT_R1J_' + code);
}
function exactKeys(obj, fields) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj)
    && Object.keys(obj).sort().join('|') === [...fields].sort().join('|');
}
async function safeRead(filepath, max) {
  const stat = await lstat(filepath);
  requireCheck(stat.isFile() && !stat.isSymbolicLink()
    && stat.size > 0 && stat.size <= max, 'FILE_SCOPE');
  return readFile(filepath);
}

/** Prepare ONLY the fixed exact reviewed candidate; no GitHub writes. */
export async function prepareTrial(encoded, { remoteInspector = inspectPinnedSource,
                                            root = process.cwd() } = {}) {
  const prior = inspectBase64Url(encoded);
  requireCheck(prior.status === 'INSPECTED_EXACT_TOY_SCOPE_REVIEW_ONLY'
    && prior.repository_writes === false, 'PACKET_NOT_ELIGIBLE');
  const packet = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  requireCheck(packet.source_after_preview === EXPECTED_SOURCE
    && packet.source_after_sha256 === EXACT_SHA && SHA40.test(packet.source_commit_sha_claim),
    'PREVIEW_NOT_FIXED');

  // R1-I's caller supplies a narrowly-scoped GET-only reader.
  const remote = await remoteInspector(encoded);
  requireCheck(remote.status === 'REMOTE_EXACT_SOURCE_VERIFIED_REVIEW_ONLY'
    && remote.packet_sha256 === prior.packet_sha256
    && remote.source_commit_sha_claim === packet.source_commit_sha_claim
    && remote.source_sha256 === packet.source_before_sha256
    && remote.source_commit_verified_against_remote === true
    && remote.main_head_matches_pinned_commit === true
    && remote.source_bytes_match_packet === true
    && remote.repository_writes === false
    && remote.eligible_for_merge === false, 'REMOTE_PIN_NOT_VERIFIED');

  const directory = path.resolve(root, WORKDIR);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await writeFile(path.join(directory, 'candidate.py'), EXPECTED_SOURCE,
                  { flag: 'wx', mode: 0o644 });
  const manifest = {
    schema: 'phibot.r1j.fixed-scratch-manifest.v1',
    packet_sha256: prior.packet_sha256,
    source_commit_sha_claim: packet.source_commit_sha_claim,
    frozen_source_sha256: packet.source_before_sha256,
    candidate_sha256: EXACT_SHA,
    source_verified_against_github: true,
    main_head_verified_at_prepare: true,
    task_kind: 'EXACT_TOY_SOURCE_ONLY',
    git_writes: false,
    approval_authenticated: false,
    eligible_for_merge: false,
  };
  await writeFile(path.join(directory, 'manifest.json'),
                  JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}

export async function verifyTrial({ root = process.cwd() } = {}) {
  const folder = path.resolve(root, WORKDIR);
  const manifest = JSON.parse((await safeRead(path.join(folder, 'manifest.json'), RESULTS_LIMIT)).toString('utf8'));
  requireCheck(exactKeys(manifest, [
    'schema', 'packet_sha256', 'source_commit_sha_claim', 'frozen_source_sha256',
    'candidate_sha256', 'source_verified_against_github', 'main_head_verified_at_prepare',
    'task_kind', 'git_writes', 'approval_authenticated', 'eligible_for_merge',
  ]) && manifest.schema === 'phibot.r1j.fixed-scratch-manifest.v1'
    && SHA64.test(manifest.packet_sha256)
    && SHA40.test(manifest.source_commit_sha_claim)
    && SHA64.test(manifest.frozen_source_sha256)
    && manifest.candidate_sha256 === EXACT_SHA
    && manifest.source_verified_against_github === true
    && manifest.main_head_verified_at_prepare === true
    && manifest.task_kind === 'EXACT_TOY_SOURCE_ONLY'
    && manifest.git_writes === false
    && manifest.approval_authenticated === false
    && manifest.eligible_for_merge === false, 'MANIFEST_REFUSED');
  const raw = await safeRead(path.join(folder, 'candidate.py'), SOURCE_LIMIT);
  requireCheck(raw.equals(Buffer.from(EXPECTED_SOURCE)) && hash(raw) === manifest.candidate_sha256,
    'SOURCE_CHANGED_AFTER_REMOTE_CHECK');
  const result = JSON.parse((await safeRead(path.resolve(root, RESULT), RESULTS_LIMIT)).toString('utf8'));
  requireCheck(exactKeys(result, [
    'schema', 'status', 'source_sha256', 'test_count', 'checks',
    'model_invoked', 'github_writes', 'merge_authorized',
  ]) && result.schema === 'phibot.r1j.fixed-toy-tests.v1'
    && result.status === 'ALL_FIVE_FIXED_TESTS_PASS'
    && result.source_sha256 === EXACT_SHA
    && result.test_count === EXPECTED_CHECKS.length
    && Array.isArray(result.checks) && result.checks.length === EXPECTED_CHECKS.length
    && EXPECTED_CHECKS.every((c, index) => c === result.checks[index])
    && result.model_invoked === false
    && result.github_writes === false
    && result.merge_authorized === false, 'CONTAINER_TEST_RECEIPT_REFUSED');
  return Object.freeze({
    schema: 'phibot.r1j.disposable-code-validation.v1',
    status: 'BOUNDED_CONTAINER_TESTS_PASS_REVIEW_ONLY',
    packet_sha256: manifest.packet_sha256,
    source_commit_sha_claim: manifest.source_commit_sha_claim,
    frozen_source_sha256: manifest.frozen_source_sha256,
    candidate_sha256: EXACT_SHA,
    github_pinned_source_checked: true,
    github_main_head_checked_before_execution: true,
    container_test_count: EXPECTED_CHECKS.length,
    container_test_names: [...EXPECTED_CHECKS],
    container_execution_claim: 'EPHEMERAL_RUNNER_DOCKER_NONROOT_READONLY_OFFLINE_SELF_REPORTED',
    os_security_attested: false,
    untrusted_code_generalization_qualified: false,
    model_invoked: false,
    github_writes: false,
    pr_created: false,
    merge_authorized: false,
    reality_gate_granted: false,
    eligible_for_merge: false,
    human_review_required: true,
  });
}

async function main() {
  requireCheck(process.argv.length === 3
    && ['prepare', 'verify'].includes(process.argv[2]), 'CLI_SCOPE');
  if (process.argv[2] === 'prepare') {
    const token = process.env.GITHUB_TOKEN || '';
    const result = await prepareTrial(process.env.R1H_PACKET_B64, {
      remoteInspector: encoded => inspectPinnedSource(encoded, {
        fetchJson: p => githubGet(p, { token }),
      }),
    });
    console.log(JSON.stringify({
      status: 'EXACT_TOY_SOURCE_STAGED_NOT_EXECUTED',
      packet_sha256: result.packet_sha256,
      remote_pin_verified: true, repository_writes: false,
    }, null, 2));
    return;
  }
  const receipt = await verifyTrial();
  await writeFile(REPORT, JSON.stringify(receipt, null, 2) + '\n',
                  { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({
    status: receipt.status, container_test_count: receipt.container_test_count,
    packet_sha256: receipt.packet_sha256, eligible_for_merge: false,
    github_writes: false,
  }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print untrusted raw model/source, packet, GitHub API response or token.
    const code = typeof error?.message === 'string' && /^PHIBOT_R1J_[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'PHIBOT_R1J_REFUSED';
    console.error(code);
    process.exitCode = 2;
  });
}
