#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { BaseErrorHandler } from './BaseServices.js';
import { CompactFormatter } from './Formatter.js';
import {
  type FormatterError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Main entry point for the Compact formatter CLI application.
 *
 * Coordinates the complete formatting workflow from command-line argument
 * parsing through execution and error handling. Provides comprehensive user
 * feedback and detailed error reporting for both check and write formatting
 * operations.
 *
 * The function manages the full application lifecycle:
 *
 * 1. Parses command-line arguments into formatter configuration.
 * 2. Executes formatting operations with visual progress indicators.
 * 3. Handles all error scenarios with actionable user guidance.
 * 4. Exits with appropriate status codes for automated workflows.
 *
 * @example
 * ```bash
 * # Called from command line as:
 * compact-formatter --check --dir ./contracts/src/security
 * compact-formatter --write ./contracts/src/access/AccessControl.compact
 * ```
 */
async function runFormatter(): Promise<void> {
  const spinner = ora(chalk.blue('[FORMAT] Compact formatter started')).info();

  try {
    const args = process.argv.slice(2);
    const formatter = CompactFormatter.fromArgs(args);
    await formatter.format();
  } catch (error) {
    handleError(error, spinner);
    process.exit(1);
  }
}

/**
 * Specialized error handler for formatting operation failures.
 *
 * Implements multi-layered error handling that addresses both common infrastructure
 * issues and formatting-specific problems. Provides detailed diagnostic information
 * and recovery suggestions tailored to formatting workflows.
 *
 * Error handling hierarchy:
 *
 * 1. Common errors (CLI availability, directory validation).
 * 2. Formatter availability errors (toolchain compatibility issues).
 * 3. Formatting operation errors (file processing failures).
 * 4. Argument parsing errors (command-line usage problems).
 * 5. Unexpected errors (with comprehensive troubleshooting).
 *
 * @param error - The error that occurred during formatting operations
 * @param spinner - Ora spinner instance for consistent visual feedback
 *
 * @example
 * ```typescript
 * // This function handles errors such as:
 * // - FormatterNotAvailableError: Formatter not available in current toolchain
 * // - FormatterError: Failed to format Token.compact
 * // - DirectoryNotFoundError: Target directory contracts/ does not exist
 * ```
 */
function handleError(error: unknown, spinner: Ora): void {
  // Try common error handling first
  if (BaseErrorHandler.handleCommonErrors(error, spinner, 'FORMAT')) {
    return;
  }

  // FormatterNotAvailableError - specific to formatting
  if (error instanceof Error && error.name === 'FormatterNotAvailableError') {
    spinner.fail(chalk.red(`[FORMAT] Error: ${error.message}`));
    spinner.info(chalk.blue('[FORMAT] Update compiler with: compact update'));
    spinner.info(
      chalk.blue('[FORMAT] Update dev tools with: compact self update'),
    );
    return;
  }

  // FormatterError - specific to formatting
  if (error instanceof Error && error.name === 'FormatterError') {
    const formatterError = error as FormatterError;
    spinner.fail(
      chalk.red(
        `[FORMAT] Formatting failed${formatterError.target ? ` for: ${formatterError.target}` : ''}`,
      ),
    );

    if (isPromisifiedChildProcessError(formatterError.cause)) {
      const execError = formatterError.cause;
      if (execError.stderr && !execError.stderr.includes('stdout')) {
        console.log(
          chalk.red(`    Additional error details: ${execError.stderr}`),
        );
      }
      if (execError.stdout) {
        console.log(chalk.yellow('    Output:'));
        console.log(chalk.yellow(`    ${execError.stdout}`));
      }
    }
    return;
  }

  // Argument parsing specific to formatting
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('--dir flag requires a directory name')) {
    showUsageHelp();
    return;
  }

  // Unexpected errors
  BaseErrorHandler.handleUnexpectedError(error, spinner, 'FORMAT');
}

/**
 * Displays comprehensive usage documentation for the Compact formatter CLI.
 *
 * Provides complete reference documentation including all command-line options,
 * practical usage patterns, and integration examples. Covers both basic formatting
 * operations and advanced workflows including check mode, directory targeting,
 * and specific file processing.
 *
 * The help documentation includes:
 *
 * - Detailed option descriptions with behavior explanations.
 * - Comprehensive examples for common formatting scenarios.
 * - Integration patterns with build systems and CI/CD workflows.
 * - Best practices for different development workflows.
 *
 * @example
 * ```typescript
 * // Automatically displayed when argument parsing fails:
 * // compact-formatter --dir  # Missing directory name
 * // Shows complete usage guide to assist proper command construction
 * ```
 */
function showUsageHelp(): void {
  console.log(chalk.yellow('\nUsage: compact-formatter [options] [files...]'));
  console.log(chalk.yellow('\nOptions:'));
  console.log(
    chalk.yellow(
      '  --check           Check if files are properly formatted (no modifications)',
    ),
  );
  console.log(
    chalk.yellow(
      '  --dir <directory> Format specific directory (access, archive, security, token, utils)',
    ),
  );
  console.log(chalk.yellow('\nExamples:'));
  console.log(
    chalk.yellow(
      '  compact-formatter                                    # Format all files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --check                            # Check all files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --dir security                     # Format security directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --dir access --check               # Check access directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter file1.compact file2.compact        # Format specific files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --check file1.compact              # Check specific file',
    ),
  );
  console.log(chalk.yellow('\nIntegration examples:'));
  console.log(
    chalk.yellow(
      '  turbo format                                     # Full formatting',
    ),
  );
  console.log(
    chalk.yellow(
      '  turbo format:security                            # Directory formatting',
    ),
  );
  console.log(
    chalk.yellow(
      '  turbo format:check                               # Check formatting',
    ),
  );
}

runFormatter();
