import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  MerkleTreePath,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ShieldedAccessControl_Role as Role,
  ZswapCoinPublicKey,
} from '../../../artifacts/MockShieldedAccessControl/contract/index.js';
import { ShieldedAccessControlPrivateState, ShieldedAccessControlWitnesses } from '../witnesses/ShieldedAccessControlWitnesses.js';
import { ShieldedAccessControlSimulator } from './simulators/ShieldedAccessControlSimulator.js';
import * as utils from '#test-utils/address.js';

const COMMITMENT_DOMAIN = "ShieldedAccessControl:commitment";
const NULLIFIER_DOMAIN = "ShieldedAccessControl:nullifier";

const DEFAULT_MT_PATH: MerkleTreePath<Uint8Array> = {
  leaf: new Uint8Array(32),
  path: Array.from({ length: 10 }, () => ({
    sibling: { field: 0n },
    goes_left: false,
  })),
};

// Helpers
const buildCommitment = (
  roleId: Uint8Array,
  accountId: Uint8Array
): Uint8Array => {
  const rt_type = new CompactTypeVector(3, new CompactTypeBytes(32));
  const bDomain = new TextEncoder().encode(COMMITMENT_DOMAIN);

  const commitment = persistentHash(rt_type, [
    roleId,
    accountId,
    bDomain,
  ]);

  return commitment;
};

const buildNullifier = (
  roleCommitment: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));
  const bDomain = new TextEncoder().encode(NULLIFIER_DOMAIN);

  const nullifier = persistentHash(rt_type, [
    roleCommitment,
    bDomain,
  ]);

  return nullifier;
};

const buildAccountId = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));

  const bPK = pk.bytes;
  return persistentHash(rt_type, [bPK, nonce]);
};

class ShieldedAccessControlConstant {
  publicKey: string;
  zPublicKey: ZswapCoinPublicKey;
  roleId: Uint8Array;
  accountId: Uint8Array;
  roleNullifier: Uint8Array;
  roleCommitment: Uint8Array;
  secretNonce: Buffer;

  constructor(baseString: string, roleIdentifier: bigint) {
    [this.publicKey, this.zPublicKey] = utils.generatePubKeyPair(baseString);
    this.secretNonce = Buffer.alloc(32, baseString + "_NONCE");
    this.accountId = buildAccountId(this.zPublicKey, this.secretNonce);
    this.roleId = convertFieldToBytes(32, roleIdentifier, '');
    this.roleCommitment = buildCommitment(this.roleId, this.accountId);
    this.roleNullifier = buildNullifier(this.roleCommitment);
  };
}


// PKs
const ADMIN = new ShieldedAccessControlConstant('ADMIN', 0n);
const OPERATOR_1 = new ShieldedAccessControlConstant('OPERATOR_1', 1n);
const OPERATOR_2 = new ShieldedAccessControlConstant('OPERATOR_2', 2n);
const OPERATOR_3 = new ShieldedAccessControlConstant('OPERATOR_3', 3n);
const UNAUTHORIZED = new ShieldedAccessControlConstant('UNAUTHORIZED', 99999999n);
const UNINITIALIZED = new ShieldedAccessControlConstant('UNINITIALIZED', 555n);
const BAD_INPUT = new ShieldedAccessControlConstant('BAD_INPUT', 666n);

let shieldedAccessControl: ShieldedAccessControlSimulator;


describe('ShieldedAccessControl', () => {
  beforeEach(() => {
    // Create private state object and generate nonce
    const PS = ShieldedAccessControlPrivateState.withRoleAndNonce(
      Buffer.from(ADMIN.roleId),
      ADMIN.secretNonce,
    );
    // Init contract for user with PS
    shieldedAccessControl = new ShieldedAccessControlSimulator({
      privateState: PS,
      witnesses: ShieldedAccessControlWitnesses()
    });
  });

  describe('checked circuits should fail for authorized caller with invalid witness values', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
      shieldedAccessControl.as(ADMIN.publicKey);
    });

    type FailingCircuits = [
      method: keyof ShieldedAccessControlSimulator,
      isValidNonce: boolean,
      isValidPath: boolean,
      args: unknown[],
    ];
    const checkedCircuits: FailingCircuits[] = [
      ['assertOnlyRole', false, true, [ADMIN.roleId]],
      ['assertOnlyRole', true, false, [ADMIN.roleId]],
      ['assertOnlyRole', false, false, [ADMIN.roleId]],
      ['grantRole', false, true, [ADMIN.roleId, ADMIN.accountId]],
      ['grantRole', true, false, [ADMIN.roleId, ADMIN.accountId]],
      ['grantRole', false, false, [ADMIN.roleId, ADMIN.accountId]],
      ['revokeRole', true, false, [ADMIN.roleId, ADMIN.accountId]],
      ['revokeRole', false, true, [ADMIN.roleId, ADMIN.accountId]],
      ['revokeRole', false, false, [ADMIN.roleId, ADMIN.accountId]],
    ];

    it.each(checkedCircuits)(
      '%s should fail with isValidNonce(%s), isValidPath(%s)',
      (circuitName, isValidNonce, isValidPath, args) => {
        if (isValidNonce) {
          // Check nonce matches
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.roleId,
            ),
          ).toEqual(ADMIN.secretNonce);
        } else {
          // Check nonce does not match
          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.roleId,
            UNAUTHORIZED.secretNonce,
          );
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.roleId,
            ),
          ).not.toEqual(ADMIN.secretNonce);
        }

        if (isValidPath) {
          // Check path matches
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              ADMIN.roleCommitment,
            );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(
              shieldedAccessControl.getWitnessContext(),
              ADMIN.roleCommitment,
            );
          expect(witnessCalculatedPath).toEqual(truePath);
        } else {
          // Check path does not match
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              ADMIN.roleCommitment,
            );
          shieldedAccessControl.overrideWitness('wit_getRoleCommitmentPath', (ctx) => {
            return [ctx.privateState, DEFAULT_MT_PATH];
          });
          const [, witnessCalculatedPath] = shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(shieldedAccessControl.getWitnessContext(), BAD_INPUT.roleCommitment)
          expect(witnessCalculatedPath).not.toEqual(truePath);
        }

        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).toThrow('ShieldedAccessControl: unauthorized account');
      },
    );
  });

  describe('_computeRoleCommitment', () => {
    it('computed commitment should match', () => {
      expect(shieldedAccessControl._computeRoleCommitment(ADMIN.roleId, ADMIN.accountId)).toEqual(ADMIN.roleCommitment);
    });

    type ComputeRoleCommitmentCases = [
      method: keyof ShieldedAccessControlSimulator,
      isValidId: boolean,
      isValidRole: boolean,
      args: unknown[],
    ];

    const checkedCircuits: ComputeRoleCommitmentCases[] = [
      ['_computeRoleCommitment', false, true, [BAD_INPUT.roleId, ADMIN.accountId]],
      ['_computeRoleCommitment', true, false, [ADMIN.roleId, BAD_INPUT.accountId]],
      ['_computeRoleCommitment', false, false, [BAD_INPUT.roleId, BAD_INPUT.accountId]],
    ]

    it.each(checkedCircuits)(
      '%s should not match with isValidNonce(%s), isValidPath(%s)',
      (circuitName, isValidId, isValidRole, args) => {
        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).not.toEqual(ADMIN);
      }
    )
  });

  describe('_computeNullifier', () => {
    it('should match nullifier', () => {
      expect(shieldedAccessControl._computeNullifier(ADMIN.roleCommitment)).toEqual(ADMIN.roleNullifier);
    });

    it('should not match bad commitment inputs', () => {
      expect(shieldedAccessControl._computeNullifier(BAD_INPUT.roleCommitment)).not.toEqual(ADMIN.roleNullifier);
    });
  });

  describe('_computeAccountId', () => {
    const eitherAdmin = utils.createEitherTestUser('ADMIN');
    const eitherUnauthorized = utils.createEitherTestUser('UNAUTHORIZED');

    it('should match role id', () => {
      expect(shieldedAccessControl._computeAccountId(eitherAdmin, ADMIN.secretNonce)).toEqual(ADMIN.accountId);
    });

    it('should fail for contract address', () => {
      const eitherContract = utils.createEitherTestContractAddress('CONTRACT')
      expect(() => {
        shieldedAccessControl._computeAccountId(eitherContract, ADMIN.secretNonce);
      }).toThrow('ShieldedAccessControl: contract address roles are not yet supported');
    });

    type ComputeRoleIdCases = [
      method: keyof ShieldedAccessControlSimulator,
      isValidAccount: boolean,
      isValidNonce: boolean,
      args: unknown[],
    ];

    const checkedCircuits: ComputeRoleIdCases[] = [
      ['_computeAccountId', true, false, [eitherAdmin, UNAUTHORIZED.secretNonce]],
      ['_computeAccountId', false, true, [eitherUnauthorized, ADMIN.secretNonce]],
      ['_computeAccountId', false, false, [eitherUnauthorized, UNAUTHORIZED.secretNonce]],
    ];

    it.each(checkedCircuits)(
      '%s should not match role id with invalidAccount=%s or invalidNonce=%s',
      (circuitName, isValidAccount, isValidNonce, args) => {
        // Test circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).not.toEqual(ADMIN.accountId);
      }
    )
  });


  describe('computeRole', () => {
    beforeEach(() => {
      shieldedAccessControl.as(ADMIN.publicKey);
    });

    it('should return unapproved if role does not exist', () => {
      expect(shieldedAccessControl.computeRole(UNINITIALIZED.roleId, ADMIN.accountId).hasRole).toBe(false);
    });

    it('should return correct commitment', () => {
      expect(shieldedAccessControl.computeRole(ADMIN.roleId, ADMIN.accountId).roleCommitment).toEqual(ADMIN.roleCommitment);
    });

    it('should return correct nullifier', () => {
      expect(shieldedAccessControl.computeRole(ADMIN.roleId, ADMIN.accountId).roleNullifier).toEqual(ADMIN.roleNullifier);
    });

    it('should return approved role', () => {
      shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
      expect(shieldedAccessControl.computeRole(ADMIN.roleId, ADMIN.accountId).hasRole).toBe(true);
    });
  });

  describe('_grantRole', () => {
    it('should return true for new role', () => {
      expect(shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId)).toBe(true);
    });

    it('should return false if role already granted', () => {
      shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
      expect(shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId)).toBe(false);
    });
  });
});