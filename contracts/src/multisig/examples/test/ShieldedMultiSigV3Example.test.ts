import { createSimulator } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { sign, signerFromLabel } from '#test-utils/fixtures/ecdsa.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  Contract as Ex,
  ledger,
} from '../../../../artifacts/ShieldedMultiSigV3Example/contract/index.js';
import { calculateSignerId } from '../../presets/test/simulators/ShieldedMultiSigV3Simulator.js';
import { mintMsgHash } from '../../test/EcdsaTestUtils.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../test/EmptyWitnesses.js';

const INSTANCE_SALT = new Uint8Array(32).fill(7);
const INIT_NONCE = new Uint8Array(32).fill(8);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);

const S1 = signerFromLabel('ex-signer-1');
const S2 = signerFromLabel('ex-signer-2');
const S3 = signerFromLabel('ex-signer-3');
const COMMITMENTS = [
  calculateSignerId(S1.publicKey, INSTANCE_SALT),
  calculateSignerId(S2.publicKey, INSTANCE_SALT),
  calculateSignerId(S3.publicKey, INSTANCE_SALT),
];

const Base = createSimulator<any, any, any, any, any>({
  contractFactory: (w: any) => new Ex(w),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (salt: any, n: any, dom: any, cs: any) => [salt, n, dom, cs],
  ledgerExtractor: (s: any) => ledger(s),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ShieldedMultiSigV3Example',
});

describe('ShieldedMultiSigV3Example (the shipped contract)', () => {
  let ex: any;
  beforeEach(async () => {
    ex = await (Base as any).create(
      [INSTANCE_SALT, INIT_NONCE, TOKEN_DOMAIN, COMMITMENTS],
      {},
    );
  });

  it('reports the signer set the constructor registered', async () => {
    const c = ex.circuits.impure;
    expect(await c.getSignerCount()).toEqual(3n);
    expect(await c.getThreshold()).toEqual(2n);
  });

  it('mints with two valid signatures', async () => {
    const c = ex.circuits.impure;
    const recipient = shieldedTestKey();
    const addr = Uint8Array.from(Buffer.from(ex.contractAddress, 'hex'));
    const digest = mintMsgHash({
      contractAddress: addr,
      recipient,
      opNonce: await c.getNonce(),
      amount: 100n,
    });
    await c.mint(
      100n,
      recipient,
      [S1.publicKey, S2.publicKey],
      [sign(S1, digest), sign(S2, digest)],
    );
  });
});
