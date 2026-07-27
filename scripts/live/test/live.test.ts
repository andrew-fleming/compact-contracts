import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../LiveOrchestrator.ts';
import { round2Report } from '../paths.ts';
import { resolvePlan } from '../targets.ts';

/**
 * Dry unit tests for the pure pieces of the live orchestrator: plan resolution,
 * flake classification, and report naming. Nothing here touches docker, the
 * node, or the artifact tree.
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
