import {
  CoinInfo,
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Maybe } from '../../../artifacts/MockShieldedToken/contract/index.cjs';
import * as utils from './utils/address.js';
import { AccountSimulator } from './simulators/AccountSimulator.js';

// PKs
const [ALICE, zALICE] = utils.generateEitherPubKeyPair('ALICE');
const [BOB, zBOB] = utils.generateEitherPubKeyPair('BOB');
const [UNAUTHORIZED, _] = utils.generatePubKeyPair('UNAUTHORIZED');

const NO_STRING: Maybe<string> = {
  is_some: false,
  value: '',
};
const NAME: Maybe<string> = {
  is_some: true,
  value: 'NAME',
};
const SYMBOL: Maybe<string> = {
  is_some: true,
  value: 'SYMBOL',
};
const DECIMALS: bigint = 18n;
const NONCE: Uint8Array = utils.pad('NONCE', 32);
const DOMAIN: Uint8Array = utils.pad('ShieldedToken', 32);

const AMOUNT: bigint = BigInt(250);
const MAX_UINT64 = BigInt(2 ** 64) - BigInt(1);

let secretKey: Uint8Array;
let account: AccountSimulator;

describe('Account', () => {
  beforeEach(() => {
    account = new AccountSimulator();
  });

  describe('initialization', () => {
    it('should have a nonce of 0', () => {
      const initNonce = account.getPublicState().Account__nonce;
      expect(initNonce).toEqual(0n);
    });

    describe('receive', () => {
      beforeEach(() => {
        //token = new ShieldedTokenSimulator(NONCE, NAME, SYMBOL, DECIMALS);
      });

      it('should receive utxo', () => {
        const res = account.mint(zALICE, 900n);
        const castToCoin = {
          nonce: res.result.nonce,
          color: res.result.color,
          value: res.result.value
        }
        //console.log("resresres", res);
        //account.receive(castToCoin);
      })
    })
  });
});
