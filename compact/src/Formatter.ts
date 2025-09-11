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
 * Environment validator specialized for Compact formatting operations.
 *
 * Extends the base validator with formatting-specific requirements including
 * formatter availability checking and version compatibility validation. Ensures
 * the Compact formatter is available and properly configured before attempting
 * formatting operations.
 *
 * The formatter requires Compact compiler version 0.25.0 or later to be available.
 *
 * @example
 * ```typescript
 * const validator = new FormatterEnvironmentValidator();
 * const { devToolsVersion } = await validator.validate();
 * console.log(`Formatter available with dev tools ${devToolsVersion}`);
 * ```
 */
export class FormatterEnvironmentValidator extends BaseEnvironmentValidator {
  /**
   * Verifies that the Compact formatter is available and accessible.
   *
   * Tests formatter availability by attempting to access the format help command.
   * The formatter requires Compact compiler version 0.25.0 or later, and this
   * method provides clear error messaging when the formatter is not available.
   *
   * @throws FormatterNotAvailableError if formatter is not available in current toolchain
   * @throws Error if help command fails for other reasons
   *
   * @example
   * ```typescript
   * try {
   *   await validator.checkFormatterAvailable();
   *   console.log('Formatter is ready for use');
   * } catch (error) {
   *   if (error instanceof FormatterNotAvailableError) {
   *     console.error('Please update Compact compiler to use formatter');
   *   }
   * }
   * ```
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
   * Performs comprehensive environment validation for formatting operations.
   *
   * Validates both the base Compact CLI environment and formatting-specific
   * requirements. Ensures the formatter is available and accessible before
   * proceeding with formatting operations.
   *
   * @returns Promise resolving to validation results with dev tools version
   * @throws CompactCliNotFoundError if CLI is not available
   * @throws FormatterNotAvailableError if formatter is not available
   *
   * @example
   * ```typescript
   * const { devToolsVersion } = await validator.validate();
   * console.log(`Environment validated with ${devToolsVersion}`);
   * ```
   */
  async validate(): Promise<{ devToolsVersion: string }> {
    const { devToolsVersion } = await this.validateBase();
    await this.checkFormatterAvailable();
    return { devToolsVersion };
  }
}

/**
 * Service for executing Compact formatting commands.
 *
 * Handles the construction and execution of formatting commands for both check
 * and write operations. Manages path resolution, command flag application, and
 * provides specialized error handling for formatting failures. Supports both
 * directory-wide and individual file formatting operations.
 *
 * @example
 * ```typescript
 * const formatter = new FormatterService();
 * 
 * // Check formatting without modifications
 * const checkResult = await formatter.checkFormatting('src/contracts');
 * console.log('Is formatted:', checkResult.isFormatted);
 *
 * // Format and write changes
 * await formatter.formatAndWrite('src/contracts');
 * ```
 */
export class FormatterService extends BaseCompactService {
  /**
   * Formats files and writes the changes to disk.
   *
   * Executes the format command in write mode, applying formatting changes
   * directly to the source files. Can target a specific directory path or
   * operate on the entire source tree when no path is specified.
   *
   * @param targetPath - Optional path to target for formatting (directory or file)
   * @returns Promise resolving to command execution results with stdout and stderr
   * @throws FormatterError if formatting operation fails
   *
   * @example
   * ```typescript
   * // Format all files in the project
   * await formatter.formatAndWrite();
   *
   * // Format specific directory
   * await formatter.formatAndWrite('src/contracts/security');
   *
   * // Format specific file
   * await formatter.formatAndWrite('src/Token.compact');
   * ```
   */
  async formatAndWrite(
    targetPath?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const pathArg = targetPath ? ` "${targetPath}"` : '';
    const command = `compact format${pathArg}`;
    return this.executeCompactCommand(command, 'Failed to format');
  }

  /**
   * Checks if files are properly formatted without modifying them.
   *
   * Executes the format command in check mode to validate formatting without
   * making changes. Returns both the execution results and a boolean indicating
   * whether the files are properly formatted. Exit code 1 with output indicates
   * formatting differences, while other errors represent actual failures.
   *
   * @param targetPath - Optional path to check for formatting (directory or file)
   * @returns Promise resolving to check results including formatting status
   * @throws FormatterError if check operation fails (excluding formatting differences)
   *
   * @example
   * ```typescript
   * // Check all files
   * const result = await formatter.checkFormatting();
   * if (!result.isFormatted) {
   *   console.log('Formatting differences:', result.stdout);
   * }
   *
   * // Check specific directory
   * const result = await formatter.checkFormatting('src/contracts');
   * console.log('Directory is formatted:', result.isFormatted);
   * ```
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
      if (
        error instanceof FormatterError &&
        isPromisifiedChildProcessError(error.cause)
      ) {
        const childProcessError = error.cause;
        if (childProcessError.code === 1 && childProcessError.stdout) {
          return {
            stdout: childProcessError.stdout,
            stderr: childProcessError.stderr || '',
            isFormatted: false,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Formats a specific list of .compact files.
   *
   * Applies formatting to the provided list of files, resolving their paths
   * relative to the SRC_DIR. Useful for formatting only specific files rather
   * than entire directories, such as when processing files from a git diff
   * or user selection.
   *
   * @param files - Array of relative file paths from SRC_DIR to format
   * @returns Promise resolving to command execution results
   * @throws FormatterError if any file fails to format
   *
   * @example
   * ```typescript
   * // Format specific files
   * await formatter.formatFiles([
   *   'Token.compact',
   *   'contracts/security/AccessControl.compact'
   * ]);
   *
   * // Handle empty file list gracefully
   * await formatter.formatFiles([]); // Returns empty results
   * ```
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

  /**
   * Creates formatting-specific error instances.
   *
   * Wraps formatting failures in FormatterError instances that provide
   * additional context including the target that failed to format. Extracts
   * the target (file or directory) from error messages when possible for
   * better error reporting and debugging.
   *
   * @param message - Error message describing the formatting failure
   * @param cause - Original error that caused the formatting failure (optional)
   * @returns FormatterError instance with target context and cause information
   *
   * @example
   * ```typescript
   * // This method is called automatically by executeCompactCommand
   * // when formatting fails, creating errors like:
   * // FormatterError: Failed to format contracts/Token.compact
   * ```
   */
  protected createError(message: string, cause?: unknown): Error {
    // Extract target from error message for FormatterError
    const match = message.match(/Failed to format(?: files:)? (.+)/);
    const target = match ? match[1] : undefined;
    return new FormatterError(message, target, cause);
  }
}

/**
 * UI service specialized for formatting operations.
 *
 * Provides formatting-specific user interface elements and messaging.
 * Extends the shared UI service with formatting-focused information display,
 * check result reporting, and operation status messaging. Ensures consistent
 * visual presentation across formatting operations.
 */
export const FormatterUIService = {
  ...SharedUIService,

  /**
   * Displays formatting environment information.
   *
   * Shows developer tools version and optional target directory information
   * for formatting operations. Provides users with clear visibility into
   * the formatting environment configuration.
   *
   * @param devToolsVersion - Version of the installed Compact developer tools
   * @param targetDir - Optional target directory being formatted (relative to src/)
   *
   * @example
   * ```typescript
   * FormatterUIService.displayEnvInfo(
   *   'compact-dev-tools 2.1.0',
   *   'contracts'
   * );
   * // Output:
   * // ℹ [FORMAT] TARGET_DIR: contracts
   * // ℹ [FORMAT] Compact developer tools: compact-dev-tools 2.1.0
   * ```
   */
  displayEnvInfo(devToolsVersion: string, targetDir?: string): void {
    SharedUIService.displayBaseEnvInfo('FORMAT', devToolsVersion, targetDir);
  },

  /**
   * Displays formatting start message with operation context.
   *
   * Informs users about the scope of the formatting operation, including
   * the number of files found, the mode of operation (check vs write),
   * and the directory being processed. Provides clear expectations about
   * the work to be performed.
   *
   * @param fileCount - Number of .compact files discovered for formatting
   * @param mode - Operation mode: 'check' for validation, 'write' for formatting
   * @param targetDir - Optional target directory being processed
   *
   * @example
   * ```typescript
   * FormatterUIService.showFormattingStart(3, 'check', 'contracts');
   * // Output: ℹ [FORMAT] Found 3 .compact file(s) to check formatting for in contracts/
   *
   * FormatterUIService.showFormattingStart(5, 'write');
   * // Output: ℹ [FORMAT] Found 5 .compact file(s) to format
   * ```
   */
  showFormattingStart(
    fileCount: number,
    mode: 'check' | 'write',
    targetDir?: string,
  ): void {
    const action = mode === 'check' ? 'check formatting for' : 'format';
    SharedUIService.showOperationStart('FORMAT', action, fileCount, targetDir);
  },

  /**
   * Displays warning when no .compact files are found for formatting.
   *
   * Provides clear feedback when the formatting operation cannot proceed
   * because no source files were discovered in the target location.
   * Helps users understand where files are expected to be located.
   *
   * @param targetDir - Optional target directory that was searched
   *
   * @example
   * ```typescript
   * FormatterUIService.showNoFiles('contracts');
   * // Output: ⚠ [FORMAT] No .compact files found in contracts/.
   *
   * FormatterUIService.showNoFiles();
   * // Output: ⚠ [FORMAT] No .compact files found in src/.
   * ```
   */
  showNoFiles(targetDir?: string): void {
    SharedUIService.showNoFiles('FORMAT', targetDir);
  },

  /**
   * Displays formatting check results with appropriate visual feedback.
   *
   * Shows the outcome of formatting checks with success/failure indicators
   * and optional formatting differences. Provides clear visual distinction
   * between properly formatted code and code that needs formatting changes.
   *
   * @param isFormatted - Whether the checked files are properly formatted
   * @param differences - Optional formatting differences to display
   *
   * @example
   * ```typescript
   * // Show success for properly formatted files
   * FormatterUIService.showCheckResults(true);
   * // Output: ✓ [FORMAT] All files are properly formatted
   *
   * // Show failure with differences
   * FormatterUIService.showCheckResults(false, 'Token.compact needs formatting');
   * // Output: ✗ [FORMAT] Some files are not properly formatted
   * //         Formatting differences:
   * //         Token.compact needs formatting
   * ```
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
 * Main formatter orchestrator for Compact formatting operations.
 *
 * Coordinates the complete formatting workflow from environment validation
 * through file processing. Manages formatting configuration including check/write
 * modes, target specifications (directories or individual files), and provides
 * progress reporting and error handling for both batch and individual file
 * formatting operations.
 *
 * @example
 * ```typescript
 * // Check formatting of all files
 * const formatter = new CompactFormatter(false);
 * await formatter.format();
 *
 * // Format specific files
 * const formatter = new CompactFormatter(true, ['Token.compact', 'AccessControl.compact']);
 * await formatter.format();
 *
 * // Format specific directory
 * const formatter = new CompactFormatter(true, ['contracts']);
 * await formatter.format();
 * ```
 */
export class CompactFormatter extends BaseCompactOperation {
  private readonly environmentValidator: FormatterEnvironmentValidator;
  private readonly formatterService: FormatterService;
  private readonly writeMode: boolean;
  private readonly targets: string[];

  /**
   * Creates a new CompactFormatter instance with specified configuration.
   *
   * Initializes the formatter with operation mode (check vs write), target
   * specifications (directories or files), and sets up the necessary services
   * for environment validation and command execution. Handles both directory
   * and individual file targeting scenarios.
   *
   * @param writeMode - Whether to write formatting changes (true) or just check (false)
   * @param targets - Array of target directories or files to format
   * @param execFn - Optional command execution function for testing/customization
   *
   * @example
   * ```typescript
   * // Check formatting of all files (default)
   * const formatter = new CompactFormatter();
   *
   * // Format all files with changes written
   * const formatter = new CompactFormatter(true);
   *
   * // Check specific files without writing
   * const formatter = new CompactFormatter(false, ['Token.compact', 'AccessControl.compact']);
   *
   * // Format specific directory
   * const formatter = new CompactFormatter(true, ['contracts']);
   *
   * // For testing with custom execution function
   * const formatter = new CompactFormatter(false, [], mockExecFn);
   * ```
   */
  constructor(
    writeMode = false,
    targets: string[] = [],
    execFn?: ExecFunction,
  ) {
    // For single directory target, use it as targetDir
    const targetDir =
      targets.length === 1 && !targets[0].endsWith('.compact')
        ? targets[0]
        : undefined;

    super(targetDir);
    this.writeMode = writeMode;
    this.targets = targets;
    this.environmentValidator = new FormatterEnvironmentValidator(execFn);
    this.formatterService = new FormatterService(execFn);
  }

  /**
   * Factory method to create a CompactFormatter from command-line arguments.
   *
   * Parses command-line arguments to construct a properly configured
   * CompactFormatter instance. Handles flag processing, target specification,
   * and mode determination from command-line inputs. Provides the primary
   * interface between CLI arguments and formatter configuration.
   *
   * @param args - Raw command-line arguments array
   * @returns Configured CompactFormatter instance ready for execution
   * @throws Error if arguments are malformed (e.g., --dir without directory name)
   *
   * @example
   * ```typescript
   * // Parse from command line: ['--check', '--dir', 'contracts']
   * const formatter = CompactFormatter.fromArgs([
   *   '--check',
   *   '--dir', 'contracts'
   * ]);
   *
   * // Parse write mode with specific files: ['--write', 'Token.compact']
   * const formatter = CompactFormatter.fromArgs([
   *   '--write',
   *   'Token.compact'
   * ]);
   *
   * // Parse from actual process arguments
   * const formatter = CompactFormatter.fromArgs(process.argv.slice(2));
   * ```
   */
  static fromArgs(args: string[]): CompactFormatter {
    const { targetDir, remainingArgs } = CompactFormatter.parseBaseArgs(args);

    let writeMode = false;
    const targets: string[] = [];

    // Add targetDir to targets if specified
    if (targetDir) {
      targets.push(targetDir);
    }

    for (const arg of remainingArgs) {
      if (arg === '--write') {
        writeMode = true;
      } else if (!arg.startsWith('--')) {
        targets.push(arg);
      }
    }

    return new CompactFormatter(writeMode, targets);
  }

  /**
   * Validates the formatting environment and displays configuration information.
   *
   * Performs comprehensive environment validation including CLI availability,
   * formatter availability verification, and configuration display. Must be
   * called before attempting formatting operations.
   *
   * @throws CompactCliNotFoundError if Compact CLI is not available
   * @throws FormatterNotAvailableError if formatter is not available
   *
   * @example
   * ```typescript
   * try {
   *   await formatter.validateEnvironment();
   *   // Environment is valid, proceed with formatting
   * } catch (error) {
   *   if (error instanceof FormatterNotAvailableError) {
   *     console.error('Please update Compact compiler to use formatter');
   *   }
   * }
   * ```
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion } = await this.environmentValidator.validate();
    FormatterUIService.displayEnvInfo(devToolsVersion, this.targetDir);
  }

  /**
   * Displays warning message when no .compact files are found.
   *
   * Shows operation-specific messaging when file discovery returns no results.
   * Provides clear feedback about the search location and expected file locations.
   */
  showNoFiles(): void {
    FormatterUIService.showNoFiles(this.targetDir);
  }

  /**
   * Executes the complete formatting workflow.
   *
   * Orchestrates the full formatting process: validates environment, determines
   * operation mode (specific files vs directory), and executes the appropriate
   * formatting strategy. Handles both check and write operations with progress
   * reporting and error handling.
   *
   * @throws CompactCliNotFoundError if Compact CLI is not available
   * @throws FormatterNotAvailableError if formatter is not available
   * @throws DirectoryNotFoundError if target directory doesn't exist
   * @throws FormatterError if any file fails to format
   *
   * @example
   * ```typescript
   * const formatter = new CompactFormatter(false, ['contracts']);
   *
   * try {
   *   await formatter.format();
   *   console.log('Formatting check completed successfully');
   * } catch (error) {
   *   if (error instanceof FormatterError) {
   *     console.error(`Formatting failed: ${error.message}`);
   *   }
   * }
   * ```
   */
  async format(): Promise<void> {
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
   * Formats or checks specific files provided as command-line arguments.
   *
   * Handles formatting operations when specific .compact files are provided
   * as targets. In check mode, validates each file individually with separate
   * status reporting. In write mode, formats all specified files in a single
   * operation for efficiency.
   *
   * @throws FormatterError if any file fails to format or check
   *
   * @example
   * ```typescript
   * // This method is called internally when targets are specific files:
   * // compact-formatter Token.compact AccessControl.compact
   * ```
   */
  private async formatSpecificFiles(): Promise<void> {
    if (!this.writeMode) {
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
   * Formats or checks all files in a directory or the entire source tree.
   *
   * Handles batch formatting operations for directory targets or the entire
   * project when no specific targets are provided. Discovers files, reports
   * progress, and executes the appropriate formatting strategy based on the
   * operation mode.
   *
   * @throws FormatterError if directory formatting fails
   *
   * @example
   * ```typescript
   * // This method is called internally for directory operations:
   * // compact-formatter --dir contracts
   * // compact-formatter  # formats entire src/ directory
   * ```
   */
  private async formatDirectory(): Promise<void> {
    const { files, searchDir } = await this.discoverFiles();
    if (files.length === 0) return;

    const mode = this.writeMode ? 'write' : 'check';
    FormatterUIService.showFormattingStart(files.length, mode, this.targetDir);

    if (!this.writeMode) {
      const result = await this.formatterService.checkFormatting(searchDir);
      FormatterUIService.showCheckResults(result.isFormatted, result.stdout);
    } else {
      const result = await this.formatterService.formatAndWrite(searchDir);

      // Successful formatting typically produces no output
      if (result.stdout.trim()) {
        SharedUIService.printOutput(result.stdout, chalk.cyan);
      }
      if (result.stderr.trim()) {
        SharedUIService.printOutput(result.stderr, chalk.yellow);
      }

      const spinner = ora();
      spinner.succeed(
        chalk.green(`[FORMAT] Processed ${files.length} file(s)`),
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
  get testWriteMode(): boolean {
    return this.writeMode;
  }

  get testTargets(): string[] {
    return this.targets;
  }
}
