import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { asContract, asTopLevel } from '#test-utils/c2c/caller.js';
import * as utils from '#test-utils/fixtures/address.js';
import { OwnableSimulator } from './simulators/OwnableSimulator.js';

// Helpers
const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

const zeroBytes = utils.zeroUint8Array();

const eitherAccountId = (accountId: Uint8Array) => {
  return {
    is_left: true,
    left: accountId,
    right: { bytes: zeroBytes },
  };
};

const eitherContract = (address: string) => {
  return {
    is_left: false,
    left: zeroBytes,
    right: utils.encodeToAddress(address),
  };
};

const createTestSK = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  sk.set(encoded.slice(0, 32));
  return sk;
};

const makeUser = (label: string) => {
  const secretKey = createTestSK(label);
  const accountId = buildAccountIdHash(secretKey);
  const either = eitherAccountId(accountId);
  return { secretKey, accountId, either };
};

// A contract identity: the raw address `kernel.caller()` reports, and the
// `Either` form the ledger stores.
const makeContract = (label: string) => ({
  address: utils.toHexPadded(label),
  either: eitherContract(label),
});

// Users
const OWNER = makeUser('OWNER');
const NEW_OWNER = makeUser('NEW_OWNER');
const UNAUTHORIZED = makeUser('UNAUTHORIZED');

// Contracts
const OWNER_CONTRACT = makeContract('OWNER_CONTRACT');
const RECIPIENT_CONTRACT = makeContract('RECIPIENT_CONTRACT');
const STRANGER_CONTRACT = makeContract('STRANGER_CONTRACT');

// Zero values
const ZERO_ACCOUNT = eitherAccountId(zeroBytes);
const ZERO_CONTRACT = {
  is_left: false,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

// Init flags
const isInit = true;
const isBadInit = false;

let ownable: OwnableSimulator;

const zeroTypes = [
  ['contract', ZERO_CONTRACT],
  ['accountId', ZERO_ACCOUNT],
] as const;

describe('Ownable', () => {
  describe('before initialized', () => {
    it('should initialize', async () => {
      ownable = await OwnableSimulator.create(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
      expect(await ownable.owner()).toEqual(OWNER.either);
    });

    it('should initialize with a contract owner', async () => {
      ownable = await OwnableSimulator.create(OWNER_CONTRACT.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
      expect(await ownable.owner()).toEqual(OWNER_CONTRACT.either);
    });

    it.each(zeroTypes)(
      'should fail to initialize when owner is zero (%s)',
      async (_, _zero) => {
        await expect(
          OwnableSimulator.create(_zero, isInit, {
            privateState: { secretKey: OWNER.secretKey },
          }),
        ).rejects.toThrow('Ownable: invalid initial owner');
      },
    );

    type FailingCircuits = [method: keyof OwnableSimulator, args: unknown[]];
    const circuitsToFail: FailingCircuits[] = [
      ['owner', []],
      ['assertOnlyOwner', []],
      ['transferOwnership', [OWNER.either]],
      ['renounceOwnership', []],
      ['_transferOwnership', [OWNER.either]],
    ];
    it.each(circuitsToFail)(
      'should fail when calling circuit "%s"',
      async (circuitName, args) => {
        ownable = await OwnableSimulator.create(OWNER.either, isBadInit, {
          privateState: { secretKey: OWNER.secretKey },
        });
        await expect(
          (ownable[circuitName] as (...args: unknown[]) => Promise<unknown>)(
            ...args,
          ),
        ).rejects.toThrow('Ownable: contract not initialized');
      },
    );

    it('should canonicalize initial owner', async () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      ownable = await OwnableSimulator.create(nonCanonical, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });

      const stored = await ownable.owner();
      expect(stored.is_left).toBe(true);
      expect(stored.left).toEqual(OWNER.accountId);
      expect(stored.right).toEqual({ bytes: zeroBytes });
    });
  });

  describe('when initialized', () => {
    beforeEach(async () => {
      ownable = await OwnableSimulator.create(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
    });

    describe('owner', () => {
      it('should return owner', async () => {
        expect(await ownable.owner()).toEqual(OWNER.either);
      });

      it('should return zero when unowned', async () => {
        await ownable._transferOwnership(ZERO_ACCOUNT);
        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow owner to call', async () => {
        await ownable.assertOnlyOwner();
      });

      it('should fail when called by unauthorized', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should reject every user caller when owner is a contract', async () => {
        await ownable._transferOwnership(OWNER_CONTRACT.either);

        // Original owner rejected
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Sample other keys
        for (const label of ['SAMPLE_1', 'SAMPLE_2', 'SAMPLE_3']) {
          const sampleUser = makeUser(label);
          await ownable.privateState.injectSecretKey(sampleUser.secretKey);
          await expect(ownable.assertOnlyOwner()).rejects.toThrow(
            'Ownable: caller is not the owner',
          );
        }
      });
    });

    describe('transferOwnership', () => {
      it('should transfer ownership', async () => {
        await ownable.transferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner can no longer call
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should transfer ownership to a contract', async () => {
        await ownable.transferOwnership(RECIPIENT_CONTRACT.either);
        expect(await ownable.owner()).toEqual(RECIPIENT_CONTRACT.either);

        // The previous owner's key no longer authenticates
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when unauthorized transfers ownership', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(
          ownable.transferOwnership(NEW_OWNER.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
      });

      it.each(zeroTypes)(
        'should fail when transferring to zero (%s)',
        async (_, _zero) => {
          await expect(ownable.transferOwnership(_zero)).rejects.toThrow(
            'Ownable: invalid new owner',
          );
        },
      );

      it('should transfer multiple times', async () => {
        await ownable.transferOwnership(NEW_OWNER.either);

        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.transferOwnership(OWNER.either);

        await ownable.privateState.injectSecretKey(OWNER.secretKey);
        await ownable.transferOwnership(NEW_OWNER.either);

        expect(await ownable.owner()).toEqual(NEW_OWNER.either);
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', async () => {
        expect(await ownable.owner()).toEqual(OWNER.either);

        await ownable.renounceOwnership();

        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);

        // Confirm revoked permissions
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when renouncing from unauthorized', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.renounceOwnership()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should store canonical zero after renouncing', async () => {
        await ownable.renounceOwnership();

        const stored = await ownable.owner();
        expect(stored.is_left).toBe(true);
        expect(stored.left).toEqual(zeroBytes);
        expect(stored.right).toEqual({ bytes: zeroBytes });
      });
    });

    describe('_transferOwnership', () => {
      it('should transfer ownership', async () => {
        await ownable._transferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner can no longer call
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should transfer ownership to a contract', async () => {
        await ownable._transferOwnership(OWNER_CONTRACT.either);
        expect(await ownable.owner()).toEqual(OWNER_CONTRACT.either);
      });

      it('should transfer multiple times', async () => {
        await ownable._transferOwnership(NEW_OWNER.either);
        await ownable._transferOwnership(OWNER_CONTRACT.either);
        await ownable._transferOwnership(OWNER.either);

        expect(await ownable.owner()).toEqual(OWNER.either);
      });

      it.each(zeroTypes)(
        'should allow transfers to zero (%s)',
        async (_, _zero) => {
          await ownable._transferOwnership(_zero);
          expect(await ownable.owner()).toEqual(_zero);

          // No one can authenticate after zeroing
          await expect(ownable.assertOnlyOwner()).rejects.toThrow(
            'Ownable: caller is not the owner',
          );
        },
      );

      it('should canonicalize accountId (zero out inactive right side)', async () => {
        // Craft a non-canonical Either: is_left=true but right side has data
        const nonCanonical = {
          is_left: true,
          left: NEW_OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await ownable._transferOwnership(nonCanonical);

        const stored = await ownable.owner();
        expect(stored.is_left).toBe(true);
        expect(stored.left).toEqual(NEW_OWNER.accountId);
        expect(stored.right).toEqual({ bytes: zeroBytes });
      });

      it('should canonicalize contract address (zero out inactive left side)', async () => {
        // Craft a non-canonical Either: is_left=false but left side has data
        const nonCanonical = {
          is_left: false,
          left: NEW_OWNER.accountId,
          right: utils.encodeToAddress('OWNER_CONTRACT'),
        };

        await ownable._transferOwnership(nonCanonical);

        const stored = await ownable.owner();
        expect(stored.is_left).toBe(false);
        expect(stored.left).toEqual(zeroBytes);
        expect(stored.right).toEqual(utils.encodeToAddress('OWNER_CONTRACT'));
      });
    });
  });

  // `kernel.caller()` is injected into the block context, which only the dry
  // engine exposes. The real cross-contract path is in Ownable.c2c.test.ts.
  describe.skipIf(isLiveBackend())('when owned by a contract', () => {
    beforeEach(async () => {
      ownable = await OwnableSimulator.create(OWNER_CONTRACT.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow the owner contract to call', async () => {
        asContract(ownable, OWNER_CONTRACT.address);
        await ownable.assertOnlyOwner();
      });

      it('should fail when called by another contract', async () => {
        asContract(ownable, STRANGER_CONTRACT.address);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when called top-level, whatever key the user holds', async () => {
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        asContract(ownable, OWNER_CONTRACT.address);
        await ownable.assertOnlyOwner();

        asTopLevel(ownable);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should ignore the witness on the contract path', async () => {
        asContract(ownable, OWNER_CONTRACT.address);
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await ownable.assertOnlyOwner();
      });
    });

    describe('transferOwnership', () => {
      it('should let the owner contract transfer to a user', async () => {
        asContract(ownable, OWNER_CONTRACT.address);
        await ownable.transferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // The contract no longer authenticates
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // The user does, top-level
        asTopLevel(ownable);
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should let the owner contract transfer to another contract', async () => {
        asContract(ownable, OWNER_CONTRACT.address);
        await ownable.transferOwnership(RECIPIENT_CONTRACT.either);
        expect(await ownable.owner()).toEqual(RECIPIENT_CONTRACT.either);

        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        asContract(ownable, RECIPIENT_CONTRACT.address);
        await ownable.assertOnlyOwner();
      });

      it('should fail when another contract transfers ownership', async () => {
        asContract(ownable, STRANGER_CONTRACT.address);
        await expect(
          ownable.transferOwnership(NEW_OWNER.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
      });
    });

    describe('renounceOwnership', () => {
      it('should let the owner contract renounce', async () => {
        asContract(ownable, OWNER_CONTRACT.address);
        await ownable.renounceOwnership();
        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);

        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when another contract renounces', async () => {
        asContract(ownable, STRANGER_CONTRACT.address);
        await expect(ownable.renounceOwnership()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });
    });
  });

  describe('simulator wiring', () => {
    it('should construct with a generated private state when none is supplied', async () => {
      const sim = await OwnableSimulator.create(OWNER.either, isInit);
      const sk = await sim.privateState.getCurrentSecretKey();

      expect(sk).toBeInstanceOf(Uint8Array);
      expect(sk.length).toBe(32);
    });

    it('should expose an empty public ledger via getPublicState', async () => {
      const sim = await OwnableSimulator.create(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });

      expect(await sim.getPublicState()).toStrictEqual({});
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', async () => {
        ownable = await OwnableSimulator.create(OWNER.either, isInit, {
          privateState: { secretKey: OWNER.secretKey },
        });
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);

        expect(await ownable.privateState.getCurrentSecretKey()).toEqual(
          NEW_OWNER.secretKey,
        );
      });

      it('should throw when the secret key is undefined', async () => {
        const sim = await OwnableSimulator.create(OWNER.either, isInit, {
          privateState: { secretKey: undefined as unknown as Uint8Array },
        });

        await expect(sim.privateState.getCurrentSecretKey()).rejects.toThrow(
          'Missing secret key',
        );
      });
    });
  });
});
