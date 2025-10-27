import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
  encodeContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Maybe, Account_Spend } from '../../../artifacts/MockAccountWithToken/contract/index.cjs';
import * as utils from './utils/address.js';
import { AccountSimulator } from './simulators/AccountWithTokenSimulator.js';
import { ZswapCoinPublicKey } from '../../../artifacts/MockAccessControl/contract/index.cjs';

// PKs
const [ALICE, zALICE] = utils.generateEitherPubKeyPair('ALICE');
const [_, zBOB] = utils.generatePubKeyPair('BOB');

let AccountAddressAsEither = utils.ZERO_ADDRESS // update this after deployment/fix me

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
const AMOUNT: bigint = BigInt(250);

let secretKey: Uint8Array;
let account: AccountSimulator;

//
// Helpers
//

/**
 * @description Creates a hash for a send transaction.
 * @param accountCtx - The account simulator context.
 * @param recipient - The recipient's zswap public key.
 * @param spend - The spend details (amount and coin color) as defined by the `Account_Spend` struct.
 * @returns Send tx hash as Uint8Array to be consumed by `craftInputHash`.
 */
const craftSendHashSimple = (
  accountCtx: AccountSimulator,
  recipient: ZswapCoinPublicKey,
  spend: Account_Spend,
) => {
  const bSendDomain = accountCtx.sendDomain();
  const bRecipient = recipient.bytes;
  const bAmount = convertFieldToBytes(32, spend.amount, 'Account amount');
  const bCoinColor = spend.coin;
  const bNonce = convertFieldToBytes(32, accountCtx.getPublicState().Account__nonce, 'Account nonce');
  return craftSendHash(bSendDomain, bRecipient, bAmount, bCoinColor, bNonce);
}

const craftSendHash = (
  sendDomain: Uint8Array,
  recipient: Uint8Array,
  amount: Uint8Array,
  coinColor: Uint8Array,
  nonce: Uint8Array,
) => {
  const rtTypeSend = new CompactTypeVector(5, new CompactTypeBytes(32));
  return persistentHash(rtTypeSend, [sendDomain, recipient, amount, coinColor, nonce]);
}

/**
 * Creates an input hash from a send transaction hash.
 * @param accountCtx - The account simulator context.
 * @param sendHash - The send transaction hash.
 * @returns Input hash as Uint8Array to be consumed by `account.send`.
 */
const craftInputHashSimple = (accountCtx: AccountSimulator, sendHash: Uint8Array) => {
  const inputDomain = accountCtx.inputDomain();
  const id = accountCtx.accountId();
  return craftInputHash(inputDomain, id, sendHash);
}

const craftInputHash = (
  inputDomain: Uint8Array,
  id: Uint8Array,
  sendHash: Uint8Array,
) => {
  const rtTypeInput = new CompactTypeVector(3, new CompactTypeBytes(32));
  return persistentHash(rtTypeInput, [inputDomain, id, sendHash]);
}

describe('Account', () => {
  beforeEach(() => {
    account = new AccountSimulator(NONCE, NAME, SYMBOL, DECIMALS);
    AccountAddressAsEither.right.bytes = encodeContractAddress(account.contractAddress);
  });

  describe('initialization', () => {
    it('should have a nonce of 0', () => {
      const initNonce = account.getPublicState().Account__nonce;
      expect(initNonce).toEqual(0n);
    });

    describe('receiveCoin', () => {
      it('should receive utxo (new color)', () => {
        const ret = account.mint(zALICE, AMOUNT);
        const mintedCoinInfo = {
          nonce: ret.result.nonce,
          color: ret.result.color,
          value: ret.result.value
        }
        const receiveRet = account.as(ALICE).receiveCoin(mintedCoinInfo);
        // outputs[0] is the initial mint
        // We need to create a tx to improve testing
        const out = receiveRet.context.currentZswapLocalState.outputs[1];
        expect(out.coinInfo).toEqual(mintedCoinInfo);
        expect(out.recipient).toEqual(AccountAddressAsEither);

        // Check QualifiedCoinInfo is stored
        const storedUTXO = account.getPublicState().Account__coins.lookup(mintedCoinInfo.color);
        expect(storedUTXO.nonce).toEqual(mintedCoinInfo.nonce);
        expect(storedUTXO.color).toEqual(mintedCoinInfo.color);
        expect(storedUTXO.value).toEqual(mintedCoinInfo.value);

        // Check mt_index is index 1
        expect(storedUTXO.mt_index).toEqual(1n);
      });

      it('should receive coin (duplicate color/merged)', () => {
        // Mint two UTXOs
        const ret1 = account.mint(zALICE, AMOUNT);
        const mintedCoinInfo1 = {
          nonce: ret1.result.nonce,
          color: ret1.result.color,
          value: ret1.result.value
        }
        const ret2 = account.mint(zALICE, AMOUNT);
        const mintedCoinInfo2 = {
          nonce: ret2.result.nonce,
          color: ret2.result.color,
          value: ret2.result.value
        }

        // First receive
        const receiveRet1 = account.as(ALICE).receiveCoin(mintedCoinInfo1);
        // outputs[0] and outputs[1] are the initial two mints
        // We need to create a tx to improve testing
        const out1 = receiveRet1.context.currentZswapLocalState.outputs[2];
        expect(out1.coinInfo).toEqual(mintedCoinInfo1);
        expect(out1.recipient).toEqual(AccountAddressAsEither);

        // Second receive
        const receiveRet2 = account.as(ALICE).receiveCoin(mintedCoinInfo2);
        // outputs[2] is the first `receive`
        // We need to create a tx to improve testing
        const out2 = receiveRet2.context.currentZswapLocalState.outputs[3];
        expect(out2.coinInfo).toEqual(mintedCoinInfo2);
        expect(out2.recipient).toEqual(AccountAddressAsEither);

        // Check QualifiedCoinInfo is merged and stored
        const storedUTXO = account.getPublicState().Account__coins.lookup(mintedCoinInfo2.color);
        expect(storedUTXO.nonce).not.toEqual(mintedCoinInfo2.nonce); // New nonce with merge
        expect(storedUTXO.color).toEqual(mintedCoinInfo2.color); // Same color
        expect(storedUTXO.value).toEqual(mintedCoinInfo2.value * 2n); // Combined

        // Check utxo mt_index is index 4
        //
        // index 1 - mint
        // index 2 - mint
        // index 3 - receive
        // index 4 - receive/merge
        expect(storedUTXO.mt_index).toEqual(4n);
      });
    });

    describe('send', () => {
      let thisCoinColor: Uint8Array;
      let thisCoinNonce: Uint8Array;

      describe('passing scenarios', () => {
        beforeEach(() => {
          const ret = account.mint(zALICE, AMOUNT);
          const mintedCoinInfo = {
            nonce: ret.result.nonce,
            color: ret.result.color,
            value: ret.result.value
          }
          account.receiveCoin(mintedCoinInfo);
          thisCoinColor = ret.result.color;
          thisCoinNonce = ret.result.nonce;
        });

        it('should send coin with no change', () => {
          // Create Spend
          const thisSpend: Account_Spend = {
            amount: AMOUNT,
            coin: thisCoinColor,
          };

          // Store initial nonce
          const initNonce = account.getPublicState().Account__nonce;

          // Craft send and msg hash
          const sendHash = craftSendHashSimple(account, zBOB, thisSpend);
          const inputHash = craftInputHashSimple(account, sendHash);

          // Transfer UTXO to bob with msgHash as validation
          account.send(zBOB, thisSpend, inputHash);

          // Check bumped nonce
          const newNonce = account.getPublicState().Account__nonce;
          const expNonce = initNonce + 1n; // Bumped nonce
          expect(newNonce).toEqual(expNonce);

          // Check spent coin is removed from account
          const isCoin = account.getPublicState().Account__coins.member(thisSpend.coin);
          expect(isCoin).toEqual(false);
        });

        it('should send coin with change', () => {
          // Create Spend
          const thisSpend: Account_Spend = {
            amount: AMOUNT - 1n,
            coin: thisCoinColor,
          };

          // Store initial nonce
          const initNonce = account.getPublicState().Account__nonce;

          // Craft send and input hash
          const sendHash = craftSendHashSimple(account, zBOB, thisSpend);
          const inputHash = craftInputHashSimple(account, sendHash);

          // Transfer UTXO to bob with msgHash as validation
          account.send(zBOB, thisSpend, inputHash);

          // Check bumped nonce
          const newNonce = account.getPublicState().Account__nonce;
          const expNonce = initNonce + 1n; // Bumped nonce
          expect(newNonce).toEqual(expNonce);

          // Check coin color is not removed from account
          // bc there is change in the spend
          const isCoin = account.getPublicState().Account__coins.member(thisSpend.coin);
          expect(isCoin).toEqual(true);

          // Check spent coin details
          const storedCoin = account.getPublicState().Account__coins.lookup(thisSpend.coin);
          expect(storedCoin.nonce).not.toEqual(thisCoinNonce); // Bumped coin nonce
          expect(storedCoin.color).toEqual(thisCoinColor); // Same color
          expect(storedCoin.value).toEqual(1n); // Total - 1
        });
      });

      describe('failing scenarios', () => {
        let thisCoinColor: Uint8Array;
        let thisContractNonce: bigint;
        let thisSpend: Account_Spend;
        let thisSendDomain: Uint8Array;

        beforeEach(() => {
          // Setup mint + account receive
          const ret = account.mint(zALICE, AMOUNT);
          const mintedCoinInfo = {
            nonce: ret.result.nonce,
            color: ret.result.color,
            value: ret.result.value
          }
          account.receiveCoin(mintedCoinInfo);
          thisCoinColor = ret.result.color;
          thisCoinNonce = ret.result.nonce;
          thisSpend = {
            amount: AMOUNT,
            coin: thisCoinColor
          }
          thisSendDomain = account.sendDomain();

          // Store current nonce for utxo send
          thisContractNonce = account.getPublicState().Account__nonce;
        });

        // Get defaults
        const getDefaultParams = () => ({
          sendDomain: thisSendDomain,
          recipient: zBOB.bytes,
          amount: convertFieldToBytes(32, thisSpend.amount, 'Account amount'),
          coinColor: thisCoinColor,
          nonce: convertFieldToBytes(32, thisContractNonce, 'Account nonce'),
        });

        // Scoped test helper for easy overrides
        const craftHashWithOverrides = (overrides = {}) => {
          const params = { ...getDefaultParams(), ...overrides };
          return craftSendHash(
            params.sendDomain,
            params.recipient,
            params.amount,
            params.coinColor,
            params.nonce
          );
        };

        // The baddest of values
        const badVal = new Uint8Array(32).fill(0xbad);

        it('should pass with default send hash', () => {
          const sendHash = craftHashWithOverrides(); // No override
          const inputHash = craftInputHashSimple(account, sendHash);

          expect(() => {
            account.send(zBOB, thisSpend, inputHash);
          }).not.toThrow();
        });

        it.each([
          'sendDomain',
          'recipient',
          'amount',
          'coinColor',
          'nonce'
        ])('should fail when %s is changed in send hash', (param) => {
          const sendHash = craftHashWithOverrides({ [param]: badVal });
          const inputHash = craftInputHashSimple(account, sendHash);

          expect(() => {
            account.send(zBOB, thisSpend, inputHash);
          }).toThrow('Account: invalid input');
        });
      });
    });
  });
});
