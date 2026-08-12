// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.3.0-alpha.2 (multisig/test/EmptyWitnesses.ts)

/**
 * Shared empty private state and witnesses for the multisig test simulators.
 * Most multisig contracts declare no witnesses, so their simulators import this
 * in place of a per-contract witness module. `ShieldedMultiSig` is the
 * exception as it derives signer identity from a secret key and has its own
 * `ShieldedMultiSigWitnesses`.
 */
export type EmptyPrivateState = Record<string, never>;
export const EmptyPrivateState: EmptyPrivateState = {};
export const emptyWitnesses = () => ({});
