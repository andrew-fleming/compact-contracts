import { join } from 'node:path';
import ora from 'ora';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { SRC_DIR } from '../src/BaseServices.js';
import {
  CompactFormatter,
  FormatterEnvironmentValidator,
  FormatterService,
  FormatterUIService,
} from '../src/Formatter.js';
import {
  FormatterError,
  FormatterNotAvailableError,
} from '../src/types/errors.js';

// Mock dependencies
vi.mock('chalk', () => ({
  default: {
    blue: vi.fn((text) => text),
    green: vi.fn((text) => text),
    red: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
    white: vi.fn((text) => text),
  },
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
  })),
}));

describe('FormatterEnvironmentValidator', () => {
  let validator: FormatterEnvironmentValidator;
  let mockExec: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    validator = new FormatterEnvironmentValidator(mockExec);
  });

  describe('checkFormatterAvailable', () => {
    it('succeeds when formatter is available', async () => {
      const testData = {
        expectedCommand: 'compact help format',
        response: { stdout: 'Format help text', stderr: '' },
      };

      mockExec.mockResolvedValue(testData.response);

      await expect(validator.checkFormatterAvailable()).resolves.not.toThrow();
      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('throws FormatterNotAvailableError when formatter not available', async () => {
      const testData = {
        error: Object.assign(new Error('Command failed'), {
          stderr: 'formatter not available',
          stdout: '',
        }),
      };

      mockExec.mockRejectedValue(testData.error);
      await expect(validator.checkFormatterAvailable()).rejects.toThrow(
        FormatterNotAvailableError,
      );
    });

    it('re-throws other errors', async () => {
      const testData = {
        error: new Error('Different error'),
      };

      mockExec.mockRejectedValue(testData.error);

      await expect(validator.checkFormatterAvailable()).rejects.toThrow(
        testData.error,
      );
    });
  });

  describe('validate', () => {
    it('returns dev tools version when validation succeeds', async () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        expectedResult: { devToolsVersion: 'compact 0.2.0' },
      };

      mockExec
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' }) // checkCompactAvailable
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' }) // getDevToolsVersion
        .mockResolvedValueOnce({ stdout: 'Format help', stderr: '' }); // checkFormatterAvailable

      const result = await validator.validate();

      expect(result).toEqual(testData.expectedResult);
    });
  });
});

describe('FormatterService', () => {
  let service: FormatterService;
  let mockExec: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    service = new FormatterService(mockExec);
  });

  describe('formatAndWrite', () => {
    it('constructs correct command with target path', async () => {
      const testData = {
        targetPath: 'security',
        expectedCommand: 'compact format "security"',
        response: { stdout: 'Formatted successfully', stderr: '' },
      };

      mockExec.mockResolvedValue(testData.response);

      const result = await service.formatAndWrite(testData.targetPath);

      expect(result).toEqual(testData.response);
      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('constructs command without target path', async () => {
      const testData = {
        expectedCommand: 'compact format',
        response: { stdout: 'Formatted successfully', stderr: '' },
      };

      mockExec.mockResolvedValue(testData.response);

      await service.formatAndWrite();

      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('throws FormatterError on failure', async () => {
      const testData = {
        targetPath: 'security',
        error: new Error('Format failed'),
      };

      mockExec.mockRejectedValue(testData.error);

      await expect(service.formatAndWrite(testData.targetPath)).rejects.toThrow(
        FormatterError,
      );
    });
  });

  describe('checkFormatting', () => {
    it('returns true when no formatting needed', async () => {
      const testData = {
        targetPath: 'security',
        expectedCommand: 'compact format --check "security"',
        response: { stdout: 'All files formatted', stderr: '' },
        expectedResult: {
          stdout: 'All files formatted',
          stderr: '',
          isFormatted: true,
        },
      };

      mockExec.mockResolvedValue(testData.response);

      const result = await service.checkFormatting(testData.targetPath);

      expect(result).toEqual(testData.expectedResult);
      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('returns false when formatting differences exist', async () => {
      const testData = {
        error: Object.assign(new Error('Formatting differences'), {
          code: 1,
          stdout: 'Differences found',
          stderr: 'Formatting failed',
        }),
        expectedResult: {
          stdout: 'Differences found',
          stderr: 'Formatting failed',
          isFormatted: false,
        },
      };

      mockExec.mockRejectedValue(testData.error);
      const result = await service.checkFormatting();

      expect(result).toEqual(testData.expectedResult);
    });

    it('throws FormatterError for unexpected failures', async () => {
      const testData = {
        error: new Error('Unexpected error'),
      };

      mockExec.mockRejectedValue(testData.error);

      await expect(service.checkFormatting()).rejects.toThrow(FormatterError);
    });

    it('handles FormatterError with PromisifiedChildProcessError cause', async () => {
      const childProcessError = Object.assign(
        new Error('Format check failed'),
        {
          code: 1,
          stdout: 'Differences found',
          stderr: 'Formatting failed',
        },
      );

      const formatterError = new FormatterError(
        'Failed to check formatting',
        undefined,
        childProcessError,
      );

      // Mock executeCompactCommand to throw the FormatterError
      const executeSpy = vi.spyOn(service as any, 'executeCompactCommand');
      executeSpy.mockRejectedValue(formatterError);

      const result = await service.checkFormatting();

      expect(result).toEqual({
        stdout: 'Differences found',
        stderr: 'Formatting failed',
        isFormatted: false,
      });

      executeSpy.mockRestore();
    });
  });

  describe('formatFiles', () => {
    it('formats multiple files correctly', async () => {
      const testData = {
        files: ['MyToken.compact', 'Security.compact'],
        expectedCommand: `compact format "${join(SRC_DIR, 'MyToken.compact')}" "${join(SRC_DIR, 'Security.compact')}"`,
        response: { stdout: 'Files formatted', stderr: '' },
      };

      mockExec.mockResolvedValue(testData.response);

      const result = await service.formatFiles(testData.files);

      expect(result).toEqual(testData.response);
      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('returns empty result for empty file list', async () => {
      const testData = {
        files: [],
        expectedResult: { stdout: '', stderr: '' },
      };

      const result = await service.formatFiles(testData.files);

      expect(result).toEqual(testData.expectedResult);
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('createError', () => {
    it('extracts target from error message', () => {
      const testData = {
        message: 'Failed to format security',
        expectedTarget: 'security',
      };

      // Access protected method using bracket notation
      const error = service['createError'](testData.message);

      expect(error).toBeInstanceOf(FormatterError);
      expect((error as FormatterError).target).toBe(testData.expectedTarget);
    });

    it('extracts target from file error message', () => {
      const testData = {
        message: 'Failed to format files: MyToken.compact, Security.compact',
        expectedTarget: 'MyToken.compact, Security.compact',
      };

      const error = service['createError'](testData.message);

      expect(error).toBeInstanceOf(FormatterError);
      expect((error as FormatterError).target).toBe(testData.expectedTarget);
    });

    it('handles message without target', () => {
      const testData = {
        message: 'Some generic error',
        expectedTarget: undefined,
      };

      const error = service['createError'](testData.message);

      expect(error).toBeInstanceOf(FormatterError);
      expect((error as FormatterError).target).toBe(testData.expectedTarget);
    });
  });
});

describe('FormatterUIService', () => {
  let mockSpinner: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpinner = {
      info: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    vi.mocked(ora).mockReturnValue(mockSpinner);
  });

  describe('displayEnvInfo', () => {
    it('displays environment information with target directory', () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        targetDir: 'security',
      };

      FormatterUIService.displayEnvInfo(
        testData.devToolsVersion,
        testData.targetDir,
      );

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[FORMAT] TARGET_DIR: security',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[FORMAT] Compact developer tools: compact 0.2.0',
      );
    });

    it('displays environment information without target directory', () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
      };

      FormatterUIService.displayEnvInfo(testData.devToolsVersion);

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[FORMAT] Compact developer tools: compact 0.2.0',
      );
      expect(mockSpinner.info).not.toHaveBeenCalledWith(
        expect.stringContaining('TARGET_DIR'),
      );
    });
  });

  describe('showCheckResults', () => {
    it('shows success when files are formatted', () => {
      const testData = {
        isFormatted: true,
      };

      FormatterUIService.showCheckResults(testData.isFormatted);

      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        '[FORMAT] All files are properly formatted',
      );
    });

    it('shows failure with differences when files need formatting', () => {
      const testData = {
        isFormatted: false,
        differences: 'Some formatting differences',
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      FormatterUIService.showCheckResults(
        testData.isFormatted,
        testData.differences,
      );

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[FORMAT] Some files are not properly formatted',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Formatting differences'),
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('CompactFormatter', () => {
  let formatter: CompactFormatter;
  let mockExec: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
  });

  describe('constructor', () => {
    it('creates instance with default parameters', () => {
      formatter = new CompactFormatter();

      expect(formatter).toBeInstanceOf(CompactFormatter);
      expect(formatter.testWriteMode).toBe(false);
      expect(formatter.testTargets).toEqual([]);
    });

    it('creates instance with all parameters', () => {
      const testData = {
        writeMode: true,
        targets: ['security', 'MyToken.compact'],
      };

      formatter = new CompactFormatter(
        testData.writeMode,
        testData.targets,
        mockExec,
      );

      expect(formatter.testWriteMode).toBe(testData.writeMode);
      expect(formatter.testTargets).toEqual(testData.targets);
    });
  });

  describe('fromArgs', () => {
    it('parses empty arguments', () => {
      formatter = CompactFormatter.fromArgs([]);

      expect(formatter.testWriteMode).toBe(false);
      expect(formatter.testTargets).toEqual([]);
    });

    it('parses --write flag', () => {
      const testData = {
        args: ['--write'],
        expectedWriteMode: true,
      };

      formatter = CompactFormatter.fromArgs(testData.args);

      expect(formatter.testWriteMode).toBe(testData.expectedWriteMode);
    });

    it('parses complex arguments', () => {
      const testData = {
        args: ['--dir', 'security', '--write', 'MyToken.compact'],
        expectedTargets: ['security', 'MyToken.compact'],
        expectedWriteMode: true,
      };

      formatter = CompactFormatter.fromArgs(testData.args);

      expect(formatter.testWriteMode).toBe(testData.expectedWriteMode);
      expect(formatter.testTargets).toEqual(testData.expectedTargets);
    });
  });

  describe('validateEnvironment', () => {
    it('calls validator and displays environment info', async () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        targetDir: 'security',
      };

      mockExec
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Format help', stderr: '' });

      const displaySpy = vi
        .spyOn(FormatterUIService, 'displayEnvInfo')
        .mockImplementation(() => {});

      formatter = new CompactFormatter(false, [testData.targetDir], mockExec);

      await formatter.validateEnvironment();

      expect(displaySpy).toHaveBeenCalledWith(
        testData.devToolsVersion,
        testData.targetDir,
      );

      displaySpy.mockRestore();
    });
  });
});
