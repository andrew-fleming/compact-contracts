import { existsSync, readFileSync } from 'node:fs';
import { CONTRACTS, PROGRESS_REPORTER, VITEST_BIN } from './paths.ts';
import { run } from './shell.ts';
import type { LiveTarget } from './targets.ts';

interface JsonTestResult {
  readonly name: string;
  readonly status: string;
}
interface JsonReport {
  readonly testResults?: readonly JsonTestResult[];
}

/** Spawns vitest against one live project and reads back its JSON report. */
export class VitestRunner {
  /**
   * Run one live project.
   *
   * @param project - the single project for this invocation (see `targets.ts` on
   *   why it is never more than one)
   * @param reportPath - where the JSON reporter writes, for {@link fileStatuses}
   * @param fileFilters - vitest positional filters; empty runs the include glob
   * @param extraEnv - overrides layered over `MIDNIGHT_BACKEND=live`
   * @returns vitest's exit status
   */
  run(
    project: LiveTarget['project'],
    reportPath: string,
    fileFilters: readonly string[],
    extraEnv: Record<string, string> = {},
  ): Promise<number> {
    return run(
      VITEST_BIN,
      [
        'run',
        '--project',
        project,
        // A target filtered down to zero matching files is a pass, not an error.
        '--passWithNoTests',
        // `default` prints one line per file (piped) plus failures/summary; the
        // progress reporter adds the worker-tagged, counted per-test line.
        '--reporter=default',
        `--reporter=${PROGRESS_REPORTER}`,
        '--reporter=json',
        `--outputFile.json=${reportPath}`,
        ...fileFilters,
      ],
      { ...process.env, MIDNIGHT_BACKEND: 'live', ...extraEnv },
      CONTRACTS,
    );
  }

  /**
   * File name → status for every file in the report.
   *
   * @returns `undefined` when no report exists at all — the run was blocked
   *   (dirty node / lock) or crashed before writing one, which callers must treat
   *   as an infrastructure abort rather than a test failure.
   */
  fileStatuses(reportPath: string): Map<string, string> | undefined {
    if (!existsSync(reportPath)) return undefined;
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport;
    return new Map(
      (report.testResults ?? []).map((r) => [r.name, r.status] as const),
    );
  }
}
