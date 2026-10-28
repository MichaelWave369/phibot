import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareTrial, verifyTrial } from './r1j-trial.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const PIN = 'a'.repeat(40);
const ORIGINAL = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    return " ".join(value.split())\n';
const CANDIDATE = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    if not isinstance(value, str):\n'
  + '        raise TypeError("label must be text")\n'
  + '    return " ".join(value.split())\n';
const CHECKS = [
  'collapses_whitespace', 'preserves_single_word', 'preserves_empty_string',
  'rejects_integer_input', 'rejects_none_input',
];
function canonical(data) {
  if (Array.isArray(data)) return JSON.stringify(data.map(x => JSON.parse(canonical(x))));
  if (data !== null && typeof data === 'object') {
    return JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(
      key => [key, JSON.parse(canonical(data[key]))]
    )));
  }
  return JSON.stringify(data);
}
function packet() {
  const p = {
    schema: 'agentora.devboard.r1h.readonly-coding-task.v1',
    producer: 'Agentora', repository: 'MichaelWave369/Agentora',
    target_path: 'examples/development-board/r1h-demo-label.py',
    source_commit_sha_claim: PIN, task_id: 'R1H-TOY-LABEL-TYPE-GUARD',
    task_kind: 'INERT_SINGLE_FILE_SOURCE_PREVIEW_ONLY',
    provenance: 'GITHUB_ACTIONS_SELF_REPORTED_NOT_ATTESTED',
    source_before: ORIGINAL, source_after_preview: CANDIDATE,
    source_before_sha256: hash(Buffer.from(ORIGINAL)),
    source_after_sha256: hash(Buffer.from(CANDIDATE)),
    acceptance_checks: [
      'REVIEW_ONLY_TOY_FIXTURE',
      'ADD_EXACT_TYPE_GUARD_WITHOUT_OTHER_CHANGES',
      'EXISTING_LABEL_NORMALIZATION_PRESERVED_FOR_STRINGS',
      'NO_CODE_EXECUTION_OR_GITHUB_WRITES',
    ],
    authority: {
      repository_writes: false, issue_creation: false, pr_creation: false,
      merge: false, deploy: false, approval_authenticated: false, phibot_executed: false,
    },
    disposition: 'PHIBOT_INSPECT_ONLY_NOT_A_WRITE_REQUEST',
  };
  return { ...p,
    packet_sha256: hash('agentora.r1h.readonly-coding-task.v1\n' + canonical(p)) };
}
const encode = p => Buffer.from(canonical(p)).toString('base64url');
function remote(p) {
  return {
    status: 'REMOTE_EXACT_SOURCE_VERIFIED_REVIEW_ONLY',
    packet_sha256: p.packet_sha256, source_commit_sha_claim: PIN,
    source_sha256: p.source_before_sha256,
    source_commit_verified_against_remote: true, main_head_matches_pinned_commit: true,
    source_bytes_match_packet: true, repository_writes: false, eligible_for_merge: false,
  };
}
function output(overrides = {}) {
  return {
    schema: 'phibot.r1j.fixed-toy-tests.v1',
    status: 'ALL_FIVE_FIXED_TESTS_PASS',
    source_sha256: hash(CANDIDATE), test_count: 5, checks: CHECKS,
    model_invoked: false, github_writes: false, merge_authorized: false,
    ...overrides,
  };
}
async function tempRun(t, fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'phibot-r1j-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return fn(root);
}
async function stage(root) {
  const p = packet();
  const inspected = await prepareTrial(encode(p), {
    root, remoteInspector: async () => remote(p),
  });
  return inspected;
}
async function testFile(root, data = output()) {
  await writeFile(path.join(root, 'r1j-container-tests.json'),
                  JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
}

test('valid exact R1-H packet and R1-I observation stage only fixed candidate', t =>
  tempRun(t, async root => {
    const staged = await stage(root);
    assert.equal(staged.candidate_sha256, hash(CANDIDATE));
    assert.equal(staged.git_writes, false);
    assert.equal(staged.eligible_for_merge, false);
    assert.equal(await readFile(path.join(root, 'r1j-scratch/candidate.py'), 'utf8'), CANDIDATE);
    assert.deepEqual((await readdir(path.join(root, 'r1j-scratch'))).sort(), [
      'candidate.py', 'manifest.json',
    ]);
    await testFile(root);
    const result = await verifyTrial({ root });
    assert.equal(result.status, 'BOUNDED_CONTAINER_TESTS_PASS_REVIEW_ONLY');
    assert.equal(result.container_test_count, 5);
    assert.deepEqual(result.container_test_names, CHECKS);
    for (const flag of [
      'github_writes', 'pr_created', 'merge_authorized', 'reality_gate_granted',
      'eligible_for_merge', 'model_invoked', 'os_security_attested',
      'untrusted_code_generalization_qualified',
    ]) assert.equal(result[flag], false, flag);
    assert.equal(result.github_pinned_source_checked, true);
  })
);

test('all invalid packets refuse before source write or remote GET', t =>
  tempRun(t, async root => {
    for (const p of [
      { ...packet(), source_after_preview: 'print("bad")\n' },
      { ...packet(), source_commit_sha_claim: 'z'.repeat(40) },
      { ...packet(), authority: { ...packet().authority, pr_creation: true } },
    ]) {
      let calls = 0;
      await assert.rejects(() => prepareTrial(encode(p), {
        root, remoteInspector: async () => { calls += 1; return remote(p); },
      }), /PHIBOT_R1[HJ]_/);
      assert.equal(calls, 0);
    }
    assert.deepEqual(await readdir(root), []);
  })
);

test('remote pin mismatch, stale main, wrong packet digest refuse without staging', t =>
  tempRun(t, async root => {
    const p = packet();
    for (const override of [
      { main_head_matches_pinned_commit: false },
      { source_bytes_match_packet: false },
      { source_sha256: 'f'.repeat(64) },
      { packet_sha256: '0'.repeat(64) },
      { eligible_for_merge: true },
    ]) {
      await assert.rejects(() => prepareTrial(encode(p), {
        root, remoteInspector: async () => ({ ...remote(p), ...override }),
      }), /PHIBOT_R1J_REMOTE_PIN_NOT_VERIFIED/);
    }
    assert.deepEqual(await readdir(root), []);
  })
);

test('no duplicate staging, no overwrites', t => tempRun(t, async root => {
  await stage(root);
  const unchanged = await readFile(path.join(root, 'r1j-scratch/candidate.py'), 'utf8');
  await assert.rejects(() => stage(root), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(root, 'r1j-scratch/candidate.py'), 'utf8'), unchanged);
}));

test('candidate tampering after pin verification refuses', t => tempRun(t, async root => {
  await stage(root);
  await testFile(root);
  await writeFile(path.join(root, 'r1j-scratch/candidate.py'), CANDIDATE + '# injected\n');
  await assert.rejects(() => verifyTrial({ root }), /PHIBOT_R1J_SOURCE_CHANGED_AFTER_REMOTE_CHECK/);
}));

test('forged test outcome, missing acceptance or escalated flags refuse', t =>
  tempRun(t, async root => {
    await stage(root);
    for (const patch of [
      { status: 'HELD' }, { test_count: 4 },
      { checks: CHECKS.slice(1) }, { checks: [...CHECKS.slice(0, 4), 'evil_check'] },
      { github_writes: true }, { merge_authorized: true },
      { source_sha256: '0'.repeat(64) }, { extra: 'model instructions' },
    ]) {
      const file = path.join(root, 'r1j-container-tests.json');
      await writeFile(file, JSON.stringify(output(patch)) + '\n');
      await assert.rejects(() => verifyTrial({ root }), /PHIBOT_R1J_CONTAINER_TEST_RECEIPT_REFUSED/);
    }
  })
);

test('tampered manifest and missing container receipt refuse', t => tempRun(t, async root => {
  await stage(root);
  await assert.rejects(() => verifyTrial({ root }), { code: 'ENOENT' });
  await testFile(root);
  const file = path.join(root, 'r1j-scratch/manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.eligible_for_merge = true;
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(() => verifyTrial({ root }), /PHIBOT_R1J_MANIFEST_REFUSED/);
}));

test('bad CLI input fails with bounded marker and no result file', t => tempRun(t, async root => {
  const cmd = fileURLToPath(new URL('./r1j-trial.mjs', import.meta.url));
  const proc = spawnSync(process.execPath, [cmd, 'verify'], {
    encoding: 'utf8', cwd: root, env: {
      PATH: process.env.PATH || '', R1H_PACKET_B64: 'SENSITIVE_BUT_FAKE',
    },
  });
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /PHIBOT_R1J_[A-Z_]+/);
  assert.ok(!proc.stderr.includes('SENSITIVE_BUT_FAKE'));
  assert.ok(!(await readdir(root)).includes('phibot-r1j-code-validation.json'));
}));

test('manual workflow keeps Docker offline, nonroot, bounded and no repo writes', () => {
  const workflow = readFileSync('.github/workflows/r1j-disposable-code-validation.yml', 'utf8');
  for (const required of [
    'workflow_dispatch:', 'contents: read', 'persist-credentials: false',
    '--network none', '--read-only', '--user 65534:65534', '--cap-drop ALL',
    '--security-opt no-new-privileges', '--pids-limit 64', '--memory 256m',
    '--cpus 1', '--pull=never', '--mount "type=bind', 'readonly"',
    'python -I -S -B', 'r1j-trial.mjs prepare', 'r1j-trial.mjs verify',
    'phibot-r1j-code-validation.json',
  ]) assert.ok(workflow.includes(required), required);
  for (const forbidden of ['\n  push:', '\n  pull_request:', '--privileged', '--network host',
                           'repository_dispatch', 'curl -X POST']) {
    assert.ok(!workflow.includes(forbidden), forbidden);
  }
});
