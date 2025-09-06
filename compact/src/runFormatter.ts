#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CompactFormatter } from './Formatter.js';
import {
  type FormatterError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Executes the Compact formatter CLI with improved error handling and user feedback.
 *
 * This CLI provides formatting capabilities for .compact files using the Compact developer tools.
 * It supports both formatting in-place and checking formatting without modifications.
 *
 * @example Directory formatting
 * ```bash
 * npx compact-formatter --dir security
 * npx compact-formatter --dir token --check
 * ```
 *
 * @example Specific file formatting
 * ```bash
 * npx compact-formatter src/contracts/Token.compact src/utils/Helper.compact
 * npx compact-formatter --check src/contracts/Token.compact
 * ```
 *
 * @example Full project formatting
 * ```bash
 * npx compact-formatter
 * npx compact-formatter --check
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
 * Centralized error handling with specific error types and user-friendly messages.
 *
 * Handles different error types with appropriate user feedback:
 *
 * - `CompactCliNotFoundError`: Shows installation instructions.
 * - `FormatterNotAvailableError`: Shows update instructions for formatter support.
 * - `DirectoryNotFoundError`: Shows available directories.
 * - `FormatterError`: Shows formatting-specific error details.
 * - Environment validation errors: Shows troubleshooting tips.
 * - Argument parsing errors: Shows usage help.
 * - Generic errors: Shows general troubleshooting guidance.
 *
 * @param error - The error that occurred during formatting
 * @param spinner - Ora spinner instance for consistent UI messaging
 */
function handleError(error: unknown, spinner: Ora): void {
  // CompactCliNotFoundError
  if (error instanceof Error && error.name === 'CompactCliNotFoundError') {
    spinner.fail(chalk.red(`[FORMAT] Error: ${error.message}`));
    spinner.info(
      chalk.blue(
        `[FORMAT] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
      ),
    );
    return;
  }

  // FormatterNotAvailableError
  if (error instanceof Error && error.name === 'FormatterNotAvailableError') {
    spinner.fail(chalk.red(`[FORMAT] Error: ${error.message}`));
    spinner.info(
      chalk.blue('[FORMAT] Update compiler with: compact update'),
    );
    spinner.info(
      chalk.blue('[FORMAT] Update dev tools with: compact self update'),
    );
    return;
  }

  // DirectoryNotFoundError
  if (error instanceof Error && error.name === 'DirectoryNotFoundError') {
    spinner.fail(chalk.red(`[FORMAT] Error: ${error.message}`));
    showAvailableDirectories();
    return;
  }

  // FormatterError
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

  // Environment validation errors (non-CLI errors)
  if (isPromisifiedChildProcessError(error)) {
    spinner.fail(
      chalk.red(`[FORMAT] Environment validation failed: ${error.message}`),
    );
    console.log(chalk.gray('\nTroubleshooting:'));
    console.log(
      chalk.gray('  • Check that Compact CLI is installed and in PATH'),
    );
    console.log(
      chalk.gray('  • Update compiler with: compact update'),
    );
    console.log(
      chalk.gray('  • Update dev tools with: compact self update'),
    );
    console.log(chalk.gray('  • Ensure you have proper permissions'));
    return;
  }

  // Argument parsing
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('--dir flag requires a directory name')) {
    spinner.fail(
      chalk.red('[FORMAT] Error: --dir flag requires a directory name'),
    );
    showUsageHelp();
    return;
  }

  // Unexpected errors
  spinner.fail(chalk.red(`[FORMAT] Unexpected error: ${errorMessage}`));
  console.log(chalk.gray('\nIf this error persists, please check:'));
  console.log(chalk.gray('  • Compact CLI is installed and in PATH'));
  console.log(chalk.gray('  • Compact compiler is updated (compact update)'));
  console.log(chalk.gray('  • Source files exist and are readable'));
  console.log(chalk.gray('  • File system permissions are correct'));
}

/**
 * Shows available directories when `DirectoryNotFoundError` occurs.
 */
function showAvailableDirectories(): void {
  console.log(chalk.yellow('\nAvailable directories:'));
  console.log(
    chalk.yellow('  --dir access    # Format access control contracts'),
  );
  console.log(chalk.yellow('  --dir archive   # Format archive contracts'));
  console.log(chalk.yellow('  --dir security  # Format security contracts'));
  console.log(chalk.yellow('  --dir token     # Format token contracts'));
  console.log(chalk.yellow('  --dir utils     # Format utility contracts'));
}

/**
 * Shows usage help with examples for different scenarios.
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
    chalk.yellow('  turbo format                                     # Full formatting'),
  );
  console.log(
    chalk.yellow('  turbo format:security                            # Directory formatting'),
  );
  console.log(
    chalk.yellow('  turbo format:check                               # Check formatting'),
  );
}

runFormatter();
