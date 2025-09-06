#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import {
  CompactCliNotFoundError,
  FormatterError,
  FormatterNotAvailableError,
  DirectoryNotFoundError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/** Source directory containing .compact files */
const SRC_DIR: string = 'src';

/**
 * Function type for executing shell commands.
 * Allows dependency injection for testing and customization.
 */
export type ExecFunction = (
  command: string,
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Service responsible for validating the Compact CLI environment for formatting.
 * Checks CLI availability, formatter availability, and ensures the toolchain
 * supports formatting operations.
 *
 * @class FormatterEnvironmentValidator
 */
export class FormatterEnvironmentValidator {
  private execFn: ExecFunction;

  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Checks if the Compact CLI is available in the system PATH.
   */
  async checkCompactAvailable(): Promise<boolean> {
    try {
      await this.execFn('compact --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the version of the Compact developer tools.
   */
  async getDevToolsVersion(): Promise<string> {
    const { stdout } = await this.execFn('compact --version');
    return stdout.trim();
  }

  /**
   * Checks if the formatter is available (requires compiler 0.25.0+).
   * @throws {FormatterNotAvailableError} If formatter is not available
   */
  async checkFormatterAvailable(): Promise<void> {
    try {
      await this.execFn('compact help format');
    } catch (error) {
      if (isPromisifiedChildProcessError(error) &&
          error.stderr?.includes('formatter not available')) {
        throw new FormatterNotAvailableError(
          'Formatter not available. Please update your Compact compiler with: compact update'
        );
      }
      throw error;
    }
  }

  /**
   * Validates the entire Compact environment for formatting operations.
   * @throws {CompactCliNotFoundError} If the Compact CLI is not available
   * @throws {FormatterNotAvailableError} If formatter is not available
   */
  async validate(): Promise<{ devToolsVersion: string }> {
    const isAvailable = await this.checkCompactAvailable();
    if (!isAvailable) {
      throw new CompactCliNotFoundError(
        "'compact' CLI not found in PATH. Please install the Compact developer tools."
      );
    }

    await this.checkFormatterAvailable();
    const devToolsVersion = await this.getDevToolsVersion();

    return { devToolsVersion };
  }
}

/**
 * Service responsible for discovering .compact files for formatting operations.
 * Reuses the same file discovery logic as the compiler.
 *
 * @class FormatterFileDiscovery
 */
export class FormatterFileDiscovery {
  /**
   * Recursively discovers all .compact files in a directory.
   */
  async getCompactFiles(dir: string): Promise<string[]> {
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const filePromises = dirents.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            return await this.getCompactFiles(fullPath);
          }

          if (entry.isFile() && fullPath.endsWith('.compact')) {
            return [relative(SRC_DIR, fullPath)];
          }
          return [];
        } catch (err) {
          console.warn(`Error accessing ${fullPath}:`, err);
          return [];
        }
      });

      const results = await Promise.all(filePromises);
      return results.flat();
    } catch (err) {
      console.error(`Failed to read dir: ${dir}`, err);
      return [];
    }
  }
}

/**
 * Service responsible for executing format operations using the Compact CLI.
 * Handles different formatting modes: format, check, and specific file/directory targeting.
 *
 * @class FormatterService
 */
export class FormatterService {
  private execFn: ExecFunction;

  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Formats files in-place in the specified directory or current directory.
   * @param targetPath - Optional directory or file path to format
   */
  async formatInPlace(targetPath?: string): Promise<{ stdout: string; stderr: string }> {
    const pathArg = targetPath ? ` "${targetPath}"` : '';
    const command = `compact format${pathArg}`;

    try {
      return await this.execFn(command);
    } catch (error: unknown) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }

      throw new FormatterError(`Failed to format: ${message}`, targetPath);
    }
  }

  /**
   * Checks if files are properly formatted without modifying them.
   * @param targetPath - Optional directory or file path to check
   * @returns Promise with check results including any formatting differences
   */
  async checkFormatting(targetPath?: string): Promise<{ stdout: string; stderr: string; isFormatted: boolean }> {
    const pathArg = targetPath ? ` "${targetPath}"` : '';
    const command = `compact format --check${pathArg}`;

    try {
      const result = await this.execFn(command);
      return { ...result, isFormatted: true };
    } catch (error: unknown) {
      if (isPromisifiedChildProcessError(error)) {
        // Exit code 1 with formatting differences is expected behavior
        if (error.code === 1 && error.stdout) {
          return {
            stdout: error.stdout,
            stderr: error.stderr || '',
            isFormatted: false
          };
        }
      }

      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }

      throw new FormatterError(`Failed to check formatting: ${message}`, targetPath);
    }
  }

  /**
   * Formats a list of specific files.
   * @param files - Array of file paths to format
   */
  async formatFiles(files: string[]): Promise<{ stdout: string; stderr: string }> {
    if (files.length === 0) {
      return { stdout: '', stderr: '' };
    }

    const fileArgs = files.map(file => `"${join(SRC_DIR, file)}"`).join(' ');
    const command = `compact format ${fileArgs}`;

    try {
      return await this.execFn(command);
    } catch (error: unknown) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }

      throw new FormatterError(`Failed to format files: ${message}`, files.join(', '));
    }
  }
}

/**
 * Utility service for handling formatter UI output and formatting.
 * Provides consistent styling and formatting for formatter messages and output.
 *
 * @class FormatterUIService
 */
export const FormatterUIService = {
  /**
   * Prints formatted output with consistent indentation and coloring.
   */
  printOutput(output: string, colorFn: (text: string) => string): void {
    const lines = output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  },

  /**
   * Displays environment information for formatting operations.
   */
  displayEnvInfo(devToolsVersion: string, targetDir?: string): void {
    const spinner = ora();

    if (targetDir) {
      spinner.info(chalk.blue(`[FORMAT] TARGET_DIR: ${targetDir}`));
    }

    spinner.info(
      chalk.blue(`[FORMAT] Compact developer tools: ${devToolsVersion}`)
    );
  },

  /**
   * Displays formatting start message with file count and optional location.
   */
  showFormattingStart(fileCount: number, mode: 'format' | 'check', targetDir?: string): void {
    const searchLocation = targetDir ? ` in ${targetDir}/` : '';
    const action = mode === 'check' ? 'check formatting for' : 'format';
    const spinner = ora();
    spinner.info(
      chalk.blue(
        `[FORMAT] Found ${fileCount} .compact file(s) to ${action}${searchLocation}`
      )
    );
  },

  /**
   * Displays a warning message when no .compact files are found.
   */
  showNoFiles(targetDir?: string): void {
    const searchLocation = targetDir ? `${targetDir}/` : '';
    const spinner = ora();
    spinner.warn(
      chalk.yellow(`[FORMAT] No .compact files found in ${searchLocation}.`)
    );
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
        this.printOutput(differences, chalk.white);
      }
    }
  },
};

/**
 * Main formatter class that orchestrates the formatting process.
 * Coordinates environment validation, file discovery, and formatting services
 * to provide a complete .compact file formatting solution.
 *
 * @class CompactFormatter
 */
export class CompactFormatter {
  /** Environment validation service */
  private readonly environmentValidator: FormatterEnvironmentValidator;
  /** File discovery service */
  private readonly fileDiscovery: FormatterFileDiscovery;
  /** Formatting execution service */
  private readonly formatterService: FormatterService;

  /** Whether to check formatting instead of formatting in-place */
  private readonly checkMode: boolean;
  /** Optional target directory or files to limit formatting scope */
  private readonly targets: string[];

  /**
   * Creates a new CompactFormatter instance with specified configuration.
   *
   * @param checkMode - Whether to check formatting instead of formatting in-place
   * @param targets - Optional array of directories or files to format
   * @param execFn - Optional custom exec function for dependency injection
   */
  constructor(
    checkMode = false,
    targets: string[] = [],
    execFn?: ExecFunction,
  ) {
    this.checkMode = checkMode;
    this.targets = targets;
    this.environmentValidator = new FormatterEnvironmentValidator(execFn);
    this.fileDiscovery = new FormatterFileDiscovery();
    this.formatterService = new FormatterService(execFn);
  }

  /**
   * Factory method to create a CompactFormatter from command-line arguments.
   *
   * Supported argument patterns:
   * - `--check` - Check formatting without modifying files
   * - `--dir <directory>` - Target specific directory
   * - `<file1> <file2> ...` - Target specific files
   *
   * @param args - Array of command-line arguments
   * @returns New CompactFormatter instance configured from arguments
   */
  static fromArgs(args: string[]): CompactFormatter {
    let checkMode = false;
    const targets: string[] = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--check') {
        checkMode = true;
      } else if (args[i] === '--dir') {
        const dirNameExists = i + 1 < args.length && !args[i + 1].startsWith('--');
        if (dirNameExists) {
          targets.push(args[i + 1]);
          i++;
        } else {
          throw new Error('--dir flag requires a directory name');
        }
      } else if (!args[i].startsWith('--')) {
        targets.push(args[i]);
      }
    }

    return new CompactFormatter(checkMode, targets, undefined);
  }

  /**
   * Validates the formatting environment and displays version information.
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion } = await this.environmentValidator.validate();
    const targetDir = this.targets.length === 1 ? this.targets[0] : undefined;
    FormatterUIService.displayEnvInfo(devToolsVersion, targetDir);
  }

  /**
   * Main formatting method that orchestrates the entire formatting process.
   */
  async format(): Promise<void> {
    await this.validateEnvironment();

    // Handle specific file targets
    if (this.targets.length > 0 && this.targets.every(target => target.endsWith('.compact'))) {
      return this.formatSpecificFiles();
    }

    // Handle directory target or current directory
    const targetDir = this.targets.length === 1 ? this.targets[0] : undefined;
    return this.formatDirectory(targetDir);
  }

  /**
   * Formats specific files provided as arguments.
   */
  private async formatSpecificFiles(): Promise<void> {
    if (this.checkMode) {
      // For check mode with specific files, we need to check each file
      for (const file of this.targets) {
        await this.checkFile(file);
      }
    } else {
      // Format the specific files
      const result = await this.formatterService.formatFiles(this.targets);
      FormatterUIService.printOutput(result.stdout, chalk.cyan);
      FormatterUIService.printOutput(result.stderr, chalk.yellow);
    }
  }

  /**
   * Formats all files in a directory or current directory.
   */
  private async formatDirectory(targetDir?: string): Promise<void> {
    const searchDir = targetDir ? join(SRC_DIR, targetDir) : SRC_DIR;

    // Validate target directory exists
    if (targetDir && !existsSync(searchDir)) {
      throw new DirectoryNotFoundError(
        `Target directory ${searchDir} does not exist`,
        searchDir,
      );
    }

    const compactFiles = await this.fileDiscovery.getCompactFiles(searchDir);

    if (compactFiles.length === 0) {
      FormatterUIService.showNoFiles(targetDir);
      return;
    }

    const mode = this.checkMode ? 'check' : 'format';
    FormatterUIService.showFormattingStart(compactFiles.length, mode, targetDir);

    if (this.checkMode) {
      const result = await this.formatterService.checkFormatting(searchDir);
      FormatterUIService.showCheckResults(result.isFormatted, result.stdout);
    } else {
      const result = await this.formatterService.formatInPlace(searchDir);

      // Successful formatting typically produces no output
      if (result.stdout.trim()) {
        FormatterUIService.printOutput(result.stdout, chalk.cyan);
      }
      if (result.stderr.trim()) {
        FormatterUIService.printOutput(result.stderr, chalk.yellow);
      }

      const spinner = ora();
      spinner.succeed(chalk.green(`[FORMAT] Successfully formatted ${compactFiles.length} file(s)`));
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
        FormatterUIService.printOutput(result.stdout, chalk.white);
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
