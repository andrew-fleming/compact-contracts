import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the turbo compile config against the two ways it silently rots
 * (OpenZeppelin/compact-contracts#675).
 *
 * Both are properties of `turbo.json` versus the real `.compact` import graph,
 * so they are checkable without compiling anything. They exist because neither
 * failure is visible at runtime: a task whose `inputs` miss a source it
 * compiles serves a stale cache entry, and two tasks sharing an output
 * directory race over it. Discipline alone does not keep these in step —
 * adding one cross-category import is enough to break the first.
 */

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SRC = path.join(REPO, 'contracts/src');
const turbo = JSON.parse(readFileSync(path.join(REPO, 'turbo.json'), 'utf8'));

/** Category a source path belongs to: the first segment under `src/`. */
const categoryOf = (abs: string): string =>
  path.relative(SRC, abs).split(path.sep)[0];

const compactFiles = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) compactFiles(p, out);
    else if (e.name.endsWith('.compact')) out.push(p);
  }
  return out;
};

/** category -> categories it imports from, transitively. */
const importGraph = (): Map<string, Set<string>> => {
  const direct = new Map<string, Set<string>>();
  for (const file of compactFiles(SRC)) {
    const from = categoryOf(file);
    const body = readFileSync(file, 'utf8');
    for (const m of body.matchAll(
      /import\s+(?:\{[^}]*\}\s+from\s+)?"([^"]+)"/g,
    )) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // CompactStandardLibrary etc.
      const target = path.resolve(path.dirname(file), spec);
      if (!target.startsWith(SRC)) continue;
      const to = categoryOf(target);
      if (to !== from)
        (direct.get(from) ?? direct.set(from, new Set()).get(from)!).add(to);
    }
    if (!direct.has(from)) direct.set(from, new Set());
  }
  // transitive closure
  const closure = new Map<string, Set<string>>();
  const visit = (c: string, seen: Set<string>): Set<string> => {
    if (closure.has(c)) return closure.get(c)!;
    const acc = new Set<string>();
    for (const dep of direct.get(c) ?? []) {
      if (seen.has(dep)) continue;
      acc.add(dep);
      for (const t of visit(dep, new Set([...seen, dep]))) acc.add(t);
    }
    closure.set(c, acc);
    return acc;
  };
  for (const c of direct.keys()) visit(c, new Set([c]));
  return closure;
};

/** Categories a task's `inputs` globs actually cover. */
const coveredBy = (inputs: string[]): Set<string> => {
  const cats = new Set<string>();
  for (const g of inputs) {
    if (g.startsWith('!')) continue;
    const m = /^src\/([^/*]+)\//.exec(g);
    if (m) cats.add(m[1]);
    else if (g.startsWith('src/**')) return new Set(['*']); // covers everything
  }
  return cats;
};

const compileTasks = Object.entries(turbo.tasks).filter(
  ([name, cfg]: [string, any]) =>
    /^compile:[a-z]+$/.test(name) && Array.isArray(cfg.inputs),
) as [string, any][];

describe('turbo compile config', () => {
  it('declares inputs covering every category each task transitively imports', () => {
    const graph = importGraph();
    const gaps: string[] = [];
    for (const [task, cfg] of compileTasks) {
      const cat = task.slice('compile:'.length);
      if (!graph.has(cat)) continue; // no sources (e.g. integration)
      const covered = coveredBy(cfg.inputs);
      if (covered.has('*')) continue;
      const needed = new Set([cat, ...graph.get(cat)!]);
      for (const n of needed) {
        if (!covered.has(n))
          gaps.push(
            `${task} compiles src/${n}/** but does not declare it in inputs`,
          );
      }
    }
    expect(gaps).toStrictEqual([]);
  });

  it('scopes every compile task to a disjoint output subtree', () => {
    const outs = Object.entries(turbo.tasks)
      .filter(
        ([n, c]: [string, any]) =>
          n.startsWith('compile') && (c.outputs ?? []).length,
      )
      .map(([n, c]: [string, any]) => [n, c.outputs as string[]] as const);
    const overlaps: string[] = [];
    for (const [aName, aOuts] of outs) {
      for (const [bName, bOuts] of outs) {
        if (aName >= bName) continue;
        for (const a of aOuts) {
          for (const b of bOuts) {
            const pa = a.replace(/\*+\/?$/, ''),
              pb = b.replace(/\*+\/?$/, '');
            if (pa.startsWith(pb) || pb.startsWith(pa))
              overlaps.push(`${aName} (${a}) overlaps ${bName} (${b})`);
          }
        }
      }
    }
    expect(overlaps).toStrictEqual([]);
  });
});
