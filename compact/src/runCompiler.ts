#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CompactCompiler } from './Compiler.js';
import { BaseErrorHandler } from './BaseServices.js';
import {
  type CompilationError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Executes the Compact compiler CLI with improved error handling and user feedback.
 */
async function runCompiler(): Promise<void> {
  const spinner = ora(chalk.blue('[COMPILE] Compact compiler started')).info();

  try {
    const args = process.argv.slice(2);
    const compiler = CompactCompiler.fromArgs(args);
    await compiler.compile();
  } catch (error) {
    handleError(error, spinner);
    process.exit(1);
  }
}

/**
 * Centralized error handling with compiler-specific error types.
 */
function handleError(error: unknown, spinner: Ora): void {
  // Try common error handling first
  if (BaseErrorHandler.handleCommonErrors(error, spinner, 'COMPILE')) {
    return;
  }

  // CompilationError - specific to compilation
  if (error instanceof Error && error.name === 'CompilationError') {
    const compilationError = error as CompilationError;
    spinner.fail(
      chalk.red(
        `[COMPILE] Compilation failed for file: ${compilationError.file || 'unknown'}`,
      ),
    );

    if (isPromisifiedChildProcessError(compilationError.cause)) {
      const execError = compilationError.cause;
      if (
        execError.stderr &&
        !execError.stderr.includes('stdout') &&
        !execError.stderr.includes('stderr')
      ) {
        console.log(
          chalk.red(`    Additional error details: ${execError.stderr}`),
        );
      }
    }
    return;
  }

  // Argument parsing specific to compilation
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('--dir flag requires a directory name')) {
    showUsageHelp();
    return;
  }

  // Unexpected errors
  BaseErrorHandler.handleUnexpectedError(error, spinner, 'COMPILE');
}

/**
 * Shows usage help with examples for compilation scenarios.
 */
function showUsageHelp(): void {
  console.log(chalk.yellow('\nUsage: compact-compiler [options]'));
  console.log(chalk.yellow('\nOptions:'));
  console.log(
    chalk.yellow(
      '  --dir <directory> Compile specific directory (access, archive, security, token, utils)',
    ),
  );
  console.log(
    chalk.yellow('  --skip-zk         Skip zero-knowledge proof generation'),
  );
  console.log(
    chalk.yellow(
      '  +<version>        Use specific toolchain version (e.g., +0.24.0)',
    ),
  );
  console.log(chalk.yellow('\nExamples:'));
  console.log(
    chalk.yellow(
      '  compact-compiler                           # Compile all files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --dir security             # Compile security directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --dir access --skip-zk     # Compile access with flags',
    ),
  );
  console.log(
    chalk.yellow(
      '  SKIP_ZK=true compact-compiler --dir token   # Use environment variable',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --skip-zk +0.24.0          # Use specific version',
    ),
  );
  console.log(chalk.yellow('\nTurbo integration:'));
  console.log(
    chalk.yellow('  turbo compact                               # Full build'),
  );
  console.log(
    chalk.yellow(
      '  turbo compact:security -- --skip-zk         # Directory with flags',
    ),
  );
  console.log(
    chalk.yellow(
      '  SKIP_ZK=true turbo compact                  # Environment variables',
    ),
  );
}

runCompiler();
