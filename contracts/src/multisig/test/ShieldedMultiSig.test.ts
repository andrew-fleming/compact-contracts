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
// A second genesis color the treasury is never funded with, for the
// never-held-this-color path through `ShieldedTreasury._send`.
const OTHER_COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken2;
const AMOUNT = 1000n;
const PROPOSAL_AMOUNT = 400n;

// Signer identities are commitments over a secret key, an instance salt, and a
// domain separator. A caller authenticates by proving knowledge of a secret key
// whose commitment is registered — `wit_ShieldedMultiSigSK` supplies it, and the
// `as(...)` helper below swaps it to switch identity.
//
// Note this is NOT the submitting wallet: authorization no longer depends on who
// submits the transaction, only on the secret key the witness returns. That is
// the whole point of the scheme — an attacker who freely chooses the witness
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
  ShieldedMultiSigSimulator.create(
    INSTANCE_SALT,
    SIGNER_COMMITMENTS,
    THRESHOLD,
  );

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
        THRESHOLD,
      );
      expect(await multisig.getSignerCount()).toEqual(
        BigInt(SIGNER_COMMITMENTS.length),
      );
      expect(await multisig.getThreshold()).toEqual(THRESHOLD);
    });

    it('should register all signers', async () => {
      multisig = await ShieldedMultiSigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        THRESHOLD,
      );
      for (const signer of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(signer)).toEqual(true);
      }
    });

    it('should reject non-signers', async () => {
      multisig = await ShieldedMultiSigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        THRESHOLD,
      );
      expect(await multisig.isSigner(OUTSIDER_ID)).toEqual(false);
    });

    it('should fail with zero threshold', async () => {
      await expect(
        ShieldedMultiSigSimulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, 0n),
      ).rejects.toThrow('Signer: threshold must not be zero');
    });

    it('should fail with threshold exceeding signer count', async () => {
      await expect(
        ShieldedMultiSigSimulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, 4n),
      ).rejects.toThrow('Signer: threshold exceeds signer count');
    });

    it('should reject duplicate signer commitments', async () => {
      await expect(
        ShieldedMultiSigSimulator.create(
          INSTANCE_SALT,
          [ID1, ID2, ID1],
          THRESHOLD,
        ),
      ).rejects.toThrow('Signer: signer already active');
    });
  });

  // The property that makes this scheme sound: authorization requires a preimage
  // of a registered commitment, not merely knowledge of it. Signer commitments
  // are public — they sit in the exported `_signers` set and `isSigner` reads
  // them back — so a scheme that accepted the commitment itself would be
  // forgeable by anyone. These specs pin that it does not.
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
      expect(await multisig.isProposalApprovedBySigner(1n, ID1)).toEqual(true);
    });

    it('should reject a caller who knows a commitment but not its preimage', async () => {
      // The naive forgery: an attacker reads ID1 off the public ledger and
      // supplies it as their secret key. The contract hashes whatever it is
      // given, so this yields H(ID1, salt, domain) — not ID1.
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
      // The same secret key yields a different identity under a different salt,
      // so a signer registered here cannot authenticate in another deployment —
      // and their identities across deployments are not correlatable.
      const otherSalt = new Uint8Array(32).fill(0x5a);
      const idUnderOtherSalt = ShieldedMultiSigSimulator.calculateSignerId(
        SK1,
        otherSalt,
      );
      expect(idUnderOtherSalt).not.toEqual(ID1);
      expect(await multisig.isSigner(idUnderOtherSalt)).toEqual(false);
    });

    it('should isolate signer sets across deployments', async () => {
      // `SK_OUTSIDER` is a registered signer of `other` but of nothing here, so
      // a key that authenticates in one deployment is a stranger in the next.
      const otherSalt = new Uint8Array(32).fill(0x5a);
      const other = await ShieldedMultiSigSimulator.create(
        otherSalt,
        [
          ShieldedMultiSigSimulator.calculateSignerId(SK_OUTSIDER, otherSalt),
          ID2,
          ID3,
        ],
        THRESHOLD,
      );

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
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
      });

      it('should accumulate deposits', async () => {
        await multisig.deposit(
          makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)),
        );
        await multisig.deposit(
          makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)),
        );
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
      });

      it('should track received total', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(await multisig.getReceivedTotal(COLOR)).toEqual(AMOUNT);
      });
    });

    describe('view - signer manager delegation', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('getSignerCount should match initial count', async () => {
        expect(await multisig.getSignerCount()).toEqual(
          BigInt(SIGNER_COMMITMENTS.length),
        );
      });

      it('getThreshold should match initial threshold', async () => {
        expect(await multisig.getThreshold()).toEqual(THRESHOLD);
      });

      it('isSigner should return true for signer', async () => {
        expect(await multisig.isSigner(ID1)).toEqual(true);
      });

      it('isSigner should return false for non-signer', async () => {
        expect(await multisig.isSigner(OUTSIDER_ID)).toEqual(false);
      });
    });

    describe('view - treasury delegation', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
      });

      it('getTokenBalance should reflect deposits', async () => {
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
      });

      it('getReceivedTotal should reflect deposits', async () => {
        expect(await multisig.getReceivedTotal(COLOR)).toEqual(AMOUNT);
      });

      it('getSentTotal should be 0 before any sends', async () => {
        expect(await multisig.getSentTotal(COLOR)).toEqual(0n);
      });

      it('received minus sent should equal balance', async () => {
        // The preset dropped getReceivedMinusSent to fit the deploy block limit;
        // derive it from the totals the preset does expose.
        const received = await multisig.getReceivedTotal(COLOR);
        const sent = await multisig.getSentTotal(COLOR);
        expect(received - sent).toEqual(AMOUNT);
      });
    });

    // Caller-gated flows: authorization is resolved from the
    // `wit_ShieldedMultiSigSK` witness, swapped via `as(...)`. Unlike the
    // previous `ownPublicKey()` scheme these do not depend on which wallet
    // submits, so the same specs hold on dry and live.
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

          const proposal = await multisig.getProposal(id);
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
            'ShieldedMultiSig: recipient must be a shielded user or contract',
          );
        });

        it('should accept Contract recipient kind', async () => {
          const to = {
            kind: RecipientKind.Contract,
            address: new Uint8Array(32).fill(7),
          };
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          expect(id).toEqual(1n);
          expect((await multisig.getProposal(id)).to.kind).toEqual(
            RecipientKind.Contract,
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
            await multisig.isProposalApprovedBySigner(proposalId, ID1),
          ).toEqual(true);
          expect(await multisig.getApprovalCount(proposalId)).toEqual(1n);
        });

        it('should allow multiple signers to approve', async () => {
          await (await as(SK1)).approveProposal(proposalId);
          await (await as(SK2)).approveProposal(proposalId);
          expect(await multisig.getApprovalCount(proposalId)).toEqual(2n);
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
            await multisig.isProposalApprovedBySigner(proposalId, ID1),
          ).toEqual(false);
          expect(await multisig.getApprovalCount(proposalId)).toEqual(0n);
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
            await multisig.isProposalApprovedBySigner(proposalId, ID1),
          ).toEqual(true);
          expect(await multisig.getApprovalCount(proposalId)).toEqual(1n);
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
          expect(await multisig.getProposalStatus(proposalId)).toEqual(
            ProposalStatus.Cancelled,
          );
        });

        it('should not move funds when cancelling', async () => {
          await approveToThreshold();
          await (await as(SK2)).cancelProposal(proposalId);
          expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
          expect(await multisig.getSentTotal(COLOR)).toEqual(0n);
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
          // SK1 and SK2 agreed on — this is what preserves the M-of-N guarantee.
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
          expect(await multisig.getProposalStatus(stuckId)).toEqual(
            ProposalStatus.Cancelled,
          );
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
          // Fund the treasury
          await multisig.deposit(makeCoin(COLOR, AMOUNT));

          // Create and approve proposal to threshold
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
          expect(await multisig.getProposalStatus(proposalId)).toEqual(
            ProposalStatus.Executed,
          );
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
          // Create proposal for the full amount
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
          expect(await multisig.getTokenBalance(COLOR)).toEqual(
            AMOUNT - PROPOSAL_AMOUNT,
          );
        });

        it('should track sent total', async () => {
          await multisig.executeShieldedProposal(proposalId);
          expect(await multisig.getSentTotal(COLOR)).toEqual(PROPOSAL_AMOUNT);
        });

        it('should fail when threshold is not met', async () => {
          // Create a new proposal with only 1 approval
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
          // Create proposal for more than treasury holds
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
          // asks for too much, reaching the `coin.value >= amount` assert. This
          // reaches the earlier `_coins.member(color)` guard, which no other
          // spec exercises.
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

        it('should execute to a contract recipient', async () => {
          // `RecipientKind.Contract` is accepted at creation elsewhere, but only
          // here is it actually executed — this is the sole spec that drives
          // `toShieldedRecipient` down its right-variant (ContractAddress)
          // branch end to end.
          const to = {
            kind: RecipientKind.Contract,
            address: new Uint8Array(32).fill(7),
          };
          const contractId = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          await (await as(SK1)).approveProposal(contractId);
          await (await as(SK2)).approveProposal(contractId);

          const result = await multisig.executeShieldedProposal(contractId);
          expect(result.sent.value).toEqual(PROPOSAL_AMOUNT);
          expect(await multisig.getProposalStatus(contractId)).toEqual(
            ProposalStatus.Executed,
          );
        });

        it('should fail when an approval is revoked back below threshold', async () => {
          // The central hazard of on-chain approval accumulation: the threshold
          // is met, then a signer withdraws before anyone executes. Execute
          // re-reads the count, so it must fail rather than settle on a stale one.
          expect(await multisig.getApprovalCount(proposalId)).toEqual(
            THRESHOLD,
          );
          await (await as(SK2)).revokeApproval(proposalId);
          expect(await multisig.getApprovalCount(proposalId)).toEqual(
            THRESHOLD - 1n,
          );

          await expect(
            multisig.executeShieldedProposal(proposalId),
          ).rejects.toThrow('Signer: threshold not met');
        });
      });

      // Two circuits are deliberately open to any caller. Both are load-bearing
      // for the asynchronous workflow, and both are documented as intentional in
      // the module header — so they get specs, or a later reviewer "tightening"
      // them would silently contradict the docs and break the design.
      describe('ungated by design', () => {
        beforeEach(async () => {
          multisig = await freshMultisig();
        });

        it('should let a non-signer deposit', async () => {
          await (await as(SK_OUTSIDER)).deposit(makeCoin(COLOR, AMOUNT));
          expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
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
          expect(await multisig.getProposalStatus(id)).toEqual(
            ProposalStatus.Executed,
          );
        });
      });

      // The proposal views split deliberately: `getProposal` / `getProposalStatus`
      // assert existence, while `getApprovalCount` / `isProposalApprovedBySigner`
      // answer for an unknown id without asserting. That asymmetry reads like an
      // oversight, so it is pinned here on purpose.
      describe('view - unknown proposal id', () => {
        const UNKNOWN_ID = 999n;

        beforeAll(async () => {
          multisig = await freshMultisig();
        });

        it('getProposal should reject an unknown id', async () => {
          await expect(multisig.getProposal(UNKNOWN_ID)).rejects.toThrow(
            'ProposalManager: proposal not found',
          );
        });

        it('getProposalStatus should reject an unknown id', async () => {
          await expect(multisig.getProposalStatus(UNKNOWN_ID)).rejects.toThrow(
            'ProposalManager: proposal not found',
          );
        });

        it('getApprovalCount should return 0 for an unknown id', async () => {
          expect(await multisig.getApprovalCount(UNKNOWN_ID)).toEqual(0n);
        });

        it('isProposalApprovedBySigner should return false for an unknown id', async () => {
          expect(
            await multisig.isProposalApprovedBySigner(UNKNOWN_ID, ID1),
          ).toEqual(false);
        });
      });

      describe('view - approvals', () => {
        beforeAll(async () => {
          multisig = await freshMultisig();
        });

        it('should return false for unapproved signer', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          expect(await multisig.isProposalApprovedBySigner(id, ID1)).toEqual(
            false,
          );
        });

        it('should return 0 approval count for new proposal', async () => {
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );
          expect(await multisig.getApprovalCount(id)).toEqual(0n);
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

        // The preset dropped getProposalRecipient/Amount/Color to fit the deploy
        // block limit; the fields are read off getProposal, the getter it exposes.
        it('getProposal should expose recipient, amount, and color', async () => {
          const proposal = await multisig.getProposal(proposalId);
          expect(proposal.to.kind).toEqual(RecipientKind.ShieldedUser);
          expect(proposal.to.address).toEqual(Z_RECIPIENT_PK.bytes);
          expect(proposal.amount).toEqual(PROPOSAL_AMOUNT);
          expect(proposal.color).toEqual(COLOR);
        });
      });

      // TODO: move to integration tests
      describe('full lifecycle', () => {
        beforeEach(async () => {
          multisig = await freshMultisig();
        });

        it('should handle deposit -> propose -> approve -> execute', async () => {
          // Deposit
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);

          // Propose
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );

          // Approve to threshold
          await (await as(SK1)).approveProposal(id);
          await (await as(SK2)).approveProposal(id);
          expect(await multisig.getApprovalCount(id)).toEqual(THRESHOLD);

          // Execute
          await multisig.executeShieldedProposal(id);
          expect(await multisig.getProposalStatus(id)).toEqual(
            ProposalStatus.Executed,
          );
          expect(await multisig.getTokenBalance(COLOR)).toEqual(
            AMOUNT - PROPOSAL_AMOUNT,
          );
          const received = await multisig.getReceivedTotal(COLOR);
          const sent = await multisig.getSentTotal(COLOR);
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

          // Approve and execute first
          await (await as(SK1)).approveProposal(id1);
          await (await as(SK2)).approveProposal(id1);
          await multisig.executeShieldedProposal(id1);

          // Approve and execute second
          await (await as(SK1)).approveProposal(id2);
          await (await as(SK3)).approveProposal(id2);
          await multisig.executeShieldedProposal(id2);

          expect(await multisig.getTokenBalance(COLOR)).toEqual(
            AMOUNT - 200n - 300n,
          );
        });

        it('should handle approve -> revoke -> re-approve -> execute', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(Z_RECIPIENT_PK);
          const id = await (await as(SK1)).createShieldedProposal(
            to,
            COLOR,
            PROPOSAL_AMOUNT,
          );

          // Approve then revoke
          await (await as(SK1)).approveProposal(id);
          await (await as(SK1)).revokeApproval(id);
          expect(await multisig.getApprovalCount(id)).toEqual(0n);

          // Re-approve with enough signers
          await (await as(SK2)).approveProposal(id);
          await (await as(SK3)).approveProposal(id);
          expect(await multisig.getApprovalCount(id)).toEqual(2n);

          await multisig.executeShieldedProposal(id);
          expect(await multisig.getProposalStatus(id)).toEqual(
            ProposalStatus.Executed,
          );
        });
      });
    });
  });
});
