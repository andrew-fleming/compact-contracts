import { beforeAll, describe, it } from 'vitest'
import { createLogger } from '@midnight-ntwrk/testkit-js'
import { createTestContext } from '#test-utils/e2e-environment.js'
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js'
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockShieldedAccessControl,
  type ShieldedAccessControl_RoleCheck as RoleCheck,
  type ZswapCoinPublicKey,
} from '../../../artifacts/MockShieldedAccessControl/contract/index.js';
import {
  ShieldedAccessControlPrivateState,
  ShieldedAccessControlWitnesses,
} from '../witnesses/ShieldedAccessControlWitnesses.js';


const logger = createLogger('shielded_access_control_e2e')
let ctx: Awaited<ReturnType<typeof createTestContext>>

beforeAll(async () => {
  ctx = await createTestContext(logger, {
    privateStateStoreName: `shielded-access-control-${Date.now()}`,
    zkConfigPath: './artifacts/MockShieldedAccessControl',
  })
})

describe('ShieldedAccessControl e2e', () => {
  it('should deploy contract [@slow]', async () => {
    logger.info('Deploying ShieldedAccessControl contract...');
    const compiledShieldedAccessControl = CompiledContract.make('ShieldedAccessControl', MockShieldedAccessControl).pipe(
      CompiledContract.withWitnesses(ShieldedAccessControlWitnesses()),
      CompiledContract.withCompiledFileAssets('./artifacts/MockShieldedAccessControl')
    )
    const counterContract = await deployContract(ctx.providers, {
      compiledContract: compiledShieldedAccessControl,
      args: [new Uint8Array(32).fill(48473095)],
      privateStateId: 'shielded-access-control',
      initialPrivateState: ShieldedAccessControlPrivateState.generate()
    });
    logger.info(`Deployed contract at address: ${counterContract.deployTxData.public.contractAddress}`);
    return counterContract;
  });
})