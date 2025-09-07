#!/usr/bin/env node

import { basename, join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  BaseEnvironmentValidator,
  BaseCompactService,
  BaseCompactOperation,
  SharedUIService,
  SRC_DIR,
  ARTIFACTS_DIR,
  type ExecFunction,
} from './BaseServices.js';
import {
  CompilationError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/**
 * Environment validator specific to compilation operations.
 * Extends base validator with compilation-specific version checking.
 */
export class CompilerEnvironmentValidator extends BaseEnvironmentValidator {
  /**
   * Retrieves the version of the Compact toolchain/compiler.
   */
  async getToolchainVersion(version?: string): Promise<string> {
    const versionFlag = version ? `+${version}` : '';
    const { stdout } = await this.execFn(
      `compact compile ${versionFlag} --version`,
    );
    return stdout.trim();
  }

  /**
   * Validates environment for compilation with optional version.
   */
  async validate(version?: string): Promise<{
    devToolsVersion: string;
    toolchainVersion: string;
  }> {
    const { devToolsVersion } = await this.validateBase();
    const toolchainVersion = await this.getToolchainVersion(version);

    return { devToolsVersion, toolchainVersion };
  }
}

/**
 * Service for executing compilation commands.
 * Extends base service with compilation-specific command construction.
 */
export class CompilerService extends BaseCompactService {
  /**
   * Compiles a single .compact file using the Compact CLI.
   */
  async compileFile(
    file: string,
    flags: string,
    version?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const inputPath = join(SRC_DIR, file);
    const outputDir = join(ARTIFACTS_DIR, basename(file, '.compact'));

    const versionFlag = version ? `+${version}` : '';
    const flagsStr = flags ? ` ${flags}` : '';
    const command = `compact compile${versionFlag ? ` ${versionFlag}` : ''}${flagsStr} "${inputPath}" "${outputDir}"`;

    return this.executeCompactCommand(command, `Failed to compile ${file}`);
  }

  protected createError(message: string, cause?: unknown): Error {
    // Extract file name from error message for CompilationError
    const match = message.match(/Failed to compile (.+?):/);
    const file = match ? match[1] : 'unknown';
    return new CompilationError(message, file, cause);
  }
}

/**
 * UI service specific to compilation operations.
 * Extends shared UI with compilation-specific formatting.
 */
export const CompilerUIService = {
  ...SharedUIService,

  /**
   * Displays compilation environment information.
   */
  displayEnvInfo(
    devToolsVersion: string,
    toolchainVersion: string,
    targetDir?: string,
    version?: string,
  ): void {
    SharedUIService.displayBaseEnvInfo('COMPILE', devToolsVersion, targetDir);

    const spinner = ora();
    spinner.info(
      chalk.blue(`[COMPILE] Compact toolchain: ${toolchainVersion}`)
    );

    if (version) {
      spinner.info(chalk.blue(`[COMPILE] Using toolchain version: ${version}`));
    }
  },

  /**
   * Displays compilation start message.
   */
  showCompilationStart(fileCount: number, targetDir?: string): void {
    SharedUIService.showOperationStart('COMPILE', 'compile', fileCount, targetDir);
  },

  /**
   * Displays no files warning for compilation.
   */
  showNoFiles(targetDir?: string): void {
    SharedUIService.showNoFiles('COMPILE', targetDir);
  },
};

/**
 * Main compiler class that orchestrates the compilation process.
 * Extends base operation with compilation-specific logic.
 */
export class CompactCompiler extends BaseCompactOperation {
  private readonly environmentValidator: CompilerEnvironmentValidator;
  private readonly compilerService: CompilerService;
  private readonly flags: string;
  private readonly version?: string;

  /**
   * Creates a new CompactCompiler instance.
   */
  constructor(
    flags = '',
    targetDir?: string,
    version?: string,
    execFn?: ExecFunction,
  ) {
    super(targetDir);
    this.flags = flags.trim();
    this.version = version;
    this.environmentValidator = new CompilerEnvironmentValidator(execFn);
    this.compilerService = new CompilerService(execFn);
  }

  /**
   * Factory method to create a CompactCompiler from command-line arguments.
   */
  static fromArgs(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
  ): CompactCompiler {
    const { targetDir, remainingArgs } = this.parseBaseArgs(args);

    const flags: string[] = [];
    let version: string | undefined;

    if (env.SKIP_ZK === 'true') {
      flags.push('--skip-zk');
    }

    for (const arg of remainingArgs) {
      if (arg.startsWith('+')) {
        version = arg.slice(1);
      } else {
        // Only add flag if it's not already present
        if (!flags.includes(arg)) {
          flags.push(arg);
        }
      }
    }

    return new CompactCompiler(flags.join(' '), targetDir, version);
  }

  /**
   * Validates the compilation environment.
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion, toolchainVersion } =
      await this.environmentValidator.validate(this.version);

    CompilerUIService.displayEnvInfo(
      devToolsVersion,
      toolchainVersion,
      this.targetDir,
      this.version,
    );
  }

  /**
   * Shows no files warning for compilation.
   */
  showNoFiles(): void {
    CompilerUIService.showNoFiles(this.targetDir);
  }

  /**
   * Main compilation execution method.
   */
  async execute(): Promise<void> {
    await this.validateEnvironment();

    const { files } = await this.discoverFiles();
    if (files.length === 0) return;

    CompilerUIService.showCompilationStart(files.length, this.targetDir);

    for (const [index, file] of files.entries()) {
      await this.compileFile(file, index, files.length);
    }
  }

  /**
   * Legacy method name for backwards compatibility.
   */
  async compile(): Promise<void> {
    return this.execute();
  }

  /**
   * Compiles a single file with progress reporting.
   */
  private async compileFile(
    file: string,
    index: number,
    total: number,
  ): Promise<void> {
    const step = `[${index + 1}/${total}]`;
    const spinner = ora(
      chalk.blue(`[COMPILE] ${step} Compiling ${file}`),
    ).start();

    try {
      const result = await this.compilerService.compileFile(
        file,
        this.flags,
        this.version,
      );

      spinner.succeed(chalk.green(`[COMPILE] ${step} Compiled ${file}`));
      SharedUIService.printOutput(result.stdout, chalk.cyan);
      SharedUIService.printOutput(result.stderr, chalk.yellow);
    } catch (error) {
      spinner.fail(chalk.red(`[COMPILE] ${step} Failed ${file}`));

      if (
        error instanceof CompilationError &&
        isPromisifiedChildProcessError(error.cause)
      ) {
        const execError = error.cause;
        SharedUIService.printOutput(execError.stdout, chalk.cyan);
        SharedUIService.printOutput(execError.stderr, chalk.red);
      }

      throw error;
    }
  }

  /**
   * For testing - expose internal state
   */
  get testFlags(): string {
    return this.flags;
  }
  get testTargetDir(): string | undefined {
    return this.targetDir;
  }
  get testVersion(): string | undefined {
    return this.version;
  }
}
