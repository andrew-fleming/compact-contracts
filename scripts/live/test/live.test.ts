import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify } from '../LiveOrchestrator.ts';
import { round2Report } from '../paths.ts';
import { RunLock } from '../RunLock.ts';
import { resolvePlan } from '../targets.ts';

/**
 * Dry unit tests for the pure pieces of the live orchestrator (plan resolution,
 * target listing, flake classification, report naming) plus the run lock, which
 * is filesystem-only. Nothing here touches docker, the node, or the artifact
 * tree.
 */

/** `liveCategories()` reads `src/`, so every case passes this explicitly to keep
 * the tests independent of the on-disk category set. */
const CATEGORIES = ['multisig', 'token'] as const;

describe('resolvePlan', () => {
  it('scopes to the integration target', () => {
    const resolution = resolvePlan(['integration'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    // 'integration' is deliberately NOT in CATEGORIES: it is not a `src/`
    // category, so the guard has to match it before the category branch or the
    // run falls through to the unscoped path (the original INV-10 bug).
    expect(resolution.plan.targets).toStrictEqual([
      { name: 'integration', project: 'integration-live', defaultFilters: [] },
    ]);
    expect(resolution.plan.integration).toBe(true);
    expect(resolution.plan.skipped).toStrictEqual([]);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
  });

  it('passes trailing args after the integration target as file filters', () => {
    const resolution = resolvePlan(
      ['integration', 'confidentialFungibleToken'],
      CATEGORIES,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual([
      'confidentialFungibleToken',
    ]);
    expect(resolution.plan.integration).toBe(true);
  });

  it('scopes to a live-ready unit category', () => {
    const resolution = resolvePlan(['multisig'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.integration).toBe(false);
    expect(resolution.plan.skipped).toStrictEqual([]);
  });

  it('passes trailing args after a category as file filters', () => {
    const resolution = resolvePlan(['multisig', 'Forwarder'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual(['Forwarder']);
  });

  it('rejects a category that is not live-ready yet', () => {
    const resolution = resolvePlan(['token'], CATEGORIES);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain("'token' is not live-ready yet");
    expect(resolution.message).toContain('Ready categories: multisig');
    expect(resolution.message).toContain("'integration'");
  });

  it('runs only live-ready categories when unscoped, reporting the rest', () => {
    const resolution = resolvePlan([], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.skipped).toStrictEqual(['token']);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
    expect(resolution.plan.integration).toBe(false);
  });

  it('treats a non-category first arg as a file filter over every target', () => {
    const resolution = resolvePlan(['someFileFilter'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.fileFilters).toStrictEqual(['someFileFilter']);
    expect(resolution.plan.skipped).toStrictEqual(['token']);
  });
});

describe('RunLock', () => {
  /** Out of every kernel's pid range, so `process.kill(pid, 0)` can only report
   * "no such process" — a stale lock without having to kill a real one. */
  const DEAD_PID = 2 ** 31 - 1;

  let dir: string;
  let lockPath: string;

  const stamp = (pid: number): void => {
    writeFileSync(lockPath, JSON.stringify({ pid, startedAt: 'earlier' }));
  };
  const holder = (): number =>
    (JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number }).pid;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'runlock-'));
    lockPath = path.join(dir, '.live-verify.lock');
  });

  afterEach(() => {
    new RunLock(lockPath).release();
  });

  it('stamps the lock with our pid when it is free', () => {
    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('refuses a lock held by a live process', () => {
    // Our parent is alive by construction, and is not us.
    stamp(process.ppid);

    expect(() => new RunLock(lockPath).acquire()).toThrow(
      `another test:live run is already in progress (pid ${process.ppid}, started earlier)`,
    );
    expect(holder()).toBe(process.ppid);
  });

  it('reclaims a lock left behind by a dead process', () => {
    stamp(DEAD_PID);

    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('leaves nothing behind when it reclaims', () => {
    stamp(DEAD_PID);

    new RunLock(lockPath).acquire();

    // The reclaim moves the stale file aside to win it atomically; that copy is
    // a step, not an artifact.
    expect(readdirSync(dir)).toStrictEqual([path.basename(lockPath)]);
  });

  it('releases a lock it owns', () => {
    const lock = new RunLock(lockPath);
    lock.acquire();

    lock.release();

    expect(readdirSync(dir)).toStrictEqual([]);
  });

  it('leaves a lock owned by another run alone', () => {
    stamp(DEAD_PID);

    // A run that lost a stale-lock race must not delete the winner's lock on the
    // way out, so `release` checks ownership rather than just unlinking.
    new RunLock(lockPath).release();

    expect(holder()).toBe(DEAD_PID);
  });
});

describe('classify', () => {
  it('demotes a round-2 pass to flaky', () => {
    expect(
      classify(['a.test.ts'], new Map([['a.test.ts', 'passed']])),
    ).toStrictEqual({ flaky: ['a.test.ts'], real: [] });
  });

  it('keeps a file that failed round 2 as a real failure', () => {
    expect(
      classify(['a.test.ts'], new Map([['a.test.ts', 'failed']])),
    ).toStrictEqual({ flaky: [], real: ['a.test.ts'] });
  });

  it('keeps a file missing from the round-2 map as a real failure', () => {
    expect(classify(['a.test.ts'], new Map())).toStrictEqual({
      flaky: [],
      real: ['a.test.ts'],
    });
  });

  it('splits a mixed round-2 result', () => {
    const round2 = new Map([
      ['flake.test.ts', 'passed'],
      ['broken.test.ts', 'failed'],
      ['crashed.test.ts', 'skipped'],
    ]);

    expect(
      classify(
        ['flake.test.ts', 'broken.test.ts', 'crashed.test.ts', 'gone.test.ts'],
        round2,
      ),
    ).toStrictEqual({
      flaky: ['flake.test.ts'],
      real: ['broken.test.ts', 'crashed.test.ts', 'gone.test.ts'],
    });
  });
});

describe('round2Report', () => {
  it('strips the unit `.test.ts` extension', () => {
    expect(path.basename(round2Report('/repo/src/multisig/Foo.test.ts'))).toBe(
      'live-r2-Foo.json',
    );
  });

  it('strips the integration `.spec.ts` extension', () => {
    expect(
      path.basename(round2Report('/repo/test/integration/specs/Bar.spec.ts')),
    ).toBe('live-r2-Bar.json');
  });

  it('writes the report under the repo logs directory', () => {
    const report = round2Report('/repo/src/multisig/Foo.test.ts');

    expect(path.basename(path.dirname(report))).toBe('logs');
    expect(path.isAbsolute(report)).toBe(true);
  });
});
