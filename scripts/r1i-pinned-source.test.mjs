import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { fixedPaths, githubGet, inspectPinnedSource } from './r1i-pinned-source.mjs';

const sha = (data, type = 'sha256') => createHash(type).update(data).digest('hex');
const PIN = 'a'.repeat(40);
const ORIGINAL = 'def normalize_label(value):\n'
  + '    """Collapse repeated whitespace in a display label."""\n'
  + '    return " ".join(value.split())\n';
const PREVIEW = 'def normalize_label(value):\n'
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

function sortObject(x) {
  if (Array.isArray(x)) return x.map(sortObject);
  if (x !== null && typeof x === 'object') {
    return Object.fromEntries(Object.keys(x).sort().map(k => [k, sortObject(x[k])]));
  }
  return x;
}
function canonical(x) { return JSON.stringify(sortObject(x)); }
function makePacket() {
  const packet = {
    schema: 'agentora.devboard.r1h.readonly-coding-task.v1',
    producer: 'Agentora',
    repository: 'MichaelWave369/Agentora',
    target_path: 'examples/development-board/r1h-demo-label.py',
    source_commit_sha_claim: PIN,
    task_id: 'R1H-TOY-LABEL-TYPE-GUARD',
    task_kind: 'INERT_SINGLE_FILE_SOURCE_PREVIEW_ONLY',
    provenance: 'GITHUB_ACTIONS_SELF_REPORTED_NOT_ATTESTED',
    source_before: ORIGINAL,
    source_after_preview: PREVIEW,
    source_before_sha256: sha(Buffer.from(ORIGINAL)),
    source_after_sha256: sha(Buffer.from(PREVIEW)),
    acceptance_checks: ACCEPTANCE,
    authority: {
      repository_writes: false, issue_creation: false, pr_creation: false,
      merge: false, deploy: false, approval_authenticated: false,
      phibot_executed: false,
    },
    disposition: 'PHIBOT_INSPECT_ONLY_NOT_A_WRITE_REQUEST',
  };
  return { ...packet,
    packet_sha256: sha('agentora.r1h.readonly-coding-task.v1\n' + canonical(packet)) };
}
function encode(packet = makePacket()) {
  return Buffer.from(canonical(packet)).toString('base64url');
}
function blobSha(raw) {
  return sha(Buffer.concat([Buffer.from('blob ' + raw.length + '\0'), raw]), 'sha1');
}
function mockRead({ source = ORIGINAL, commitSha = PIN, mainSha = PIN, reportedBlob,
                    responseType = 'file', filePath = 'examples/development-board/r1h-demo-label.py' } = {}) {
  const calls = [];
  const bytes = Buffer.from(source);
  const expected = fixedPaths(PIN);
  const objects = {
    [expected.commit]: { sha: commitSha, tree: { sha: 'b'.repeat(40) } },
    [expected.contents]: {
      path: filePath, name: 'r1h-demo-label.py',
      type: responseType, encoding: 'base64',
      sha: reportedBlob ?? blobSha(bytes),
      content: bytes.toString('base64'), size: bytes.length,
    },
    [expected.branch]: { name: 'main', commit: { sha: mainSha } },
  };
  return {
    calls,
    fetchJson: async requested => {
      calls.push(requested);
      assert.ok(Object.hasOwn(objects, requested), 'Never queried arbitrary URL: ' + requested);
      return objects[requested];
    },
  };
}

test('one exact source pin, Git blob SHA1, packet SHA256, and current main', async () => {
  const fixture = mockRead();
  const result = await inspectPinnedSource(encode(), { fetchJson: fixture.fetchJson });
  assert.equal(result.status, 'REMOTE_EXACT_SOURCE_VERIFIED_REVIEW_ONLY');
  assert.deepEqual(fixture.calls, Object.values(fixedPaths(PIN)));
  assert.equal(result.source_commit_verified_against_remote, true);
  assert.equal(result.source_bytes_match_packet, true);
  assert.equal(result.main_head_matches_pinned_commit, true);
  assert.equal(result.source_sha256, sha(ORIGINAL));
  assert.equal(result.source_blob_sha1, blobSha(Buffer.from(ORIGINAL)));
  assert.equal(result.github_https_gets, 3);
  for (const key of [
    'repository_writes', 'issue_created', 'pr_created', 'reality_gate_granted',
    'source_executed', 'model_invoked', 'operator_approval_authenticated',
    'eligible_for_merge', 'phibot_task_executed', 'independent_attestation',
  ]) assert.equal(result[key], false, key);
  assert.ok(!JSON.stringify(result).includes('def normalize_label'));
});

test('remote source mismatch refuses without hitting branch check', async () => {
  const fixture = mockRead({ source: ORIGINAL + '# attacker edit\n' });
  await assert.rejects(() => inspectPinnedSource(encode(), { fetchJson: fixture.fetchJson }),
    /PHIBOT_R1I_PINNED_SOURCE_DOES_NOT_MATCH_PACKET/);
  assert.deepEqual(fixture.calls, [fixedPaths(PIN).commit, fixedPaths(PIN).contents]);
});

test('wrong commit, wrong content type/path and blob mismatch refuse', async () => {
  const bads = [
    [mockRead({ commitSha: 'd'.repeat(40) }), /COMMIT_NOT_EXACT_PIN/],
    [mockRead({ responseType: 'dir' }), /CONTENT_RESPONSE_SCOPE/],
    [mockRead({ filePath: 'README.md' }), /CONTENT_RESPONSE_SCOPE/],
    [mockRead({ reportedBlob: 'e'.repeat(40) }), /GIT_BLOB_HASH_MISMATCH/],
  ];
  for (const [fixture, error] of bads) {
    await assert.rejects(() => inspectPinnedSource(encode(), {
      fetchJson: fixture.fetchJson,
    }), error);
  }
});

test('pinned source that is historical, not current main, is HELD', async () => {
  const fixture = mockRead({ mainSha: 'c'.repeat(40) });
  await assert.rejects(() => inspectPinnedSource(encode(), {
    fetchJson: fixture.fetchJson,
  }), /PHIBOT_R1I_MAIN_HAS_MOVED_REGENERATE_PACKET/);
  assert.equal(fixture.calls.length, 3);
});

test('malformed packet, extra authority or changed source refuses BEFORE GitHub GET', async () => {
  const invalid = [
    'definitely-not-base64!',
    encode({ ...makePacket(), repository: 'Example/Other' }),
    encode({ ...makePacket(), source_after_preview: 'eval("untrusted")' }),
    encode({ ...makePacket(), authority: { ...makePacket().authority, pr_creation: true } }),
  ];
  for (const payload of invalid) {
    let reads = 0;
    await assert.rejects(() => inspectPinnedSource(payload, {
      fetchJson: async () => { reads += 1; throw Error('SHOULD_NOT_READ'); },
    }), /PHIBOT_R1[HI]_/);
    assert.equal(reads, 0);
  }
});

test('GitHub GET function rejects arbitrary URLs and non-GET paths', async () => {
  for (const bad of [
    'https://attacker.example/path',
    '/repos/MichaelWave369/Other/contents/README.md',
    '/repos/MichaelWave369/Agentora/issues',
    '/repos/MichaelWave369/Agentora/contents/../../secrets',
    '/repos/MichaelWave369/Agentora/commits/' + 'z'.repeat(40),
    '/repos/MichaelWave369/Agentora/contents/README.md?ref=' + PIN,
  ]) await assert.rejects(() => githubGet(bad), /PHIBOT_R1I_/);
  assert.equal(Object.values(fixedPaths(PIN)).length, 3);
});

test('CLI never writes a passing report when packet is rejected', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'r1i-reject-'));
  try {
    const script = fileURLToPath(new URL('./r1i-pinned-source.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [script], {
      cwd: folder, encoding: 'utf8',
      env: { ...process.env, R1H_PACKET_B64: 'INVALID_SECRET_DO_NOT_LOG', GITHUB_TOKEN: 'TOKEN_DO_NOT_LOG' },
    });
    assert.equal(child.status, 2);
    assert.match(child.stderr, /^PHIBOT_R1I_[A-Z0-9_]+\n$/);
    assert.ok(!child.stderr.includes('INVALID_SECRET_DO_NOT_LOG'));
    assert.ok(!child.stdout.includes('TOKEN_DO_NOT_LOG'));
    assert.equal(existsSync(path.join(folder, 'phibot-r1i-pinned-source-review.json')), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('R1-I workflow is manual-only, restricted and metadata-only', () => {
  const yml = readFileSync('.github/workflows/r1i-pinned-source-verification.yml', 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /contents: read/);
  assert.match(yml, /persist-credentials: false/);
  assert.match(yml, /r1i-pinned-source\.mjs/);
  assert.match(yml, /phibot-r1i-pinned-source-review\.json/);
  assert.ok(!yml.includes('\n  push:') && !yml.includes('\n  pull_request:'));
  assert.ok(!yml.includes('repository_dispatch'));
  assert.ok(!yml.includes('curl -X POST'));
});
