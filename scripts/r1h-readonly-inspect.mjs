#!/usr/bin/env node
/**
 * PHIBOT R1-H: offline read-only review of ONE fixed Agentora toy code task.
 * NOT repo.steward.draft, NOT a Reality Gate grant, NOT a bot model execution.
 * No GitHub API calls, no remote writes, no code execution, no token access.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'agentora.devboard.r1h.readonly-coding-task.v1';
const DOMAIN = 'agentora.r1h.readonly-coding-task.v1\n';
const TARGET = 'examples/development-board/r1h-demo-label.py';
const BEFORE = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    return " ".join(value.split())\n';
const AFTER = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    if not isinstance(value, str):\n'
  + '        raise TypeError("label must be text")\n'
  + '    return " ".join(value.split())\n';
const ACCEPTANCE = [
  'REVIEW_ONLY_TOY_FIXTURE',
  'ADD_EXACT_TYPE_GUARD_WITHOUT_OTHER_CHANGES',
  'EXISTING_LABEL_NORMALIZATION_PRESERVED_FOR_STRINGS',
  'NO_CODE_EXECUTION_OR_GITHUB_WRITES',
];
const AUTHORITY = [
  'repository_writes', 'issue_creation', 'pr_creation', 'merge', 'deploy',
  'approval_authenticated', 'phibot_executed',
];
const FIELDS = [
  'schema', 'producer', 'repository', 'target_path', 'source_commit_sha_claim',
  'task_id', 'task_kind', 'provenance', 'source_before', 'source_after_preview',
  'source_before_sha256', 'source_after_sha256', 'acceptance_checks',
  'authority', 'disposition', 'packet_sha256',
];

function fail(condition, code) {
  if (!condition) throw new Error('PHIBOT_R1H_' + code);
}
function sha(data) {
  return createHash('sha256').update(data).digest('hex');
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keysExactly(value, names) {
  return record(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|');
}
function sortRecursive(value) {
  if (Array.isArray(value)) return value.map(sortRecursive);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(
    key => [key, sortRecursive(value[key])]
  ));
  return value;
}
function canonical(value) {
  return JSON.stringify(sortRecursive(value));
}

export function inspectAgentoraDraft(packet) {
  fail(keysExactly(packet, FIELDS), 'PACKET_FIELDS');
  fail(packet.schema === SCHEMA && packet.producer === 'Agentora', 'PRODUCER');
  fail(packet.repository === 'MichaelWave369/Agentora'
    && packet.target_path === TARGET, 'EXACT_TOY_SCOPE');
  fail(typeof packet.source_commit_sha_claim === 'string'
    && /^[0-9a-f]{40}$/.test(packet.source_commit_sha_claim), 'UNVERIFIED_SHA_FORMAT');
  fail(packet.task_id === 'R1H-TOY-LABEL-TYPE-GUARD'
    && packet.task_kind === 'INERT_SINGLE_FILE_SOURCE_PREVIEW_ONLY'
    && packet.provenance === 'GITHUB_ACTIONS_SELF_REPORTED_NOT_ATTESTED'
    && packet.disposition === 'PHIBOT_INSPECT_ONLY_NOT_A_WRITE_REQUEST', 'DECLARED_SCOPE');
  fail(packet.source_before === BEFORE
    && packet.source_after_preview === AFTER, 'EXACT_SOURCE_PREVIEW');
  fail(packet.source_before_sha256 === sha(Buffer.from(BEFORE, 'utf8'))
    && packet.source_after_sha256 === sha(Buffer.from(AFTER, 'utf8')),
    'SOURCE_DIGESTS');
  fail(Array.isArray(packet.acceptance_checks)
    && packet.acceptance_checks.length === ACCEPTANCE.length
    && ACCEPTANCE.every((v, index) => packet.acceptance_checks[index] === v),
    'ACCEPTANCE_SCOPE');
  fail(keysExactly(packet.authority, AUTHORITY)
    && AUTHORITY.every(v => packet.authority[v] === false), 'AUTHORITY_FORBIDDEN');
  fail(typeof packet.packet_sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(packet.packet_sha256), 'PACKET_DIGEST_FORMAT');
  const unsigned = { ...packet };
  delete unsigned.packet_sha256;
  fail(sha(Buffer.from(DOMAIN + canonical(unsigned), 'utf8'))
    === packet.packet_sha256, 'PACKET_DIGEST_MISMATCH');
  return Object.freeze({
    schema: 'phibot.r1h.readonly-draft-inspection.v1',
    status: 'INSPECTED_EXACT_TOY_SCOPE_REVIEW_ONLY',
    packet_sha256: packet.packet_sha256,
    repository: packet.repository,
    target_path: packet.target_path,
    source_commit_sha_claim: packet.source_commit_sha_claim,
    source_commit_verified_against_remote: false,
    source_identity_authenticated: false,
    model_invoked: false,
    source_executed: false,
    git_api_called: false,
    repository_writes: false,
    reality_gate_granted: false,
    operator_approval_authenticated: false,
    eligible_for_merge: false,
    phibot_task_executed: false,
  });
}

export function inspectBase64Url(encoded) {
  fail(typeof encoded === 'string' && encoded.length > 0
    && encoded.length <= 5500 && /^[A-Za-z0-9_-]+$/.test(encoded), 'ENCODING');
  const raw = Buffer.from(encoded, 'base64url');
  fail(raw.length > 0 && raw.length <= 4096
    && raw.toString('base64url') === encoded, 'CANONICAL_BASE64URL');
  let packet;
  try {
    packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new Error('PHIBOT_R1H_JSON_INVALID');
  }
  fail(canonical(packet) === raw.toString('utf8'), 'CANONICAL_JSON');
  return inspectAgentoraDraft(packet);
}

async function main() {
  // No input path, arbitrary URL, command, repo selector or external API.
  fail(process.argv.length === 2, 'NO_CLI_ARGUMENTS_ALLOWED');
  const encoded = process.env.R1H_PACKET_B64;
  const reviewed = inspectBase64Url(encoded);
  process.stdout.write(JSON.stringify(reviewed, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Only safe fixed refusal marker: never echo pasted payload or arbitrary text.
    process.stderr.write(
      (typeof error?.message === 'string'
       && /^PHIBOT_R1H_[A-Z0-9_]+$/.test(error.message)
       ? error.message : 'PHIBOT_R1H_REVIEW_REFUSED') + '\n'
    );
    process.exitCode = 2;
  });
}
