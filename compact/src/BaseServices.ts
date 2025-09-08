#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import {
  CompactCliNotFoundError,
  DirectoryNotFoundError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/** Source directory containing .compact files */
export const SRC_DIR: string = 'src';
/** Output directory for compiled artifacts */
export const ARTIFACTS_DIR: string = 'artifacts';

/**
 * Function type for executing shell commands.
 * Allows dependency injection for testing and customization.
 */
export type ExecFunction = (
  command: string,
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Base environment validator that handles common CLI validation.
 * Extended by specific validators for compilation and formatting.
 */
export abstract class BaseEnvironmentValidator {
  protected execFn: ExecFunction;

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
   * Base validation that checks CLI availability.
   * Override in subclasses for specific validation requirements.
   */
  async validateBase(): Promise<{ devToolsVersion: string }> {
    const isAvailable = await this.checkCompactAvailable();
    if (!isAvailable) {
      throw new CompactCliNotFoundError(
        "'compact' CLI not found in PATH. Please install the Compact developer tools."
      );
    }

    const devToolsVersion = await this.getDevToolsVersion();
    return { devToolsVersion };
  }

  /**
   * Abstract method for specific validation logic.
   * Must be implemented by subclasses.
   */
  abstract validate(...args: any[]): Promise<any>;
}

/**
 * Shared file discovery service for both compilation and formatting.
 * Recursively scans directories and filters for .compact file extensions.
 */
export class FileDiscovery {
  /**
   * Recursively discovers all .compact files in a directory.
   * Returns relative paths from the SRC_DIR for consistent processing.
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
 * Base service for executing Compact CLI commands.
 * Provides common command execution patterns with error handling.
 */
export abstract class BaseCompactService {
  protected execFn: ExecFunction;

  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Executes a compact command and handles common error patterns.
   */
  protected async executeCompactCommand(
    command: string,
    errorContext: string,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.execFn(command);
    } catch (error: unknown) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }

      throw this.createError(`${errorContext}: ${message}`, error);
    }
  }

  /**
   * Abstract method for creating operation-specific errors.
   * Must be implemented by subclasses.
   */
  protected abstract createError(message: string, cause?: unknown): Error;
}

/**
 * Shared UI service for consistent styling across compiler and formatter.
 * Provides common output formatting and user feedback patterns.
 */
export class SharedUIService {
  /**
   * Prints formatted output with consistent indentation and coloring.
   */
  static printOutput(output: string, colorFn: (text: string) => string): void {
    const lines = output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  }

  /**
   * Displays base environment information.
   */
  static displayBaseEnvInfo(
    operation: string,
    devToolsVersion: string,
    targetDir?: string,
  ): void {
    const spinner = ora();

    if (targetDir) {
      spinner.info(chalk.blue(`[${operation}] TARGET_DIR: ${targetDir}`));
    }

    spinner.info(
      chalk.blue(`[${operation}] Compact developer tools: ${devToolsVersion}`)
    );
  }

  /**
   * Displays operation start message with file count.
   */
  static showOperationStart(
    operation: string,
    action: string,
    fileCount: number,
    targetDir?: string,
  ): void {
    const searchLocation = targetDir ? ` in ${targetDir}/` : '';
    const spinner = ora();
    spinner.info(
      chalk.blue(
        `[${operation}] Found ${fileCount} .compact file(s) to ${action}${searchLocation}`
      )
    );
  }

  /**
   * Displays a warning when no .compact files are found.
   */
  static showNoFiles(operation: string, targetDir?: string): void {
    const searchLocation = targetDir ? `${targetDir}/` : '';
    const spinner = ora();
    spinner.warn(
      chalk.yellow(`[${operation}] No .compact files found in ${searchLocation}.`)
    );
  }

  /**
   * Shows available directories when DirectoryNotFoundError occurs.
   */
  static showAvailableDirectories(operation: string): void {
    console.log(chalk.yellow('\nAvailable directories:'));
    console.log(
      chalk.yellow(`  --dir access    # ${operation} access control contracts`),
    );
    console.log(chalk.yellow(`  --dir archive   # ${operation} archive contracts`));
    console.log(chalk.yellow(`  --dir security  # ${operation} security contracts`));
    console.log(chalk.yellow(`  --dir token     # ${operation} token contracts`));
    console.log(chalk.yellow(`  --dir utils     # ${operation} utility contracts`));
  }
}

/**
 * Base class for Compact operations (compilation, formatting).
 * Provides common patterns for argument parsing, validation, and execution.
 */
export abstract class BaseCompactOperation {
  protected readonly fileDiscovery: FileDiscovery;
  protected readonly targetDir?: string;

  constructor(targetDir?: string) {
    this.targetDir = targetDir;
    this.fileDiscovery = new FileDiscovery();
  }

  /**
   * Validates the target directory exists if specified.
   */
  protected validateTargetDirectory(searchDir: string): void {
    if (this.targetDir && !existsSync(searchDir)) {
      throw new DirectoryNotFoundError(
        `Target directory ${searchDir} does not exist`,
        searchDir,
      );
    }
  }

  /**
   * Gets the search directory based on target directory.
   */
  protected getSearchDirectory(): string {
    return this.targetDir ? join(SRC_DIR, this.targetDir) : SRC_DIR;
  }

  /**
   * Discovers files and handles empty results.
   */
  protected async discoverFiles(): Promise<{ files: string[]; searchDir: string }> {
    const searchDir = this.getSearchDirectory();
    this.validateTargetDirectory(searchDir);

    const files = await this.fileDiscovery.getCompactFiles(searchDir);

    if (files.length === 0) {
      this.showNoFiles();
      return { files: [], searchDir };
    }

    return { files, searchDir };
  }

  /**
   * Abstract methods that must be implemented by subclasses.
   */
  abstract validateEnvironment(): Promise<void>;
  abstract execute(): Promise<void>;
  abstract showNoFiles(): void;

  /**
   * Common argument parsing patterns.
   */
  protected static parseBaseArgs(args: string[]): {
    targetDir?: string;
    remainingArgs: string[];
  } {
    let targetDir: string | undefined;
    const remainingArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dir') {
        const dirNameExists = i + 1 < args.length && !args[i + 1].startsWith('--');
        if (dirNameExists) {
          targetDir = args[i + 1];
          i++;
        } else {
          throw new Error('--dir flag requires a directory name');
        }
      } else {
        remainingArgs.push(args[i]);
      }
    }

    return { targetDir, remainingArgs };
  }
}

/**
 * Base error handler for both compiler and formatter CLIs.
 * Handles common error types with operation-specific context.
 */
export class BaseErrorHandler {
  static handleCommonErrors(
    error: unknown,
    spinner: Ora,
    operation: string,
  ): boolean {
    // CompactCliNotFoundError
    if (error instanceof Error && error.name === 'CompactCliNotFoundError') {
      spinner.fail(chalk.red(`[${operation}] Error: ${error.message}`));
      spinner.info(
        chalk.blue(
          `[${operation}] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
        ),
      );
      return true;
    }

    // DirectoryNotFoundError
    if (error instanceof Error && error.name === 'DirectoryNotFoundError') {
      spinner.fail(chalk.red(`[${operation}] Error: ${error.message}`));
      SharedUIService.showAvailableDirectories(operation);
      return true;
    }

    // Environment validation errors
    if (isPromisifiedChildProcessError(error)) {
      spinner.fail(
        chalk.red(`[${operation}] Environment validation failed: ${error.message}`),
      );
      console.log(chalk.gray('\nTroubleshooting:'));
      console.log(
        chalk.gray('  • Check that Compact CLI is installed and in PATH'),
      );
      console.log(chalk.gray('  • Verify the specified Compact version exists'));
      console.log(chalk.gray('  • Ensure you have proper permissions'));
      return true;
    }

    // Argument parsing errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('--dir flag requires a directory name')) {
      spinner.fail(
        chalk.red(`[${operation}] Error: --dir flag requires a directory name`),
      );
      return false; // Let specific handler show usage
    }

    return false; // Not handled, let specific handler deal with it
  }

  static handleUnexpectedError(
    error: unknown,
    spinner: Ora,
    operation: string,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`[${operation}] Unexpected error: ${errorMessage}`));

    console.log(chalk.gray('\nIf this error persists, please check:'));
    console.log(chalk.gray('  • Compact CLI is installed and in PATH'));
    console.log(chalk.gray('  • Source files exist and are readable'));
    console.log(chalk.gray('  • File system permissions are correct'));
  }
}
