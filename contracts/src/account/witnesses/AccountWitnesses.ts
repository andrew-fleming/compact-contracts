// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.0 (access/witnesses/AccessControlWitnesses.ts)

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../artifacts/MockAccount/contract/index.cjs';

/**
 * @description Interface defining the witness methods for Account operations.
 * @template P - The private state type.
 */
export interface IAccountWitnesses<P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret nonce as a Uint8Array.
   */
  wit_secretKey(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of an account contract, storing a secret key.
 */
export type AccountPrivateState = {
  /** @description A 32-byte secret key. */
  secretKey: Buffer;
};

/**
 * @description Utility object for managing the private state of an Account contract.
 */
export const AccountPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh AccountPrivateState instance.
   */
  generate: (): AccountPrivateState => {
    return { secretKey: getRandomValues(Buffer.alloc(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh ZOwnablePKPrivateState instance with the provided nonce.
   */
  withSecretKey: (sk: Buffer): AccountPrivateState => {
    return { secretKey: sk };
  },
};

/**
 * @description Factory function creating witness implementations for Account operations.
 * @returns An object implementing the Witnesses interface for AccountPrivateState.
 */
export const AccountWitnesses = (): IAccountWitnesses<AccountPrivateState> => ({
  wit_secretKey(
    context: WitnessContext<Ledger, AccountPrivateState>,
  ): [AccountPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },
});
