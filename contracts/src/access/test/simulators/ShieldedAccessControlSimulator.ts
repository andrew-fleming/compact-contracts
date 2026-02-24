import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  type ShieldedAccessControl_Role as Role,
  ledger,
  Contract as MockShieldedAccessControl,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockShieldedAccessControl/contract/index.js';
import {
  ShieldedAccessControlPrivateState,
  ShieldedAccessControlWitnesses,
} from '../../witnesses/ShieldedAccessControlWitnesses.js';

/**
 * Type constructor args
 */
type ShieldedAccessControlArgs = readonly [];

/**
 * Base simulator
 * @dev We deliberately use `any` as the base simulator type.
 * This workaround is necessary due to type inference and declaration filegen
 * in a monorepo environment. Attempting to fully preserve type information
 * turns into type gymnastics.
 *
 * `any` can be safely removed once the contract simulator is consumed
 * as a properly packaged dependency (outside the monorepo).
 */
const ShieldedAccessControlSimulatorBase: any = createSimulator<
  ShieldedAccessControlPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedAccessControlWitnesses>,
  MockShieldedAccessControl<ShieldedAccessControlPrivateState>,
  ShieldedAccessControlArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedAccessControl<ShieldedAccessControlPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedAccessControlPrivateState.generate(),
  contractArgs: () => {
    return [];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedAccessControlWitnesses(),
});

/**
 * ShieldedAccessControlSimulator
 */
export class ShieldedAccessControlSimulator extends ShieldedAccessControlSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      ShieldedAccessControlPrivateState,
      ReturnType<typeof ShieldedAccessControlWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public _computeRoleCommitment(
    roleId: Uint8Array,
    accountId: Uint8Array,
  ): Uint8Array {
    return this.circuits.pure._computeRoleCommitment(roleId, accountId);
  }

  public _computeAccountId(
    pk: Either<ZswapCoinPublicKey, ContractAddress>,
    nonce: Uint8Array
  ): Uint8Array {
    return this.circuits.pure._computeAccountId(pk, nonce);
  }

  public _computeNullifier(commitment: Uint8Array): Uint8Array {
    return this.circuits.pure._computeNullifier(commitment);
  }

  public callerHasRole(roleId: Uint8Array): Role {
    return this.circuits.impure.callerHasRole(roleId);
  }

  /**
   * @description Returns the current commitment representing the contract owner.
   * The full commitment is: `SHA256(SHA256(pk, nonce), instanceSalt, counter, domain)`.
   * @returns The current owner's commitment.
   */
  public hasRole(
    roleId: Uint8Array,
    accountId: Uint8Array,
  ): Boolean {
    return this.circuits.impure.hasRole(roleId, accountId);
  }

  /**
   * @description Transfers ownership to `newOwnerId`.
   * `newOwnerId` must be precalculated and given to the current owner off chain.
   * @param newOwnerId The new owner's unique identifier (`SHA256(pk, nonce)`).
   */
  public assertOnlyRole(roleId: Uint8Array) {
    this.circuits.impure.assertOnlyRole(roleId);
  }

  public getRole(roleId: Uint8Array, accountId: Uint8Array): Role {
    return this.circuits.impure.getRole(roleId, accountId);
  }

  /**
   * @description Computes the owner commitment from the given `id` and `counter`.
   * @param id - The unique identifier of the owner calculated by `SHA256(pk, nonce)`.
   * @param counter - The current counter or round. This increments by `1`
   * after every transfer to prevent duplicate commitments given the same `id`.
   * @returns The commitment derived from `id` and `counter`.
   */
  public getRoleAdmin(roleId: Uint8Array): Uint8Array {
    return this.circuits.impure.getRoleAdmin(roleId);
  }

  /**
   * @description Computes the unique identifier (`id`) of the owner from their
   * public key and a secret nonce.
   * @param pk - The public key of the identity being committed.
   * @param nonce - A private nonce to scope the commitment.
   * @returns The computed owner ID.
   */
  public grantRole(
    roleId: Uint8Array,
    accountId: Uint8Array
  ) {
    this.circuits.impure.grantRole(roleId, accountId);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public revokeRole(
    roleId: Uint8Array,
    accountId: Uint8Array
  ) {
    this.circuits.impure.revokeRole(roleId, accountId);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public renounceRole(
    roleId: Uint8Array,
    callerConfirmation: Uint8Array
  ) {
    this.circuits.impure.renounceRole(roleId, callerConfirmation);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _setRoleAdmin(roleId: Uint8Array, adminRole: Uint8Array) {
    this.circuits.impure._setRoleAdmin(roleId, adminRole);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _grantRole(
    roleId: Uint8Array,
    accountId: Uint8Array
  ): boolean {
    return this.circuits.impure._grantRole(roleId, accountId);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _revokeRole(
    roleId: Uint8Array,
    accountId: Uint8Array
  ): boolean {
    return this.circuits.impure._revokeRole(roleId, accountId);
  }

  public readonly privateState = {
    /**
     * @description Contextually sets a new nonce into the private state.
     * @param newNonce The secret nonce.
     * @returns The ShieldedAccessControlPK private state after setting the new nonce.
     */
    injectSecretNonce: (
      roleId: Uint8Array,
      newNonce: Buffer<ArrayBufferLike>,
    ): ShieldedAccessControlPrivateState => {
      const currentState = this.stateManager.getContext().currentPrivateState;
      const updatedState = {
        roles: { ...currentState.roles },
      };
      const roleString = Buffer.from(roleId).toString('hex');
      updatedState.roles[roleString] = newNonce;
      this.stateManager.updatePrivateState(updatedState);
      return updatedState;
    },

    /**
     * @description Returns the secret nonce for a given roleId.
     * @returns The secret nonce.
     */
    getCurrentSecretNonce: (roleId: Uint8Array): Uint8Array => {
      const roleString = Buffer.from(roleId).toString('hex');
      return this.stateManager.getContext().currentPrivateState.roles[
        roleString
      ];
    },
  };
}
