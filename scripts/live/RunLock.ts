import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { LOGS, VERIFY_LOCK } from './paths.ts';

interface LockInfo {
  readonly pid: number;
  readonly startedAt: string;
}

/** Whether a pid names a live process (EPERM means alive but not ours to signal). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Pid-stamped lock making one orchestrator run exclusive.
 *
 * Two concurrent runs would interleave `env-up` resets and shielded-coin spends
 * against the one shared node, so the second run fails fast instead. A lock left
 * behind by a killed run is reclaimed, since its pid is no longer alive.
 *
 * This is the *orchestrator* lock. `live.globalSetup` holds a separate,
 * deliberately reentrant one (`.live-run.lock`) scoped to a vitest process.
 */
export class RunLock {
  readonly #path: string;

  constructor(lockPath: string = VERIFY_LOCK) {
    this.#path = lockPath;
  }

  #read(): LockInfo | undefined {
    try {
      return JSON.parse(readFileSync(this.#path, 'utf8')) as LockInfo;
    } catch {
      return undefined;
    }
  }

  /** Take the lock, or throw if a live process already holds it. */
  acquire(): void {
    mkdirSync(LOGS, { recursive: true });
    const stamp = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    try {
      writeFileSync(this.#path, stamp, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const info = this.#read();
      if (info && pidAlive(info.pid)) {
        throw new Error(
          `another test:live run is already in progress (pid ${info.pid}, ` +
            `started ${info.startedAt}). Wait for it, or remove ${this.#path}.`,
        );
      }
      writeFileSync(this.#path, stamp); // stale — reclaim
    }
  }

  /** Release only if we still own it, so a stale takeover is never clobbered. */
  release(): void {
    if (this.#read()?.pid !== process.pid) return;
    try {
      unlinkSync(this.#path);
    } catch {
      // already gone
    }
  }
}
