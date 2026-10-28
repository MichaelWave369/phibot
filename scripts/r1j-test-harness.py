#!/usr/bin/env python3
"""R1-J fixed tests for EXACTLY ONE allowlisted toy change.

Runs solely inside a disposable offline, read-only, non-root container.
No subprocesses, shell, network, repo writes, arbitrary code/task input.
This is NOT permission to execute general user/model supplied source.
"""
import hashlib
import json
from pathlib import Path
import runpy
import sys

EXPECTED_CHECKS = (
    "collapses_whitespace",
    "preserves_single_word",
    "preserves_empty_string",
    "rejects_integer_input",
    "rejects_none_input",
)
SOURCE_EXPECTED = (
    'def normalize_label(value):\n'
    '    """Collapse repeated whitespace in a display label."""\n'
    '    if not isinstance(value, str):\n'
    '        raise TypeError("label must be text")\n'
    '    return " ".join(value.split())\n'
)


def main():
    if len(sys.argv) != 2 or sys.argv[1] != "/work/candidate.py":
        raise ValueError("UNEXPECTED_TEST_INPUT")
    path = Path(sys.argv[1])
    raw = path.read_bytes()
    if raw != SOURCE_EXPECTED.encode("utf-8") or len(raw) > 2048:
        raise ValueError("UNAPPROVED_SOURCE_BYTES")
    expected_hash = hashlib.sha256(SOURCE_EXPECTED.encode("utf-8")).hexdigest()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("HASH_MISMATCH")
    # Exact allowlisted bytes are checked BEFORE execution, not merely syntax.
    source = runpy.run_path(str(path), run_name="__r1j_candidate__")
    normalizer = source.get("normalize_label")
    if not callable(normalizer):
        raise ValueError("NORMALIZER_MISSING")

    if normalizer("  two \t three \n words  ") != "two three words":
        raise ValueError(EXPECTED_CHECKS[0])
    if normalizer("hello") != "hello":
        raise ValueError(EXPECTED_CHECKS[1])
    if normalizer("") != "":
        raise ValueError(EXPECTED_CHECKS[2])
    for bad, label in ((123, EXPECTED_CHECKS[3]), (None, EXPECTED_CHECKS[4])):
        try:
            normalizer(bad)
        except TypeError as exc:
            if str(exc) != "label must be text":
                raise ValueError(label + "_MESSAGE") from exc
        else:
            raise ValueError(label + "_NOT_REJECTED")

    print(json.dumps({
        "schema": "phibot.r1j.fixed-toy-tests.v1",
        "status": "ALL_FIVE_FIXED_TESTS_PASS",
        "source_sha256": expected_hash,
        "test_count": len(EXPECTED_CHECKS),
        "checks": list(EXPECTED_CHECKS),
        "model_invoked": False,
        "github_writes": False,
        "merge_authorized": False,
    }, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError):
        # No source exception text, environment details or arbitrary traceback.
        print(json.dumps({"status": "HELD", "reason": "FIXED_TESTS_FAILED"}))
        raise SystemExit(2)
