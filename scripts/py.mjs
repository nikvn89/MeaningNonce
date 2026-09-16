#!/usr/bin/env node
/**
 * Cross-platform Python launcher for the npm gate scripts.
 *
 * Why this exists: the gates were wired as `python3 scripts/...`. On Windows
 * `python3` is usually absent — what is present is the Microsoft Store execution
 * alias, which exits non-zero with "Python was not found". So `npm run check`,
 * the command README and TESTING.md tell a reviewer to run, failed at the first
 * gate on Windows. Hardcoding `python` instead just moves the breakage to a
 * default Ubuntu box, where `python` does not exist either.
 *
 * This probes the candidates for the current platform, keeps the first one that
 * actually reports a Python 3, and forwards argv plus the exit code unchanged.
 * No dependencies: node is already running, since npm invoked this.
 *
 *     node scripts/py.mjs scripts/check_contract_ast.py
 */
import { spawnSync } from 'node:child_process';

const CANDIDATES =
  process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];

function pick() {
  const tried = [];
  for (const [cmd, pre] of CANDIDATES) {
    let probe;
    try {
      probe = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', shell: false });
    } catch {
      tried.push(`${cmd}: not spawnable`);
      continue;
    }
    const out = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();
    // The Store alias exits non-zero and prints "Python was not found"; a real
    // interpreter exits 0 and prints its version. Require both.
    if (probe.status === 0 && /Python 3\./.test(out)) return { cmd, pre, version: out };
    tried.push(`${cmd}: ${probe.status === null ? 'missing' : out || `exit ${probe.status}`}`);
  }
  return { error: tried };
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/py.mjs <script.py> [args...]');
  process.exit(2);
}

const found = pick();
if (found.error) {
  console.error('No Python 3 interpreter found. Tried:');
  for (const line of found.error) console.error('  ' + line);
  console.error('');
  console.error('Install Python 3 and make sure it is on PATH, then run this again.');
  console.error('On Windows, "python3" is often only a Microsoft Store shortcut that');
  console.error('does not run anything; installing from python.org gives a real "python".');
  process.exit(127);
}

const run = spawnSync(found.cmd, [...found.pre, ...args], { stdio: 'inherit', shell: false });
if (run.error) {
  console.error(`Failed to run ${found.cmd}: ${run.error.message}`);
  process.exit(127);
}
process.exit(run.status ?? 1);
