#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CompactFormatter } from './Formatter.js';
import { BaseErrorHandler } from './BaseServices.js';
import {
  type FormatterError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Executes the Compact formatter CLI with improved error handling and user feedback.
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
 * Centralized error handling with formatter-specific error types.
 */
function handleError(error: unknown, spinner: Ora): void {
  // Try common error handling first
  if (BaseErrorHandler.handleCommonErrors(error, spinner, 'FORMAT')) {
    return;
  }

  // FormatterNotAvailableError - specific to formatting
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
 * Shows usage help with examples for formatting scenarios.
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
