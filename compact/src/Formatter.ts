#!/usr/bin/env node

import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  BaseCompactOperation,
  BaseCompactService,
  BaseEnvironmentValidator,
  type ExecFunction,
  SharedUIService,
  SRC_DIR,
} from './BaseServices.js';
import {
  FormatterError,
  FormatterNotAvailableError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/**
 * Environment validator specific to formatting operations.
 * Extends base validator with formatter availability checking.
 */
export class FormatterEnvironmentValidator extends BaseEnvironmentValidator {
  /**
   * Checks if the formatter is available (requires compiler 0.25.0+).
   */
  async checkFormatterAvailable(): Promise<void> {
    try {
      await this.execFn('compact help format');
    } catch (error) {
      if (
        isPromisifiedChildProcessError(error) &&
        error.stderr?.includes('formatter not available')
      ) {
        throw new FormatterNotAvailableError(
          'Formatter not available. Please update your Compact compiler with: compact update',
        );
      }
      throw error;
    }
  }

  /**
   * Validates environment for formatting operations.
   */
  async validate(): Promise<{ devToolsVersion: string }> {
    const { devToolsVersion } = await this.validateBase();
    await this.checkFormatterAvailable();
    return { devToolsVersion };
  }
}

/**
 * Service for executing formatting commands.
 * Extends base service with format-specific command construction.
 */
export class FormatterService extends BaseCompactService {
  /**
   * Formats files in-place in the specified directory or current directory.
   */
  async formatInPlace(
    targetPath?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const pathArg = targetPath ? ` "${targetPath}"` : '';
    const command = `compact format${pathArg}`;
    return this.executeCompactCommand(command, 'Failed to format');
  }

  /**
   * Checks if files are properly formatted without modifying them.
   */
  async checkFormatting(targetPath?: string): Promise<{
    stdout: string;
    stderr: string;
    isFormatted: boolean;
  }> {
    const pathArg = targetPath ? ` "${targetPath}"` : '';
    const command = `compact format --check${pathArg}`;

    try {
      const result = await this.executeCompactCommand(
        command,
        'Failed to check formatting',
      );
      return { ...result, isFormatted: true };
    } catch (error: unknown) {
      if (isPromisifiedChildProcessError(error)) {
        // Exit code 1 with formatting differences is expected behavior
        if (error.code === 1 && error.stdout) {
          return {
            stdout: error.stdout,
            stderr: error.stderr || '',
            isFormatted: false,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Formats a list of specific files.
   */
  async formatFiles(
    files: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    if (files.length === 0) {
      return { stdout: '', stderr: '' };
    }

    const fileArgs = files.map((file) => `"${join(SRC_DIR, file)}"`).join(' ');
    const command = `compact format ${fileArgs}`;
    return this.executeCompactCommand(
      command,
      `Failed to format files: ${files.join(', ')}`,
    );
  }

  protected createError(message: string, cause?: unknown): Error {
    // Extract target from error message for FormatterError
    const match = message.match(/Failed to format(?: files:)? (.+)/);
    const target = match ? match[1] : undefined;
    return new FormatterError(message, target, cause);
  }
}

/**
 * UI service specific to formatting operations.
 * Extends shared UI with format-specific messaging.
 */
export const FormatterUIService = {
  ...SharedUIService,

  /**
   * Displays formatting environment information.
   */
  displayEnvInfo(devToolsVersion: string, targetDir?: string): void {
    SharedUIService.displayBaseEnvInfo('FORMAT', devToolsVersion, targetDir);
  },

  /**
   * Displays formatting start message.
   */
  showFormattingStart(
    fileCount: number,
    mode: 'format' | 'check',
    targetDir?: string,
  ): void {
    const action = mode === 'check' ? 'check formatting for' : 'format';
    SharedUIService.showOperationStart('FORMAT', action, fileCount, targetDir);
  },

  /**
   * Displays no files warning for formatting.
   */
  showNoFiles(targetDir?: string): void {
    SharedUIService.showNoFiles('FORMAT', targetDir);
  },

  /**
   * Displays formatting check results.
   */
  showCheckResults(isFormatted: boolean, differences?: string): void {
    const spinner = ora();

    if (isFormatted) {
      spinner.succeed(chalk.green('[FORMAT] All files are properly formatted'));
    } else {
      spinner.fail(chalk.red('[FORMAT] Some files are not properly formatted'));
      if (differences) {
        console.log(chalk.yellow('\nFormatting differences:'));
        SharedUIService.printOutput(differences, chalk.white);
      }
    }
  },
};

/**
 * Main formatter class that orchestrates the formatting process.
 * Extends base operation with formatting-specific logic.
 */
export class CompactFormatter extends BaseCompactOperation {
  private readonly environmentValidator: FormatterEnvironmentValidator;
  private readonly formatterService: FormatterService;
  private readonly checkMode: boolean;
  private readonly targets: string[];

  /**
   * Creates a new CompactFormatter instance.
   */
  constructor(
    checkMode = false,
    targets: string[] = [],
    execFn?: ExecFunction,
  ) {
    // For single directory target, use it as targetDir
    const targetDir =
      targets.length === 1 && !targets[0].endsWith('.compact')
        ? targets[0]
        : undefined;

    super(targetDir);
    this.checkMode = checkMode;
    this.targets = targets;
    this.environmentValidator = new FormatterEnvironmentValidator(execFn);
    this.formatterService = new FormatterService(execFn);
  }

  /**
   * Factory method to create a CompactFormatter from command-line arguments.
   */
  static fromArgs(args: string[]): CompactFormatter {
    const { targetDir, remainingArgs } = CompactFormatter.parseBaseArgs(args);

    let checkMode = false;
    const targets: string[] = [];

    // Add targetDir to targets if specified
    if (targetDir) {
      targets.push(targetDir);
    }

    for (const arg of remainingArgs) {
      if (arg === '--check') {
        checkMode = true;
      } else if (!arg.startsWith('--')) {
        targets.push(arg);
      }
    }

    return new CompactFormatter(checkMode, targets);
  }

  /**
   * Validates the formatting environment.
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion } = await this.environmentValidator.validate();
    FormatterUIService.displayEnvInfo(devToolsVersion, this.targetDir);
  }

  /**
   * Shows no files warning for formatting.
   */
  showNoFiles(): void {
    FormatterUIService.showNoFiles(this.targetDir);
  }

  /**
   * Main formatting execution method.
   */
  async execute(): Promise<void> {
    await this.validateEnvironment();

    // Handle specific file targets
    if (
      this.targets.length > 0 &&
      this.targets.every((target) => target.endsWith('.compact'))
    ) {
      return this.formatSpecificFiles();
    }

    // Handle directory target or current directory
    return this.formatDirectory();
  }

  /**
   * Legacy method name for backwards compatibility.
   */
  async format(): Promise<void> {
    return this.execute();
  }

  /**
   * Formats specific files provided as arguments.
   */
  private async formatSpecificFiles(): Promise<void> {
    if (this.checkMode) {
      for (const file of this.targets) {
        await this.checkFile(file);
      }
    } else {
      const result = await this.formatterService.formatFiles(this.targets);
      SharedUIService.printOutput(result.stdout, chalk.cyan);
      SharedUIService.printOutput(result.stderr, chalk.yellow);
    }
  }

  /**
   * Formats all files in a directory or current directory.
   */
  private async formatDirectory(): Promise<void> {
    const { files, searchDir } = await this.discoverFiles();
    if (files.length === 0) return;

    const mode = this.checkMode ? 'check' : 'format';
    FormatterUIService.showFormattingStart(files.length, mode, this.targetDir);

    if (this.checkMode) {
      const result = await this.formatterService.checkFormatting(searchDir);
      FormatterUIService.showCheckResults(result.isFormatted, result.stdout);
    } else {
      const result = await this.formatterService.formatInPlace(searchDir);

      // Successful formatting typically produces no output
      if (result.stdout.trim()) {
        SharedUIService.printOutput(result.stdout, chalk.cyan);
      }
      if (result.stderr.trim()) {
        SharedUIService.printOutput(result.stderr, chalk.yellow);
      }

      const spinner = ora();
      spinner.succeed(
        chalk.green(`[FORMAT] Successfully formatted ${files.length} file(s)`),
      );
    }
  }

  /**
   * Checks formatting for a specific file.
   */
  private async checkFile(file: string): Promise<void> {
    const result = await this.formatterService.checkFormatting(file);

    if (result.isFormatted) {
      const spinner = ora();
      spinner.succeed(chalk.green(`[FORMAT] ${file} is properly formatted`));
    } else {
      const spinner = ora();
      spinner.fail(chalk.red(`[FORMAT] ${file} is not properly formatted`));
      if (result.stdout) {
        SharedUIService.printOutput(result.stdout, chalk.white);
      }
    }
  }

  /**
   * For testing - expose internal state
   */
  get testCheckMode(): boolean {
    return this.checkMode;
  }

  get testTargets(): string[] {
    return this.targets;
  }
}
