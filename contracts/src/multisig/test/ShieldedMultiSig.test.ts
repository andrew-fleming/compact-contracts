import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestParentKey } from '#test-utils/fixtures/shieldedKey.js';
import { ShieldedMultiSigSimulator } from './simulators/ShieldedMultiSigSimulator.js';

const ProposalStatus = { Inactive: 0, Active: 1, Executed: 2, Cancelled: 3 };
const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const THRESHOLD = 2n;
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
// A second genesis color. Used unfunded to reach the never-held-this-color path
// in `ShieldedTreasury._send`, and funded in the multi-color block.
const OTHER_COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken2;
const AMOUNT = 1000n;
const PROPOSAL_AMOUNT = 400n;

// Signer identities are commitments over a secret key, an instance salt, and a
// domain separator. A caller authenticates by proving knowledge of a secret key
// whose commitment is registered: `wit_ShieldedMultiSigSK` supplies it, and the
// `as(...)` helper below swaps it to switch identity.
//
// Note this is NOT the submitting wallet: authorization no longer depends on who
// submits the transaction, only on the secret key the witness returns. That is
// the whole point of the scheme. An attacker who freely chooses the witness
// value still cannot produce a preimage of a registered commitment.
const INSTANCE_SALT = new Uint8Array(32).fill(0xa5);

const SK1 = new Uint8Array(32).fill(0x11);
const SK2 = new Uint8Array(32).fill(0x22);
const SK3 = new Uint8Array(32).fill(0x33);
const SK_OUTSIDER = new Uint8Array(32).fill(0x99);

const ID1 = ShieldedMultiSigSimulator.calculateSignerId(SK1, INSTANCE_SALT);
const ID2 = ShieldedMultiSigSimulator.calculateSignerId(SK2, INSTANCE_SALT);
const ID3 = ShieldedMultiSigSimulator.calculateSignerId(SK3, INSTANCE_SALT);
const SIGNER_COMMITMENTS = [ID1, ID2, ID3];
const OUTSIDER_ID = ShieldedMultiSigSimulator.calculateSignerId(
  SK_OUTSIDER,
  INSTANCE_SALT,
);

const Z_RECIPIENT_PK = shieldedTestParentKey('RECIPIENT');

function makeRecipient(pk: { bytes: Uint8Array }): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address: pk.bytes };
}

// Backend-aware coin builder: live gets a fresh random nonce per run (the node
// persists nullifiers); dry uses `nonce` (else zero) for reproducibility.
function makeCoin(
  color: Uint8Array,
  value: bigint,
  nonce?: Uint8Array,
): { nonce: Uint8Array; color: Uint8Array; value: bigint } {
  return encodeShieldedCoinInfo(color, value, nonce);
}

let multisig: ShieldedMultiSigSimulator;

// A fresh 2-of-3 multisig. Mutating groups deploy one per test (`beforeEach`);
// read-only groups deploy one per group (`beforeAll`) to save a live deploy tx.
const freshMultisig = () =>
  ShieldedMultiSigSimulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS);

/**
 * Switches the acting identity by injecting that signer's secret key into the
 * private state, then returns the simulator for chaining.
 */
const as = async (sk: Uint8Array): Promise<ShieldedMultiSigSimulator> => {
  await multisig.privateState.injectSecretKey(sk);
  return multisig;
};

describe('ShieldedMultiSig', () => {
  describe('constructor', () => {
    it('should initialize with signers and threshold', async () => {
      multisig = await ShieldedMultiSigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
      );
      expect((await multisig.getLedger())._signerCount).toEqual(
        BigInt(SIGNER_COMMITMENTS.length),
      );
      expect((await multisig.getLedger())._threshold).toEqual(THRESHOLD);
    });

    it('should register all signers', async () => {
      multisig = await ShieldedMultiSigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
      );
      for (const signer of SIGNER_COMMITMENTS) {
        expect((await multisig.getLedger())._signers.member(signer)).toEqual(
          true,
        );
      }
    });

    it('should reject non-signers', async () => {
      multisig = await ShieldedMultiSigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
      );
      expect((await multisig.getLedger())._signers.member(OUTSIDER_ID)).toEqual(
        false,
      );
    });

    it('should hardcode the threshold to 2', async () => {
      multisig = await freshMultisig();
      expect((await multisig.getLedger())._threshold).toEqual(2n);
    });

    it('should reject duplicate signer commitments', async () => {
      await expect(
        ShieldedMultiSigSimulator.create(INSTANCE_SALT, [ID1, ID2, ID1]),
      ).rejects.toThrow('Signer: signer already active');
    });
  });

  describe('signer identity', () => {
    beforeEach(async () => {
      multisig = await freshMultisig();
    });

    it('should derive commitments identically off-chain and in-circuit', async () => {
      // Every authorization test depends on this equality; assert it directly so
      // a derivation drift fails here rather than as a confusing "not a signer".
      await (await as(SK1)).approveProposal(
        await (await as(SK1)).createShieldedProposal(
          makeRecipient(Z_RECIPIENT_PK),
          COLOR,
          PROPOSAL_AMOUNT,
        ),
      );
      expect(
        (await multisig.getLedger())._proposalApprovals.lookup(1n).member(ID1),
      ).toEqual(true);
    });

    it('should reject a caller who knows a commitment but not its preimage', async () => {
      // The naive forgery: an attacker reads ID1 off the public ledger and
      // supplies it as their secret key. The contract hashes whatever it is
      // given, so this yields H(ID1, salt, domain) and not ID1.
      await expect(
        (await as(ID1)).createShieldedProposal(
          makeRecipient(Z_RECIPIENT_PK),
          COLOR,
          PROPOSAL_AMOUNT,
        ),
      ).rejects.toThrow('Signer: not a signer');
    });

    it('should reject an unregistered secret key', async () => {
      await expect(
        (await as(SK_OUTSIDER)).createShieldedProposal(
          makeRecipient(Z_RECIPIENT_PK),
          COLOR,
          PROPOSAL_AMOUNT,
        ),
      ).rejects.toThrow('Signer: not a signer');
    });

    it('should bind identity to the instance salt', async () => {
      const otherSalt = new Uint8Array(32).fill(0x5a);
      const idUnderOtherSalt = ShieldedMultiSigSimulator.calculateSignerId(
        SK1,
        otherSalt,
      );
      expect(idUnderOtherSalt).not.toEqual(ID1);
      expect(
        (await multisig.getLedger())._signers.member(idUnderOtherSalt),
      ).toEqual(false);
    });

    it('should isolate signer sets across deployments', async () => {
      // `SK_OUTSIDER` is a registered signer of `other` but of nothing here, so
      // a key that authenticates in one deployment is a stranger in the next.
      const otherSalt = new Uint8Array(32).fill(0x5a);
      const other = await ShieldedMultiSigSimulator.create(otherSalt, [
        ShieldedMultiSigSimulator.calculateSignerId(SK_OUTSIDER, otherSalt),
        ID2,
        ID3,
      ]);

      await other.privateState.injectSecretKey(SK_OUTSIDER);
      await other.createShieldedProposal(
        makeRecipient(Z_RECIPIENT_PK),
        COLOR,
        PROPOSAL_AMOUNT,
      );

      await expect(
        (await as(SK_OUTSIDER)).createShieldedProposal(
          makeRecipient(Z_RECIPIENT_PK),
          COLOR,
          PROPOSAL_AMOUNT,
        ),
      ).rejects.toThrow('Signer: not a signer');
    });
  });

  describe('when initialized', () => {
    describe('deposit', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should accept deposits', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect((await multisig.getLedger())._coins.lookup(COLOR).value).toEqual(
          AMOUNT,
        ); 
      });

      it('should accumulate deposits', async () => {
        await multisig.deposit(
          makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)),
        );
        await multisig.deposit(
          makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)),
        );
        expect((await multisig.getLedger())._coins.lookup(COLOR).value).toEqual(
          AMOUNT * 2n,
        );
      });

      it('should track received total', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect((await multisig.getLedger())._received.lookup(COLOR)).toEqual(
          AMOUNT,
        );
      });
    });

    describe('view - signer manager delegation', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('getSignerCount should match initial count', async () => {
        expect((await multisig.getLedger())._signerCount).toEqual(
          BigInt(SIGNER_COMMITMENTS.length),
        );
      });

      it('getThreshold should match initial threshold', async () => {
        expect((await multisig.getLedger())._threshold).toEqual(THRESHOLD);
      });

      it('isSigner should return true for signer', async () => {
        expect((await multisig.getLedger())._signers.member(ID1)).toEqual(true);
      });

      it('isSigner should return false for non-signer', async () => {
        expect(
          (await multisig.getLedger())._signers.member(OUTSIDER_ID),
        ).toEqual(false);
      });
    });

    describe('view - treasury delegation', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
      });

      it('getTokenBalance should reflect deposits', async () => {
        expect((await multisig.getLedger())._coins.lookup(COLOR).value).toEqual(
          AMOUNT,
        );
      });

      it('getReceivedTotal should reflect deposits', async () => {
        expect((await multisig.getLedger())._received.lookup(COLOR)).toEqual(
          AMOUNT,
        );
      });

      it('getSentTotal should be 0 before any sends', async () => {
        // No send has happened, so `_sent` has no entry for this color at all.
        expect((await multisig.getLedger())._sent.member(COLOR)).toEqual(false);
      });

      it('received minus sent should equal balance', async () => {
        const l = await multisig.getLedger();
        const received = l._received.lookup(COLOR);
        // Nothing has been sent, so `_sent` holds no entry for this color; the
        // net is the received total.
        expect(l._sent.member(COLOR)).toEqual(false);
        expect(received).toEqual(AMOUNT);
      });
    });

    // Caller-gated flows: authorization is resolved from the
    // `wit_ShieldedMultiSigSK` witness, swapped via `as(...)`
    describe('caller-gated proposal flows', () => {
      describe('createShieldedProposal', () => {
        beforeEach(async () => {
          multisig = await freshMultisig();
        });

        it('should allow signer to create proposal', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          expect(id).toEqual(1n);
        });

        it('should store proposal data correctly', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );

          const proposal = (await multisig.getLedger())._proposals.lookup(id);
          expect(proposal.status).toEqual(ProposalStatus.Active);
          expect(proposal.amount).toEqual(PROPOSAL_AMOUNT);
          expect(proposal.color).toEqual(COLOR);
        });

        it('should fail for non-signer', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          await expect(
            (await as(SK_OUTSIDER)).createShieldedProposal(
              to,
              COLOR,
              PROPOSAL_AMOUNT,
            ),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('should fail with zero amount', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          await expect(
            (await as(SK1)).createShieldedProposal(to, COLOR, 0n),
          ).rejects.toThrow('ProposalManager: zero amount');
        });

        it('should reject UnshieldedUser recipient kind', async () => {
          const to = {
            kind: RecipientKind.UnshieldedUser,
            address: Z_RECIPIENT_PK.bytes,
          };
          await expect(
            (await as(SK1)).createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT),
          ).rejects.toThrow(
            'ShieldedMultiSig: recipient must be a shielded user',
          );
        });

        it('should reject Contract recipient kind', async () => {
          const to = {
            kind: RecipientKind.Contract,
            address: new Uint8Array(32).fill(7),
          };
          await expect(
            (await as(SK1)).createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT),
          ).rejects.toThrow(
            'ShieldedMultiSig: recipient must be a shielded user',
          );
        });
      });

      describe('approveProposal', () => {
        let proposalId: bigint;

        beforeEach(async () => {
          multisig = await freshMultisig();
          const to = makeRecipient(Z_RECIPIENT_PK);
          proposalId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
        });

        it('should allow signer to approve', async () => {
          await (await as(SK1)).approveProposal(proposalId);
          expect(
            (await multisig.getLedger())._proposalApprovals
              .lookup(proposalId)
              .member(ID1),
          ).toEqual(true);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(1n);
        });

        it('should allow multiple signers to approve', async () => {
          await (await as(SK1)).approveProposal(proposalId);
          await (await as(SK2)).approveProposal(proposalId);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(2n);
        });

        it('should fail for non-signer', async () => {
          await expect(
            (await as(SK_OUTSIDER)).approveProposal(proposalId),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('should fail for double approval', async () => {
          await (await as(SK1)).approveProposal(proposalId);
          await expect(
            (await as(SK1)).approveProposal(proposalId),
          ).rejects.toThrow('Multisig: already approved');
        });

        it('should fail for non-existing proposal', async () => {
          await expect((await as(SK1)).approveProposal(999n)).rejects.toThrow(
            'ProposalManager: proposal not found',
          );
        });

        it('should fail for executed proposal', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          await (await as(SK1)).approveProposal(proposalId);
          await (await as(SK2)).approveProposal(proposalId);
          await multisig.executeShieldedProposal(proposalId);

          await expect(
            (await as(SK3)).approveProposal(proposalId),
          ).rejects.toThrow('ProposalManager: proposal not active');
        });
      });

      describe('revokeApproval', () => {
        let proposalId: bigint;

        beforeEach(async () => {
          multisig = await freshMultisig();
          const to = makeRecipient(Z_RECIPIENT_PK);
          proposalId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(proposalId);
        });

        it('should allow signer to revoke their approval', async () => {
          await (await as(SK1)).revokeApproval(proposalId);
          expect(
            (await multisig.getLedger())._proposalApprovals
              .lookup(proposalId)
              .member(ID1),
          ).toEqual(false);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(0n);
        });

        it('should fail for non-signer', async () => {
          await expect(
            (await as(SK_OUTSIDER)).revokeApproval(proposalId),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('should fail if not yet approved', async () => {
          await expect(
            (await as(SK2)).revokeApproval(proposalId),
          ).rejects.toThrow('Multisig: not approved');
        });

        it('should allow re-approval after revoke', async () => {
          await (await as(SK1)).revokeApproval(proposalId);
          await (await as(SK1)).approveProposal(proposalId);
          expect(
            (await multisig.getLedger())._proposalApprovals
              .lookup(proposalId)
              .member(ID1),
          ).toEqual(true);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(1n);
        });

        it('should fail for executed proposal', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          await (await as(SK2)).approveProposal(proposalId);
          await multisig.executeShieldedProposal(proposalId);

          await expect(
            (await as(SK1)).revokeApproval(proposalId),
          ).rejects.toThrow('ProposalManager: proposal not active');
        });
      });

      describe('cancelProposal', () => {
        let proposalId: bigint;

        beforeEach(async () => {
          multisig = await freshMultisig();
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(Z_RECIPIENT_PK);
          proposalId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
        });

        const approveToThreshold = async () => {
          await (await as(SK1)).approveProposal(proposalId);
          await (await as(SK2)).approveProposal(proposalId);
        };

        it('should let an approver cancel a proposal at threshold', async () => {
          await approveToThreshold();
          await (await as(SK1)).cancelProposal(proposalId);
          expect(
            (await multisig.getLedger())._proposals.lookup(proposalId).status,
          ).toEqual(ProposalStatus.Cancelled);
        });

        it('should not move funds when cancelling', async () => {
          await approveToThreshold();
          await (await as(SK2)).cancelProposal(proposalId);
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT);
          // No send has happened, so `_sent` has no entry for this color at all.
          expect((await multisig.getLedger())._sent.member(COLOR)).toEqual(
            false,
          );
        });

        it('should fail below threshold', async () => {
          // Guards the approve-then-cancel gambit: one approval is not a quorum,
          // so a lone signer cannot retire a proposal.
          await (await as(SK1)).approveProposal(proposalId);
          await expect(
            (await as(SK1)).cancelProposal(proposalId),
          ).rejects.toThrow('Signer: threshold not met');
        });

        it('should fail for a signer who has not approved', async () => {
          // SK3 is a signer but not an approver, so it cannot kill a transfer
          // SK1 and SK2 agreed on, this is what preserves the M-of-N guarantee.
          await approveToThreshold();
          await expect(
            (await as(SK3)).cancelProposal(proposalId),
          ).rejects.toThrow('Multisig: not approved');
        });

        it('should fail for a non-signer', async () => {
          await approveToThreshold();
          await expect(
            (await as(SK_OUTSIDER)).cancelProposal(proposalId),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('should fail for a non-existing proposal', async () => {
          await expect((await as(SK1)).cancelProposal(999n)).rejects.toThrow(
            'ProposalManager: proposal not found',
          );
        });

        it('should fail when cancelled twice', async () => {
          await approveToThreshold();
          await (await as(SK1)).cancelProposal(proposalId);
          await expect(
            (await as(SK1)).cancelProposal(proposalId),
          ).rejects.toThrow('ProposalManager: proposal not active');
        });

        it('should retire an unexecutable proposal permanently', async () => {
          // The motivating case: a proposal naming a color the treasury does not
          // hold reaches quorum, fails to execute, and without cancel would sit
          // Active forever.
          const stuckId = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            OTHER_COLOR,
            1n,
          );
          await (await as(SK1)).approveProposal(stuckId);
          await (await as(SK2)).approveProposal(stuckId);
          await expect(
            multisig.executeShieldedProposal(stuckId),
          ).rejects.toThrow('ShieldedTreasury: no balance');

          await (await as(SK1)).cancelProposal(stuckId);
          expect(
            (await multisig.getLedger())._proposals.lookup(stuckId).status,
          ).toEqual(ProposalStatus.Cancelled);
        });

        describe('once cancelled', () => {
          beforeEach(async () => {
            await approveToThreshold();
            await (await as(SK1)).cancelProposal(proposalId);
          });

          it('should reject execution', async () => {
            await expect(
              multisig.executeShieldedProposal(proposalId),
            ).rejects.toThrow('ProposalManager: proposal not active');
          });

          it('should reject further approval', async () => {
            await expect(
              (await as(SK3)).approveProposal(proposalId),
            ).rejects.toThrow('ProposalManager: proposal not active');
          });

          it('should reject revocation', async () => {
            await expect(
              (await as(SK2)).revokeApproval(proposalId),
            ).rejects.toThrow('ProposalManager: proposal not active');
          });
        });
      });

      describe('executeShieldedProposal', () => {
        let proposalId: bigint;

        beforeEach(async () => {
          multisig = await freshMultisig();
          await multisig.deposit(makeCoin(COLOR, AMOUNT));

          const to = makeRecipient(Z_RECIPIENT_PK);
          proposalId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(proposalId);
          await (await as(SK2)).approveProposal(proposalId);
        });

        it('should execute when threshold is met', async () => {
          await multisig.executeShieldedProposal(proposalId);
          expect(
            (await multisig.getLedger())._proposals.lookup(proposalId).status,
          ).toEqual(ProposalStatus.Executed);
        });

        it('should return sent coin and change in result', async () => {
          const result = await multisig.executeShieldedProposal(proposalId);
          expect(result.sent.value).toEqual(PROPOSAL_AMOUNT);
          expect(result.sent.color).toEqual(COLOR);
          expect(result.change.is_some).toEqual(true);
          expect(result.change.value.value).toEqual(AMOUNT - PROPOSAL_AMOUNT);
          expect(result.change.value.color).toEqual(COLOR);
        });

        it('should return no change when sending full balance', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const fullId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            AMOUNT,
          );
          await (await as(SK1)).approveProposal(fullId);
          await (await as(SK2)).approveProposal(fullId);

          const result = await multisig.executeShieldedProposal(fullId);
          expect(result.sent.value).toEqual(AMOUNT);
          expect(result.change.is_some).toEqual(false);
        });

        it('should deduct from treasury balance', async () => {
          await multisig.executeShieldedProposal(proposalId);
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - PROPOSAL_AMOUNT);
        });

        it('should track sent total', async () => {
          await multisig.executeShieldedProposal(proposalId);
          expect((await multisig.getLedger())._sent.lookup(COLOR)).toEqual(
            PROPOSAL_AMOUNT,
          );
        });

        it('should fail when threshold is not met', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id2 = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            100n,
          );
          await (await as(SK1)).approveProposal(id2);

          await expect(multisig.executeShieldedProposal(id2)).rejects.toThrow(
            'Signer: threshold not met',
          );
        });

        it('should fail for non-existing proposal', async () => {
          await expect(multisig.executeShieldedProposal(999n)).rejects.toThrow(
            'ProposalManager: proposal not found',
          );
        });

        it('should fail when executed twice', async () => {
          await multisig.executeShieldedProposal(proposalId);
          await expect(
            multisig.executeShieldedProposal(proposalId),
          ).rejects.toThrow('ProposalManager: proposal not active');
        });

        it('should fail with insufficient treasury balance', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const bigId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            AMOUNT + 1n,
          );
          await (await as(SK1)).approveProposal(bigId);
          await (await as(SK2)).approveProposal(bigId);

          await expect(multisig.executeShieldedProposal(bigId)).rejects.toThrow(
            'ShieldedTreasury: coin value insufficient',
          );
        });

        it('should fail for a color the treasury has never held', async () => {
          // Distinct from the insufficiency above: that one holds the color and
          // asks for too much, reaching the `coin.value >= amount` assert
          const to = makeRecipient(Z_RECIPIENT_PK);
          const otherId = await (await as(SK1)).createShieldedProposal(
            to,
            OTHER_COLOR,
            1n,
          );
          await (await as(SK1)).approveProposal(otherId);
          await (await as(SK2)).approveProposal(otherId);

          await expect(
            multisig.executeShieldedProposal(otherId),
          ).rejects.toThrow('ShieldedTreasury: no balance');
        });

        it('should fail when an approval is revoked back below threshold', async () => {
          // The central hazard of on-chain approval accumulation: the threshold
          // is met, then a signer withdraws before anyone executes. Execute
          // re-reads the count, so it must fail rather than settle on a stale one.
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(THRESHOLD);
          await (await as(SK2)).revokeApproval(proposalId);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(THRESHOLD - 1n);

          await expect(
            multisig.executeShieldedProposal(proposalId),
          ).rejects.toThrow('Signer: threshold not met');
        });
      });

      // `deposit` and `executeShieldedProposal` are deliberately open to any caller
      describe('ungated by design', () => {
        beforeEach(async () => {
          multisig = await freshMultisig();
        });

        it('should let a non-signer deposit', async () => {
          await (await as(SK_OUTSIDER)).deposit(makeCoin(COLOR, AMOUNT));
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT);
        });

        it('should let a non-signer execute once the threshold is met', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);

          // The recipient and amount are fixed by the proposal, so a non-signer
          // executing gains nothing beyond paying the fee and picking the moment.
          await (await as(SK_OUTSIDER)).executeShieldedProposal(id);
          expect(
            (await multisig.getLedger())._proposals.lookup(id).status,
          ).toEqual(ProposalStatus.Executed);
        });
      });

      // Touching an unknown id must not create ledger entries for it.
      // `ProposalManager`'s "proposal not found" assert is covered separately, by
      // the approve / cancel / execute specs.
      describe('ledger state for an unknown proposal id', () => {
        const UNKNOWN_ID = 999n;

        beforeAll(async () => {
          multisig = await freshMultisig();
        });

        it('should hold no proposal entry', async () => {
          expect(
            (await multisig.getLedger())._proposals.member(UNKNOWN_ID),
          ).toEqual(false);
        });

        it('should hold no approval-count entry', async () => {
          expect(
            (await multisig.getLedger())._approvalCount.member(UNKNOWN_ID),
          ).toEqual(false);
        });

        it('should hold no approvals entry', async () => {
          expect(
            (await multisig.getLedger())._proposalApprovals.member(UNKNOWN_ID),
          ).toEqual(false);
        });
      });

      describe('view - approvals', () => {
        beforeAll(async () => {
          multisig = await freshMultisig();
        });

        it('should hold no approvals entry until the first approval', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          // No approval yet, so the per-proposal map has not been created.
          expect(
            (await multisig.getLedger())._proposalApprovals.member(id),
          ).toEqual(false);
        });

        it('should hold no approval-count entry for a new proposal', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          expect(
            (await multisig.getLedger())._approvalCount.member(id),
          ).toEqual(false);
        });
      });

      describe('view - proposal fields', () => {
        let proposalId: bigint;

        beforeAll(async () => {
          multisig = await freshMultisig();
          const to = makeRecipient(Z_RECIPIENT_PK);
          proposalId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
        });

        it('should store recipient, amount, and color on the proposal', async () => {
          const proposal = (await multisig.getLedger())._proposals.lookup(
            proposalId,
          );
          expect(proposal.to.kind).toEqual(RecipientKind.ShieldedUser);
          expect(proposal.to.address).toEqual(Z_RECIPIENT_PK.bytes);
          expect(proposal.amount).toEqual(PROPOSAL_AMOUNT);
          expect(proposal.color).toEqual(COLOR);
        });
      });

      describe('full lifecycle', () => {
        beforeEach(async () => {
          multisig = await freshMultisig();
        });

        it('should handle deposit -> propose -> approve -> execute', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT);

          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );

          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(id),
          ).toEqual(THRESHOLD);

          await multisig.executeShieldedProposal(id);
          expect(
            (await multisig.getLedger())._proposals.lookup(id).status,
          ).toEqual(ProposalStatus.Executed);
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - PROPOSAL_AMOUNT);
          const received = (await multisig.getLedger())._received.lookup(COLOR);
          const sent = (await multisig.getLedger())._sent.lookup(COLOR);
          expect(received - sent).toEqual(AMOUNT - PROPOSAL_AMOUNT);
        });

        it('should handle multiple proposals concurrently', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));

          const to = makeRecipient(Z_RECIPIENT_PK);
          const id1 = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            200n,
          );
          const id2 = await (await as(SK2)).createShieldedProposal(
            to,
            COLOR,
            300n,
          );

          await (await as(SK1)).approveProposal(id1);
          await (await as(SK2)).approveProposal(id1);
          await multisig.executeShieldedProposal(id1);

          await (await as(SK1)).approveProposal(id2);
          await (await as(SK3)).approveProposal(id2);
          await multisig.executeShieldedProposal(id2);

          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - 200n - 300n);
        });

        it('should handle approve -> revoke -> re-approve -> execute', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );

          await (await as(SK1)).approveProposal(id);
          await (await as(SK1)).revokeApproval(id);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(id),
          ).toEqual(0n);

          await (await as(SK2)).approveProposal(id);
          await (await as(SK3)).approveProposal(id);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(id),
          ).toEqual(2n);

          await multisig.executeShieldedProposal(id);
          expect(
            (await multisig.getLedger())._proposals.lookup(id).status,
          ).toEqual(ProposalStatus.Executed);
        });
      });

      // The treasury keys `_coins`, `_received`, and `_sent` by color. This is the
      // only block that funds two colors at once, so it is where the per-color
      // dimension is exercised.
      describe('multi-color accounting', () => {
        const OTHER_AMOUNT = 700n;

        beforeEach(async () => {
          multisig = await freshMultisig();
          await multisig.deposit(
            makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)),
          );
          await multisig.deposit(
            makeCoin(OTHER_COLOR, OTHER_AMOUNT, new Uint8Array(32).fill(2)),
          );
        });

        it('should track balances per color', async () => {
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT);
          expect(
            (await multisig.getLedger())._coins.lookup(OTHER_COLOR).value,
          ).toEqual(OTHER_AMOUNT);
        });

        it('should track received totals per color', async () => {
          expect((await multisig.getLedger())._received.lookup(COLOR)).toEqual(
            AMOUNT,
          );
          expect(
            (await multisig.getLedger())._received.lookup(OTHER_COLOR),
          ).toEqual(OTHER_AMOUNT);
        });

        it('should leave other colors untouched when spending one', async () => {
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          await multisig.executeShieldedProposal(id);

          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - PROPOSAL_AMOUNT);
          expect((await multisig.getLedger())._sent.lookup(COLOR)).toEqual(
            PROPOSAL_AMOUNT,
          );

          expect(
            (await multisig.getLedger())._coins.lookup(OTHER_COLOR).value,
          ).toEqual(OTHER_AMOUNT);
          // The untouched color has no `_sent` entry at all.
          expect(
            (await multisig.getLedger())._sent.member(OTHER_COLOR),
          ).toEqual(false);
        });

        it('should keep one color spendable after another is drained', async () => {
          const drainId = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            AMOUNT,
          );
          await (await as(SK1)).approveProposal(drainId);
          await (await as(SK2)).approveProposal(drainId);
          await multisig.executeShieldedProposal(drainId);
          // A full send deletes the entry rather than zeroing it.
          expect((await multisig.getLedger())._coins.member(COLOR)).toEqual(
            false,
          );

          const otherId = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            OTHER_COLOR,
            OTHER_AMOUNT,
          );
          await (await as(SK1)).approveProposal(otherId);
          await (await as(SK2)).approveProposal(otherId);
          await multisig.executeShieldedProposal(otherId);
          expect(
            (await multisig.getLedger())._coins.member(OTHER_COLOR),
          ).toEqual(false);
        });
      });

      // Sending the full balance takes the `else` branch in `ShieldedTreasury._send`
      // and calls `_coins.remove(color)`. Other specs only assert `change.is_some`
      // is false; these cover what the removal leaves behind.
      describe('post-drain lifecycle', () => {
        const drainFully = async () => {
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          await multisig.executeShieldedProposal(id);
        };

        beforeEach(async () => {
          multisig = await freshMultisig();
          await multisig.deposit(
            makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(3)),
          );
          await drainFully();
        });

        it('should delete the coin entry entirely', async () => {
          // A full send takes the `else` branch in `ShieldedTreasury._send` and
          // removes the entry rather than storing a zero-value coin which is
          // what makes a later spend fail with "no balance" rather than an
          // insufficiency.
          expect((await multisig.getLedger())._coins.member(COLOR)).toEqual(
            false,
          );
        });

        it('should preserve cumulative totals across the drain', async () => {
          // `_received` is cumulative and must survive the coin removal; only the
          // live coin is deleted.
          expect((await multisig.getLedger())._received.lookup(COLOR)).toEqual(
            AMOUNT,
          );
          expect((await multisig.getLedger())._sent.lookup(COLOR)).toEqual(
            AMOUNT,
          );
        });

        it('should fail a further spend with no balance', async () => {
          // Reaches the `_coins.member` guard, not the insufficiency one
          // The entry no longer exists at all
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            1n,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          await expect(multisig.executeShieldedProposal(id)).rejects.toThrow(
            'ShieldedTreasury: no balance',
          );
        });

        it('should become spendable again after a fresh deposit', async () => {
          await multisig.deposit(
            makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(4)),
          );
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT);
          expect((await multisig.getLedger())._received.lookup(COLOR)).toEqual(
            AMOUNT * 2n,
          );

          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          await multisig.executeShieldedProposal(id);

          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - PROPOSAL_AMOUNT);
          expect((await multisig.getLedger())._sent.lookup(COLOR)).toEqual(
            AMOUNT + PROPOSAL_AMOUNT,
          );
        });
      });

      // The threshold is hardcoded to 2, so 1-of-3 and 3-of-3 are not
      // constructible. What is testable is the over-threshold case and the two
      // properties fixing the threshold is meant to guarantee.
      describe('fixed 2-of-3 threshold', () => {
        let proposalId: bigint;

        beforeEach(async () => {
          multisig = await freshMultisig();
          await multisig.deposit(
            makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(5)),
          );
          proposalId = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
        });

        it('should report a threshold of 2 on the ledger', async () => {
          expect((await multisig.getLedger())._threshold).toEqual(2n);
          expect((await multisig.getLedger())._signerCount).toEqual(3n);
        });

        it('should never execute on one approval', async () => {
          await (await as(SK1)).approveProposal(proposalId);
          await expect(
            multisig.executeShieldedProposal(proposalId),
          ).rejects.toThrow('Signer: threshold not met');
        });

        it('should keep cancel quorum-gated on one approval', async () => {
          // The companion guarantee: `cancelProposal`'s quorum guard collapses at
          // a threshold of 1, where a single approval is already a quorum. Fixed
          // at 2, one approval cannot cancel, so the approve-then-cancel gambit
          // stays closed.
          await (await as(SK2)).approveProposal(proposalId);
          await expect(
            (await as(SK2)).cancelProposal(proposalId),
          ).rejects.toThrow('Signer: threshold not met');
        });

        it('should execute when approvals exceed the threshold', async () => {
          await (await as(SK1)).approveProposal(proposalId);
          await (await as(SK2)).approveProposal(proposalId);
          await (await as(SK3)).approveProposal(proposalId);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(proposalId),
          ).toEqual(3n);

          await multisig.executeShieldedProposal(proposalId);
          expect(
            (await multisig.getLedger())._proposals.lookup(proposalId).status,
          ).toEqual(ProposalStatus.Executed);
        });
      });

      // Each of these pins a way the contract can be driven into an
      // awkward or self-harming state. None is a vulnerability. No funds are at
      // risk and no authorization is bypassed, but each is behaviour a consumer
      // should know about rather than discover
      describe('lifecycle hazards', () => {
        beforeEach(async () => {
          multisig = await freshMultisig();
        });

        it('should reject a zero-value deposit', async () => {
          // `ShieldedTreasury._deposit` permits a zero-value coin, however,
          // the multisig does not
          await expect(
            multisig.deposit(
              makeCoin(OTHER_COLOR, 0n, new Uint8Array(32).fill(9)),
            ),
          ).rejects.toThrow('ShieldedMultiSig: zero-value deposit');

          const l = await multisig.getLedger();
          expect(l._coins.member(OTHER_COLOR)).toEqual(false);
        });

        it('should still have no way to retire a zero-value entry, if one existed', async () => {
          await expect(
            (await as(SK1)).createShieldedProposal(
              makeRecipient(Z_RECIPIENT_PK),
              OTHER_COLOR,
              0n,
            ),
          ).rejects.toThrow('ProposalManager: zero amount');
        });

        it('should reject cancellation of an executed proposal', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          await multisig.executeShieldedProposal(id);

          await expect((await as(SK1)).cancelProposal(id)).rejects.toThrow(
            'ProposalManager: proposal not active',
          );
        });

        it('should never reuse a proposal id', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const first = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(first);
          await (await as(SK2)).approveProposal(first);
          await multisig.executeShieldedProposal(first);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(first),
          ).toEqual(THRESHOLD);

          const second = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          expect(second).not.toEqual(first);
          expect(second).toEqual(first + 1n);
          // The new proposal starts clean; the retained approvals belong to the
          // old id alone.
          expect(
            (await multisig.getLedger())._approvalCount.member(second),
          ).toEqual(false);
          expect(
            (await multisig.getLedger())._proposalApprovals.member(second),
          ).toEqual(false);
        });

        it('should retain approval state after execution', async () => {
          // Approvals are never pruned once a proposal executes
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          await multisig.executeShieldedProposal(id);

          const l = await multisig.getLedger();
          expect(
            (await multisig.getLedger())._approvalCount.lookup(id),
          ).toEqual(THRESHOLD);
          expect(l._proposalApprovals.member(id)).toEqual(true);
          expect(l._proposalApprovals.lookup(id).size()).toEqual(THRESHOLD);
        });

        it('should make an unexecutable proposal uncancellable once approvals are withdrawn', async () => {
          // The self-harm case worth knowing: `cancelProposal` needs the caller to
          // be an approver AND the proposal to be at quorum. Revoking does both
          // kinds of damage at once as it drops the count below quorum and clears
          // the caller's approver flag. Recoverable by re-approving to quorum
          // and then cancelling.
          const stuckId = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            OTHER_COLOR,
            5n,
          );
          await (await as(SK1)).approveProposal(stuckId);
          await (await as(SK2)).approveProposal(stuckId);
          await (await as(SK2)).revokeApproval(stuckId);
          await (await as(SK1)).revokeApproval(stuckId);
          expect(
            (await multisig.getLedger())._approvalCount.lookup(stuckId),
          ).toEqual(0n);

          await expect((await as(SK1)).cancelProposal(stuckId)).rejects.toThrow(
            'Multisig: not approved',
          );

          // The way out: re-approve to quorum, then cancel.
          await (await as(SK1)).approveProposal(stuckId);
          await (await as(SK2)).approveProposal(stuckId);
          await (await as(SK1)).cancelProposal(stuckId);
          expect(
            (await multisig.getLedger())._proposals.lookup(stuckId).status,
          ).toEqual(ProposalStatus.Cancelled);
        });
      });

      // Does a payout actually land somewhere the recipient can use? Every other
      // spec asserts the treasury's side of a send. This asserts the recipient's:
      // the coin `executeShieldedProposal` reports as `sent` is fed back into a
      // fresh multisig as a deposit, which forces the recipient's wallet to spend
      // it as a real transaction input. If the payout were unspendable, the
      // treasury's books would still balance and every other test would pass.
      //
      // Only meaningful on live. The dry simulator accepts any coin as a deposit
      // without the wallet owning it, so on dry this passes vacuously.
      describe('recipient can spend the payout', () => {
        it('should produce a sent coin the recipient can spend', async () => {
          multisig = await freshMultisig();
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);

          const { sent } = await multisig.executeShieldedProposal(id);
          expect(sent.value).toEqual(PROPOSAL_AMOUNT);
          expect(sent.color).toEqual(COLOR);

          // Spend it: a second multisig receives the very coin just paid out.
          const sink = await freshMultisig();
          await sink.deposit(sent);
          expect((await sink.getLedger())._coins.lookup(COLOR).value).toEqual(
            PROPOSAL_AMOUNT,
          );
        });
      });

      describe('boundary values', () => {
        const MAX_UINT128 = 2n ** 128n - 1n;

        beforeEach(async () => {
          multisig = await freshMultisig();
          await multisig.deposit(
            makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(6)),
          );
        });

        const approveAndExecute = async (id: bigint) => {
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          return multisig.executeShieldedProposal(id);
        };

        it('should accept the smallest non-zero amount', async () => {
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            1n,
          );
          const result = await approveAndExecute(id);
          expect(result.sent.value).toEqual(1n);
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - 1n);
        });

        it('should store a max-Uint128 amount', async () => {
          const id = await (await as(SK1)).createShieldedProposal(
            makeRecipient(Z_RECIPIENT_PK),
            COLOR,
            MAX_UINT128,
          );
          expect(
            (await multisig.getLedger())._proposals.lookup(id).amount,
          ).toEqual(MAX_UINT128);
        });

        it('should treat a zero recipient address as a burn', async () => {
          const id = await (await as(SK1)).createShieldedProposal(
            { kind: RecipientKind.ShieldedUser, address: new Uint8Array(32) },
            COLOR,
            PROPOSAL_AMOUNT,
          );
          const result = await approveAndExecute(id);

          expect(result.sent.value).toEqual(PROPOSAL_AMOUNT);
          expect(
            (await multisig.getLedger())._proposals.lookup(id).status,
          ).toEqual(ProposalStatus.Executed);
          expect(
            (await multisig.getLedger())._coins.lookup(COLOR).value,
          ).toEqual(AMOUNT - PROPOSAL_AMOUNT);
          expect((await multisig.getLedger())._sent.lookup(COLOR)).toEqual(
            PROPOSAL_AMOUNT,
          );
        });

        it('should reject a recipient kind outside the enum', async () => {
          await expect(
            (await as(SK1)).createShieldedProposal(
              { kind: 3, address: Z_RECIPIENT_PK.bytes },
              COLOR,
              PROPOSAL_AMOUNT,
            ),
          ).rejects.toThrow(/type error: createShieldedProposal argument/);
        });
      });
    });
  });
});
