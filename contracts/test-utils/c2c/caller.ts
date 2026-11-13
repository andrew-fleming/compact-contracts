/**
 * Caller injection for `kernel.caller()`.
 *
 * Off-chain, a top-level call records `none`; the runtime sets `left(addr)`
 * only when a contract calls through a cross-contract call. These helpers set
 * the block context's caller on every context a simulator hands its circuits,
 * which is what the callee sees inside a cross-contract call, without a second
 * contract. Dry backend only. A throwaway until compact-simulator exposes the
 * same switch beside `as()`.
 */

import {
  type CircuitContext,
  copyCircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { type DrySim, drySimOf } from './dry.js';

type BlockCaller = { tag: 'contract' | 'user'; address: string };
type Block = Record<string, unknown> & { caller?: BlockCaller };

const originals = new WeakMap<DrySim, () => CircuitContext<unknown>>();

const install = (dry: DrySim, caller: BlockCaller | undefined): void => {
  const original = originals.get(dry) ?? dry.getCallerContext.bind(dry);
  originals.set(dry, original);
  // Always wrap: a call's result context carries the block it ran with, so
  // restoring the original getter would keep the last injected caller alive.
  dry.getCallerContext = () => {
    const ctx = copyCircuitContext(original()) as CircuitContext<unknown>;
    const queryContext = ctx.callContext.currentQueryContext;
    const { caller: _previous, ...block } = queryContext.block as Block;
    queryContext.block = (
      caller === undefined ? block : { ...block, caller }
    ) as typeof queryContext.block;
    return ctx;
  };
};

/**
 * Makes every following circuit call on `sim` observe `kernel.caller()` as
 * `some(left(address))`, as if contract `address` were calling it.
 * @param sim - A dry simulator.
 * @param address - The calling contract's address, 64 hex characters.
 */
export const asContract = (sim: unknown, address: string): void =>
  install(drySimOf(sim), { tag: 'contract', address });

/**
 * Makes every following circuit call on `sim` observe `kernel.caller()` as
 * `some(right(address))`, the user-tagged caller the ledger derives for a
 * top-level call.
 * @param sim - A dry simulator.
 * @param address - The calling user's address, 64 hex characters.
 */
export const asUser = (sim: unknown, address: string): void =>
  install(drySimOf(sim), { tag: 'user', address });

/**
 * Restores top-level calls on `sim`: `kernel.caller()` reads `none` again.
 * @param sim - A dry simulator previously passed to `asContract`.
 */
export const asTopLevel = (sim: unknown): void =>
  install(drySimOf(sim), undefined);
