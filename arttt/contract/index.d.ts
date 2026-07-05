import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type SCT_StealthOutput = { ephemeral: __compactRuntime.JubjubPoint;
                                  accountId: Uint8Array;
                                  valueCt: bigint
                                };

export type ElGamal_Ciphertext = { c1: __compactRuntime.JubjubPoint;
                                   c2: __compactRuntime.JubjubPoint
                                 };

export type Witnesses<PS> = {
  wit_ScanSeed(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_SpendSeed(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_EphemeralSeed(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_RandomnessSeed(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_PlaintextBalance(context: __compactRuntime.WitnessContext<Ledger, PS>,
                       ct_0: ElGamal_Ciphertext): [PS, bigint];
}

export type ImpureCircuits<PS> = {
  registerMeta(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  stealthMint(context: __compactRuntime.CircuitContext<PS>,
              metaId_0: Uint8Array,
              value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>,
            accountId_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  stealthClaim(context: __compactRuntime.CircuitContext<PS>,
               ephemeral_0: __compactRuntime.JubjubPoint,
               accountId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerMeta(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  stealthMint(context: __compactRuntime.CircuitContext<PS>,
              metaId_0: Uint8Array,
              value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>,
            accountId_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  stealthClaim(context: __compactRuntime.CircuitContext<PS>,
               ephemeral_0: __compactRuntime.JubjubPoint,
               accountId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  registerMeta(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  stealthMint(context: __compactRuntime.CircuitContext<PS>,
              metaId_0: Uint8Array,
              value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>,
            accountId_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  stealthClaim(context: __compactRuntime.CircuitContext<PS>,
               ephemeral_0: __compactRuntime.JubjubPoint,
               accountId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  SCT__balances: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): ElGamal_Ciphertext;
    [Symbol.iterator](): Iterator<[Uint8Array, ElGamal_Ciphertext]>
  };
  SCT__pubkeys: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): __compactRuntime.JubjubPoint;
    [Symbol.iterator](): Iterator<[Uint8Array, __compactRuntime.JubjubPoint]>
  };
  SCT__metaScan: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): __compactRuntime.JubjubPoint;
    [Symbol.iterator](): Iterator<[Uint8Array, __compactRuntime.JubjubPoint]>
  };
  SCT__metaSpend: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): __compactRuntime.JubjubPoint;
    [Symbol.iterator](): Iterator<[Uint8Array, __compactRuntime.JubjubPoint]>
  };
  SCT__outputs: {
    isEmpty(): boolean;
    length(): bigint;
    head(): { is_some: boolean, value: SCT_StealthOutput };
    [Symbol.iterator](): Iterator<SCT_StealthOutput>
  };
  readonly SCT__totalSupply: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
