import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBytesToField,
  ecMulGenerator,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
// The ElGamal pure circuits double as an off-circuit "mirror" — they let a test
// predict a ciphertext the contract will produce internally (e.g. the
// post-refund balance in `approve`) so its plaintext can be cached ahead of the
// witness query. They are pure (no proof), so this is cheap.
import { pureCircuits as elgamal } from '../../../artifacts/MockElGamal/contract/index.js';
import { ConfidentialFungibleTokenSimulator } from './simulators/ConfidentialFungibleTokenSimulator.js';
import { DEFAULT_RANDOMNESS_SEED } from './witnesses/ConfidentialFungibleTokenWitnesses.js';

// Mirrors Compact's `pad(32, s)`: UTF-8 bytes of `s`, zero-padded to 32 bytes.
const padTag = (s: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @description Derives the expected pk for a given EK, mirroring the
 * in-circuit `_derivePk`:
 *   pk = ecMulGenerator(degradeToTransient(persistentHash([ek])))
 *
 * The `convertBytesToField` call mirrors `degradeToTransient`, producing the
 * field element that `ecMulGenerator` expects.
 *
 * @note tThe field-element derivation from EK uses 31 bytes of the hash output
 * (empirically determined); the effective collision resistance is therefore 248 bits.
 */
const derivePk = (ek: Uint8Array) => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  const ekHash = persistentHash(rt_type, [ek]);
  const ekField = convertBytesToField(31, ekHash, 'derivePk');
  return ecMulGenerator(ekField);
};

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

/**
 * @description The identity element on Jubjub, produced by ecMulGenerator(0).
 * Used as both c1 and c2 of Enc(0).
 */
const identityPoint = () => ecMulGenerator(0n);

const createTestKey = (label: string): Uint8Array => {
  const key = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  key.set(encoded.slice(0, 32));
  return key;
};

const makeUser = (label: string) => {
  const secretKey = createTestKey(`${label}_SK`);
  const encryptionKey = createTestKey(`${label}_EK`);
  const accountId = buildAccountIdHash(secretKey);
  return { secretKey, encryptionKey, accountId };
};

// Users
const ALICE = makeUser('ALICE');
const BOB = makeUser('BOB');
const CHARLIE = makeUser('CHARLIE');

// Token metadata
const NAME = 'ConfidentialToken';
const SYMBOL = 'CT';
const DECIMALS = 6n;

let cft: ConfidentialFungibleTokenSimulator;

describe('ConfidentialFungibleToken: registration', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  describe('register', () => {
    it('should register a fresh account', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);

      expect(await cft.isRegistered(ALICE.accountId)).toBe(false);

      await cft.register();

      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should fail when re-registering the same account', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      await expect(cft.register()).rejects.toThrow(
        'ConfidentialFungibleToken: already registered',
      );
    });

    it('should allow distinct users to register independently', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      await cft.register();

      await cft.privateState.switchIdentity(
        CHARLIE.secretKey,
        CHARLIE.encryptionKey,
      );
      await cft.register();

      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
      expect(await cft.isRegistered(BOB.accountId)).toBe(true);
      expect(await cft.isRegistered(CHARLIE.accountId)).toBe(true);
    });

    it('should store the expected pk for the registered EK', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      const ledger = await cft.getPublicState();
      const storedPk = ledger.CFT__encryptionKeys.lookup(ALICE.accountId);
      const expectedPk = derivePk(ALICE.encryptionKey);

      expect(storedPk).toEqual(expectedPk);
    });

    it('should store distinct pks for distinct EKs', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      await cft.register();

      const ledger = await cft.getPublicState();
      const alicePk = ledger.CFT__encryptionKeys.lookup(ALICE.accountId);
      const bobPk = ledger.CFT__encryptionKeys.lookup(BOB.accountId);

      expect(alicePk).not.toEqual(bobPk);
    });

    it('should initialize the balance to Enc(0)', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      const balance = await cft.balanceOf(ALICE.accountId);
      const identity = identityPoint();

      expect(balance.c1).toEqual(identity);
      expect(balance.c2).toEqual(identity);
    });

    it('should leave totalSupply at zero after registration', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      expect(await cft.totalSupply()).toBe(0n);
    });

    it('should fail to transfer from an unregistered account', async () => {
      // Registration is a prerequisite for transfer. _debit asserts the
      // sender is registered.
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);

      await expect(cft.transfer(BOB.accountId, 100n)).rejects.toThrow();
    });

    it('should fail to transfer to an unregistered account', async () => {
      // Alice registers, Bob doesn't. Alice tries to transfer to Bob.
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      await expect(cft.transfer(BOB.accountId, 100n)).rejects.toThrow();
    });
  });

  describe('isRegistered', () => {
    it('should return false for an unregistered account', async () => {
      expect(await cft.isRegistered(ALICE.accountId)).toBe(false);
    });

    it('should return true after registration', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should return false for an account that has not registered, even when others have', async () => {
      await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      await cft.register();

      expect(await cft.isRegistered(BOB.accountId)).toBe(false);
    });
  });

  describe('computeAccountId', () => {
    it('should match the test helper derivation', async () => {
      const users = [ALICE, BOB, CHARLIE];

      for (const user of users) {
        expect(await cft.computeAccountId(user.secretKey)).toEqual(
          user.accountId,
        );
      }
    });

    it('should produce distinct identifiers for distinct keys', async () => {
      const users = [ALICE, BOB, CHARLIE];
      const ids = await Promise.all(
        users.map((u) => cft.computeAccountId(u.secretKey)),
      );

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });

    it('should be deterministic for the same secret key', async () => {
      const id1 = await cft.computeAccountId(ALICE.secretKey);
      const id2 = await cft.computeAccountId(ALICE.secretKey);

      expect(id1).toEqual(id2);
    });
  });

  describe('mint and burn', () => {
    // Note: _mint and _burn are intended to be called from privileged contract
    // contexts (e.g., gated by an Ownable or AccessControl companion module).
    // In these unit tests, we don't model that gating — we call them directly
    // and treat the active identity as both "the minter" and "the account
    // being minted to." This keeps the cache updates straightforward, since
    // the test identity is the one whose plaintext-cache the witness reads.

    describe('_mint', () => {
      it('should credit the recipient and increase totalSupply', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);
        expect(await cft.totalSupply()).toBe(100n);

        // Alice's balance ciphertext should no longer be Enc(0).
        const balance = await cft.balanceOf(ALICE.accountId);
        const identity = identityPoint();
        expect(balance.c1).not.toEqual(identity);
        expect(balance.c2).not.toEqual(identity);
      });

      it('should accumulate across multiple mints', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);

        // Cache the post-mint plaintext so the next _mint's _credit can
        // verify (note: _credit itself doesn't decrypt; it only adds. But
        // any subsequent _burn or transfer would need this.)
        let aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await cft._mint(ALICE.accountId, 50n);

        expect(await cft.totalSupply()).toBe(150n);

        // After the second mint, the cache entry for the old ciphertext is
        // stale; cache the new one.
        aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 150n);

        // Verify Alice can spend her accumulated balance.
        await cft._burn(150n);
        expect(await cft.totalSupply()).toBe(0n);
      });

      it('should mint to a different account than the caller', async () => {
        // Register Alice and Bob; Alice mints to Bob.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
        await cft.register();

        // Switch back to Alice and mint to Bob.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft._mint(BOB.accountId, 100n);

        expect(await cft.totalSupply()).toBe(100n);

        const bobBalance = await cft.balanceOf(BOB.accountId);
        const identity = identityPoint();
        expect(bobBalance.c1).not.toEqual(identity);
        expect(bobBalance.c2).not.toEqual(identity);
      });

      it('should push a memo to the recipient on mint', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);

        const ledger = await cft.getPublicState();
        const aliceMemos = ledger.CFT__memos.lookup(ALICE.accountId);
        // Expect exactly one memo entry after one mint.
        expect(aliceMemos.length()).toBe(1n);
      });

      it('should fail to mint to an unregistered account', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        // Alice does not register.

        await expect(cft._mint(ALICE.accountId, 100n)).rejects.toThrow();
      });

      it('should fail when value exceeds MAX_TRANSFER_VALUE', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        const overBound = (1n << 48n) + 1n;
        await expect(cft._mint(ALICE.accountId, overBound)).rejects.toThrow(
          'ConfidentialFungibleToken: value exceeds bound',
        );
      });

      it('should treat a zero-value mint as a no-op (no semantic restriction)', async () => {
        // The module does not prohibit value=0; _mint(account, 0) credits 0
        // and increments totalSupply by 0 (both no-ops). Documented explicitly.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 0n);
        expect(await cft.totalSupply()).toBe(0n);
      });
    });

    describe('_burn', () => {
      it('should debit the caller and decrease totalSupply', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);
        const aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await cft._burn(40n);

        expect(await cft.totalSupply()).toBe(60n);
      });

      it('should allow burning the entire balance', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);
        let aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await cft._burn(100n);

        expect(await cft.totalSupply()).toBe(0n);

        // The balance now encrypts 0, but it is NOT the identity ciphertext:
        // subEncrypted re-randomizes, so Enc(0) here has non-trivial c1/c2.
        // Verify the balance is treated as 0 by showing a further burn of 1
        // fails for insufficient balance.
        aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 0n);
        await expect(cft._burn(1n)).rejects.toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
      });

      it('should fail to burn more than the balance', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);
        const aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await expect(cft._burn(101n)).rejects.toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
      });

      it('should fail to burn from an unregistered account', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        // Alice does not register.

        await expect(cft._burn(50n)).rejects.toThrow();
      });

      it('should fail when value exceeds MAX_TRANSFER_VALUE', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        const overBound = (1n << 48n) + 1n;
        await expect(cft._burn(overBound)).rejects.toThrow(
          'ConfidentialFungibleToken: value exceeds bound',
        );
      });

      it('should fail with a hostile plaintext witness', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 100n);
        const aliceBalance = await cft.balanceOf(ALICE.accountId);

        // Cache the WRONG plaintext: claim Alice has 1000 when she has 100.
        // ElGamal_assertDecryptsTo (via _debit) should reject this.
        await cft.privateState.cachePlaintext(aliceBalance, 1000n);

        await expect(cft._burn(50n)).rejects.toThrow(
          'ElGamal: plaintext mismatch',
        );
      });
    });

    describe('totalSupply tracking across operations', () => {
      it('should reflect cumulative mints and burns', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft._mint(ALICE.accountId, 1000n);
        expect(await cft.totalSupply()).toBe(1000n);

        let aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 1000n);

        await cft._burn(300n);
        expect(await cft.totalSupply()).toBe(700n);

        aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 700n);

        await cft._mint(ALICE.accountId, 200n);
        expect(await cft.totalSupply()).toBe(900n);

        aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 900n);

        await cft._burn(900n);
        expect(await cft.totalSupply()).toBe(0n);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Transfers
//
// Confidential balances can't be read directly, so "X holds exactly N" is
// proven behaviorally: cache N for the balance and burn N. The burn's
// in-circuit `ElGamal_assertDecryptsTo` only passes if the balance truly
// encrypts N, and the totalSupply delta confirms the amount.
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: transfer', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  const registerAll = async () => {
    for (const u of [ALICE, BOB, CHARLIE]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
  };

  // Registers everyone, mints `amount` to Alice, and leaves Alice active with
  // her balance cached.
  const fundAlice = async (amount: bigint) => {
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._mint(ALICE.accountId, amount);
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      amount,
    );
  };

  it('moves value from sender to recipient and leaves supply unchanged', async () => {
    await fundAlice(100n);

    await cft.transfer(BOB.accountId, 30n);
    expect(await cft.totalSupply()).toBe(100n);

    // Alice holds exactly 70.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      70n,
    );
    await cft._burn(70n);
    expect(await cft.totalSupply()).toBe(30n);

    // Bob holds exactly 30.
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(BOB.accountId),
      30n,
    );
    await cft._burn(30n);
    expect(await cft.totalSupply()).toBe(0n);
  });

  it('rejects a self-transfer', async () => {
    await fundAlice(100n);
    await expect(cft.transfer(ALICE.accountId, 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: self-transfer',
    );
  });

  it('rejects a transfer exceeding the balance', async () => {
    await fundAlice(100n);
    await expect(cft.transfer(BOB.accountId, 101n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
  });

  it('rejects a transfer above MAX_TRANSFER_VALUE', async () => {
    await fundAlice(100n);
    await expect(
      cft.transfer(BOB.accountId, (1n << 48n) + 1n),
    ).rejects.toThrow('ConfidentialFungibleToken: value exceeds bound');
  });
});

// ---------------------------------------------------------------------------
// Escrow allowances: approve / transferFrom / burnFrom
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: escrow allowance', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  const registerAll = async () => {
    for (const u of [ALICE, BOB, CHARLIE]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
  };

  // Alice (owner) funds with `amount` and approves Bob (spender) for `cap`.
  // Leaves Alice active.
  const approveBob = async (amount: bigint, cap: bigint) => {
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._mint(ALICE.accountId, amount);
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      amount,
    );
    await cft.approve(BOB.accountId, cap);
  };

  it('records an allowance and debits the owner balance', async () => {
    await approveBob(100n, 40n);

    // An escrow entry now exists for (Alice, Bob).
    const ledger = await cft.getPublicState();
    expect(
      ledger.CFT__escrow.lookup(ALICE.accountId).member(BOB.accountId),
    ).toBe(true);

    // Alice's main balance was debited by the cap: she now holds 60.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      60n,
    );
    await cft._burn(60n);
    expect(await cft.totalSupply()).toBe(40n);
  });

  it('lets the spender transferFrom up to the allowance', async () => {
    await approveBob(100n, 40n);

    // Bob decrypts his escrow copy (value 40) and caches it, then spends 25
    // to Charlie.
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);
    expect(await cft.totalSupply()).toBe(100n);

    // Charlie holds exactly 25.
    await cft.privateState.switchIdentity(
      CHARLIE.secretKey,
      CHARLIE.encryptionKey,
    );
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(CHARLIE.accountId),
      25n,
    );
    await cft._burn(25n);
    expect(await cft.totalSupply()).toBe(75n);
  });

  it('transferFrom pushes a memo to the recipient', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      40n,
    );

    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    const charlieMemos = (await cft.getPublicState()).CFT__memos.lookup(
      CHARLIE.accountId,
    );
    expect(charlieMemos.length()).toBe(1n);
  });

  it('reduces the allowance by the spent amount on a partial transferFrom', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    let escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    // Remaining allowance is 15: cache the reduced spender copy.
    escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 15n);

    // Spending 16 (over the remaining 15) fails; exactly 15 succeeds.
    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 16n),
    ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 15n);
    expect(await cft.totalSupply()).toBe(100n);
  });

  it('rejects transferFrom with no escrow', async () => {
    await registerAll();
    // Bob never received an approval from Alice.
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 10n),
    ).rejects.toThrow('ConfidentialFungibleToken: no escrow');
  });

  it('rejects transferFrom exceeding the allowance', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 41n),
    ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
  });

  it('burnFrom consumes the allowance and lowers supply', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await cft._burnFrom(ALICE.accountId, 25n);
    // Owner balance (60) untouched; only the escrowed amount is burned.
    expect(await cft.totalSupply()).toBe(75n);
  });

  it('rejects a self-approval', async () => {
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await expect(cft.approve(ALICE.accountId, 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: self-approval',
    );
  });

  it('rejects approving an unregistered spender', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();
    // Bob is not registered.
    await expect(cft.approve(BOB.accountId, 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: spender not registered',
    );
  });

  it('rejects approving the zero account', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();
    await expect(cft.approve(new Uint8Array(32), 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: invalid spender',
    );
  });

  it('rejects approve above MAX_TRANSFER_VALUE', async () => {
    await approveBob(100n, 40n); // registers all + leaves Alice active with cache
    await expect(
      cft.approve(BOB.accountId, (1n << 48n) + 1n),
    ).rejects.toThrow('ConfidentialFungibleToken: value exceeds bound');
  });

  it('rejects transferFrom to the zero account', async () => {
    await approveBob(100n, 40n);
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      40n,
    );
    await expect(
      cft.transferFrom(ALICE.accountId, new Uint8Array(32), 10n),
    ).rejects.toThrow('ConfidentialFungibleToken: invalid receiver');
  });

  it('re-approve refunds the prior escrow to the owner before setting the new cap', async () => {
    // _refundPriorEscrow is the one flow that re-queries a ciphertext the same
    // circuit just produced (the post-refund main balance). We predict that
    // ciphertext via the ElGamal pure circuits and cache its plaintext before
    // the second approve queries it.
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._mint(ALICE.accountId, 100n);
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      100n,
    );

    // First approve: 40 to Bob. Alice's main balance 100 -> 60.
    await cft.approve(BOB.accountId, 40n);

    // Caches the second approve's refund path needs:
    const ownerPk = (await cft.getPublicState()).CFT__encryptionKeys.lookup(
      ALICE.accountId,
    );
    // (a) the owner's escrow copy, decrypted by _refundPriorEscrow.
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).ownerCt,
      40n,
    );
    // (b) the post-refund main balance: addEncrypted(Enc(60), pk, 40, r) = Enc(100),
    //     where r is the "refund_balance"-tagged expansion of the fixed seed.
    const r = elgamal.expandRandomness(
      DEFAULT_RANDOMNESS_SEED,
      padTag('refund_balance'),
    );
    const refunded = elgamal.addEncrypted(
      await cft.balanceOf(ALICE.accountId),
      ownerPk,
      40n,
      r,
    );
    await cft.privateState.cachePlaintext(refunded, 100n);

    // Second approve: 30 to Bob. Refund 40 (main 60 -> 100), then debit 30 (-> 70).
    await cft.approve(BOB.accountId, 30n);

    // Refund proof: Alice holds 70 (= 100 - 30), NOT 30 (= 100 - 40 - 30 without
    // the refund). Caching 70 and burning it only succeeds if the balance truly
    // decrypts to 70.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      70n,
    );
    await expect(cft._burn(71n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
    await cft._burn(70n);
    expect(await cft.totalSupply()).toBe(30n);
  });
});

// ---------------------------------------------------------------------------
// Metadata & default views
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: metadata & views', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('exposes the constructor metadata', async () => {
    expect(await cft.name()).toBe(NAME);
    expect(await cft.symbol()).toBe(SYMBOL);
    expect(await cft.decimals()).toBe(DECIMALS);
  });

  it('balanceOf returns Enc(0) for an unregistered account', async () => {
    // Unregistered accounts hold zero: balanceOf returns a well-formed Enc(0)
    // (identity, identity) — identical for any unregistered account and
    // matching a registered account's fresh balance.
    const bal = await cft.balanceOf(ALICE.accountId);
    const identity = identityPoint();
    expect(bal.c1).toEqual(identity);
    expect(bal.c2).toEqual(identity);
    expect(bal).toEqual(await cft.balanceOf(BOB.accountId));
  });

  it('allowance returns the default entry when no escrow exists', async () => {
    expect(await cft.allowance(ALICE.accountId, BOB.accountId)).toEqual(
      await cft.allowance(BOB.accountId, CHARLIE.accountId),
    );
  });
});

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: memos', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('pushes one memo per credit', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();

    await cft._mint(ALICE.accountId, 10n);
    await cft._mint(ALICE.accountId, 20n);

    const memos = (await cft.getPublicState()).CFT__memos.lookup(
      ALICE.accountId,
    );
    expect(memos.length()).toBe(2n);
  });

  it('clearMemos empties the caller’s memo list', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();
    await cft._mint(ALICE.accountId, 10n);
    expect(
      (await cft.getPublicState()).CFT__memos.lookup(ALICE.accountId).length(),
    ).toBe(1n);

    await cft.clearMemos();

    expect(
      (await cft.getPublicState()).CFT__memos.lookup(ALICE.accountId).length(),
    ).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Per-operation value bound (boundary)
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: value bound', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('accepts a value exactly at MAX_TRANSFER_VALUE (2^48 - 1)', async () => {
    const MAX = (1n << 48n) - 1n;
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();

    await cft._mint(ALICE.accountId, MAX);
    expect(await cft.totalSupply()).toBe(MAX);
  });

  it('rejects 2^48 (one above the bound; undecodable by the wallet table)', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();

    await expect(cft._mint(ALICE.accountId, 1n << 48n)).rejects.toThrow(
      'ConfidentialFungibleToken: value exceeds bound',
    );
  });
});
