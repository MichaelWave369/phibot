import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectAgentoraDraft, inspectBase64Url } from './r1h-readonly-inspect.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const original = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    return " ".join(value.split())\n';
const proposed = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    if not isinstance(value, str):\n'
  + '        raise TypeError("label must be text")\n'
  + '    return " ".join(value.split())\n';
const acceptance = [
  'REVIEW_ONLY_TOY_FIXTURE', 'ADD_EXACT_TYPE_GUARD_WITHOUT_OTHER_CHANGES',
  'EXISTING_LABEL_NORMALIZATION_PRESERVED_FOR_STRINGS',
  'NO_CODE_EXECUTION_OR_GITHUB_WRITES',
];
const zeroAuthority = {
  repository_writes: false, issue_creation: false, pr_creation: false,
  merge: false, deploy: false, approval_authenticated: false,
  phibot_executed: false,
};
function canonical(input) {
  if (Array.isArray(input)) return JSON.stringify(input.map(x => JSON.parse(canonical(x))));
  if (input !== null && typeof input === 'object') {
    return JSON.stringify(Object.fromEntries(Object.keys(input).sort().map(
      k => [k, JSON.parse(canonical(input[k]))]
    )));
  }
  return JSON.stringify(input);
}
function packet() {
  const v = {
    schema: 'agentora.devboard.r1h.readonly-coding-task.v1',
    producer: 'Agentora',
    repository: 'MichaelWave369/Agentora',
    target_path: 'examples/development-board/r1h-demo-label.py',
    source_commit_sha_claim: 'a'.repeat(40),
    task_id: 'R1H-TOY-LABEL-TYPE-GUARD',
    task_kind: 'INERT_SINGLE_FILE_SOURCE_PREVIEW_ONLY',
    provenance: 'GITHUB_ACTIONS_SELF_REPORTED_NOT_ATTESTED',
    source_before: original,
    source_after_preview: proposed,
    source_before_sha256: sha(Buffer.from(original)),
    source_after_sha256: sha(Buffer.from(proposed)),
    acceptance_checks: acceptance,
    authority: zeroAuthority,
    disposition: 'PHIBOT_INSPECT_ONLY_NOT_A_WRITE_REQUEST',
  };
  return { ...v,
    packet_sha256: sha('agentora.r1h.readonly-coding-task.v1\n' + canonical(v)) };
}

test('pure offline consumer accepts exact toy and explicitly withholds permission', () => {
  const p = packet();
  const verdict = inspectAgentoraDraft(p);
  assert.equal(verdict.status, 'INSPECTED_EXACT_TOY_SCOPE_REVIEW_ONLY');
  assert.equal(verdict.packet_sha256, p.packet_sha256);
  assert.equal(verdict.phibot_task_executed, false);
  assert.equal(verdict.git_api_called, false);
  assert.equal(verdict.source_commit_verified_against_remote, false);
  assert.equal(verdict.repository_writes, false);
  assert.equal(verdict.reality_gate_granted, false);
  assert.equal(verdict.eligible_for_merge, false);
  const encoded = Buffer.from(canonical(p)).toString('base64url');
  assert.deepEqual(inspectBase64Url(encoded), verdict);
});

test('CLI output is metadata-only and has no model/runtime side effects', () => {
  const p = packet();
  const encoded = Buffer.from(canonical(p)).toString('base64url');
  const json = execFileSync(process.execPath, ['scripts/r1h-readonly-inspect.mjs'], {
    encoding: 'utf8', env: { ...process.env, R1H_PACKET_B64: encoded },
  });
  const result = JSON.parse(json);
  assert.equal(result.status, 'INSPECTED_EXACT_TOY_SCOPE_REVIEW_ONLY');
  assert.equal(result.git_api_called, false);
  assert.equal(result.repository_writes, false);
  assert.ok(!json.includes('def normalize_label'));
  assert.ok(!json.includes('R1H_PACKET_B64'));
});

test('all authority escalation and field mutations are rejected', () => {
  for (const key of Object.keys(zeroAuthority)) {
    const p = packet(); p.authority = { ...p.authority, [key]: true };
    assert.throws(() => inspectAgentoraDraft(p), /^Error: PHIBOT_R1H_/);
  }
  for (const [key, value] of [
    ['target_path', '../app/secrets.py'],
    ['repository', 'MichaelWave369/PhiBot'],
    ['source_commit_sha_claim', 'x'.repeat(40)],
    ['source_before', 'evil\n'],
    ['source_after_preview', 'import os\nos.system("rm -rf .")\n'],
    ['packet_sha256', 'f'.repeat(64)],
    ['disposition', 'AUTHORIZED'],
    ['issueNumber', 7],
    ['replacement', 'text'],
  ]) {
    const p = packet(); p[key] = value;
    assert.throws(() => inspectAgentoraDraft(p), /^Error: PHIBOT_R1H_/);
  }
});

test('base64url / JSON corruption is refused; raw payload is not logged', () => {
  const packetBytes = Buffer.from(canonical(packet()));
  for (const candidate of ['', '$', 'abc+', '==', 'a'.repeat(6000),
                            Buffer.from('{"bad":true}').toString('base64url')]) {
    assert.throws(() => inspectBase64Url(candidate), /^Error: PHIBOT_R1H_/);
  }
  const notCanonical = Buffer.from(JSON.stringify(packet(), null, 2)).toString('base64url');
  assert.throws(() => inspectBase64Url(notCanonical), /CANONICAL_JSON/);
  const failure = spawnSync(process.execPath, ['scripts/r1h-readonly-inspect.mjs'], {
    encoding: 'utf8', env: { ...process.env, R1H_PACKET_B64: 'BAD_SECRET_VALUE' },
  });
  assert.equal(failure.status, 2);
  assert.ok(failure.stderr.includes('PHIBOT_R1H_'));
  assert.ok(!failure.stderr.includes('BAD_SECRET_VALUE'));
  assert.equal(failure.stdout, '');
});

test('workflow is manual only and never requests write permissions', () => {
  const workflow = readFileSync('.github/workflows/r1h-readonly-inspection.yml', 'utf8');
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(workflow.includes('contents: read'));
  assert.ok(workflow.includes('persist-credentials: false'));
  assert.ok(workflow.includes('R1H_PACKET_B64:'));
  assert.ok(workflow.includes('r1h-readonly-inspect.mjs'));
  assert.ok(!workflow.includes('\n  push:'));
  assert.ok(!workflow.includes('\n  pull_request:'));
  assert.ok(!workflow.includes('gh api'));
  assert.ok(!workflow.includes('repository_dispatch'));
});
