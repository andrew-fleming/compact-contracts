/**
 * Block-time control for the dry backend.
 *
 * `blockTimeLt` and `blockTimeGte` compile to a query against the block info in
 * the simulator's `QueryContext`, reading its `secondsSinceEpoch`. The dry
 * backend initializes that to `0` and never advances it, so a spec that needs a
 * particular chain time sets it here.
 *
 * DRY ONLY. The live backend holds no in-memory context to write to — the node
 * supplies the real block time — so `setBlockTime` throws there rather than
 * silently doing nothing. Gate callers with `skipIf(isLiveBackend())`.
 */

type BlockInfo = { secondsSinceEpoch: bigint };
type DrySimulator = {
  _backend?: {
    sim?: {
      circuitContext?: {
        currentQueryContext?: { block: BlockInfo };
      };
    };
  };
};

function queryContext(sim: unknown): { block: BlockInfo } {
  const qc = (sim as DrySimulator)._backend?.sim?.circuitContext
    ?.currentQueryContext;
  if (qc === undefined) {
    throw new Error(
      'setBlockTime/getBlockTime: no in-memory query context. These are dry-only; gate the spec with skipIf(isLiveBackend()).',
    );
  }
  return qc;
}

/** Reads the block time the dry backend currently reports to circuits. */
export function getBlockTime(sim: unknown): bigint {
  return queryContext(sim).block.secondsSinceEpoch;
}

/**
 * Sets the block time the dry backend reports to circuits. Persists across
 * subsequent circuit calls on the same simulator.
 *
 * @param sim - A dry-backend simulator instance.
 * @param secondsSinceEpoch - The chain time to report.
 */
export function setBlockTime(sim: unknown, secondsSinceEpoch: bigint): void {
  const qc = queryContext(sim);
  qc.block = { ...qc.block, secondsSinceEpoch };
}
