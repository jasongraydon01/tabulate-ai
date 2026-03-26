// Input validation guardrails for CrosstabAgent system
// Reference: Architecture doc "Guardrails-First Development"

import { getEnvironmentConfig, getModelTokenLimit } from '../lib/env';

// File validation configuration
export interface FileValidationConfig {
  maxFileSize: number; // in bytes
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  requiredFiles: string[];
}

// Validation result interfaces
export interface FileValidationResult {
  isValid: boolean;
  file: File;
  errors: string[];
  warnings: string[];
}

export interface GuardrailResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    totalFiles: number;
    totalSizeBytes: number;
    estimatedTokenUsage?: number;
  };
}

// File validation configurations by type
export const FILE_VALIDATION_CONFIGS: Record<string, FileValidationConfig> = {
  dataMap: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    allowedExtensions: ['.csv', '.xlsx'],
    requiredFiles: ['dataMap']
  },
  bannerPlan: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    allowedExtensions: ['.pdf', '.doc', '.docx'],
    requiredFiles: ['bannerPlan']
  },
  dataFile: {
    maxFileSize: 100 * 1024 * 1024, // 100MB
    allowedMimeTypes: [
      'application/octet-stream', // .sav files often show as this
      'application/x-spss-sav'
    ],
    allowedExtensions: ['.sav', '.spss'],
    requiredFiles: ['dataFile']
  }
};

// Individual file validation
export const validateFile = (file: File, fileType: keyof typeof FILE_VALIDATION_CONFIGS): FileValidationResult => {
  const config = FILE_VALIDATION_CONFIGS[fileType];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check file size
  if (file.size > config.maxFileSize) {
    errors.push(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${(config.maxFileSize / 1024 / 1024).toFixed(0)}MB)`);
  }

  // Check file extension
  const fileName = file.name.toLowerCase();
  const hasValidExtension = config.allowedExtensions.some(ext => fileName.endsWith(ext));
  if (!hasValidExtension) {
    errors.push(`File extension must be one of: ${config.allowedExtensions.join(', ')}`);
  }

  // Check MIME type (if available and supported by browser)
  if (file.type && !config.allowedMimeTypes.includes(file.type)) {
    warnings.push(`File MIME type (${file.type}) may not be fully supported. Ensure file is in correct format.`);
  }

  // File name validation
  if (file.name.length > 255) {
    errors.push('File name is too long (maximum 255 characters)');
  }

  // Check for potentially problematic characters in filename
  const problematicChars = /[<>:"|?*\x00-\x1f]/;
  if (problematicChars.test(file.name)) {
    errors.push('File name contains invalid characters');
  }

  return {
    isValid: errors.length === 0,
    file,
    errors,
    warnings
  };
};

// Batch file validation
export const validateFiles = (files: { [key: string]: File }): GuardrailResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let totalSizeBytes = 0;

  // Check that all required files are present
  const requiredFileTypes = ['dataMap', 'bannerPlan', 'dataFile'];
  for (const fileType of requiredFileTypes) {
    if (!files[fileType]) {
      errors.push(`Missing required file: ${fileType}`);
    }
  }

  // Validate each file
  const fileValidationResults: FileValidationResult[] = [];
  for (const [fileType, file] of Object.entries(files)) {
    if (file && fileType in FILE_VALIDATION_CONFIGS) {
      const result = validateFile(file, fileType as keyof typeof FILE_VALIDATION_CONFIGS);
      fileValidationResults.push(result);
      totalSizeBytes += file.size;
      
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  // Check total file size against reasonable limits
  const maxTotalSize = 200 * 1024 * 1024; // 200MB total
  if (totalSizeBytes > maxTotalSize) {
    errors.push(`Total file size (${(totalSizeBytes / 1024 / 1024).toFixed(2)}MB) exceeds reasonable limit (${maxTotalSize / 1024 / 1024}MB)`);
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    metadata: {
      totalFiles: Object.keys(files).length,
      totalSizeBytes
    }
  };
};

// Data map size validation against environment limits
export const validateDataMapSize = async (dataMapContent: unknown): Promise<GuardrailResult> => {
  const config = getEnvironmentConfig();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Estimate data map size (rough approximation)
    const contentString = JSON.stringify(dataMapContent);
    const estimatedVariables = Array.isArray(dataMapContent) ? dataMapContent.length : 0;

    // Check against MAX_DATA_MAP_VARIABLES
    if (estimatedVariables > config.processingLimits.maxDataMapVariables) {
      errors.push(`Data map contains ${estimatedVariables} variables, exceeding limit of ${config.processingLimits.maxDataMapVariables}`);
    }

    // Estimate token usage for context validation
    const estimatedTokens = Math.ceil(contentString.length / 4); // Rough 4 chars per token
    const tokenLimit = getModelTokenLimit();
    
    if (estimatedTokens > tokenLimit * 0.6) { // Use 60% of token limit for data map
      warnings.push(`Data map may use ${estimatedTokens} tokens, approaching context limit (${tokenLimit}). Consider data reduction.`);
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
      metadata: {
        totalFiles: 1,
        totalSizeBytes: contentString.length,
        estimatedTokenUsage: estimatedTokens
      }
    };

  } catch (error) {
    errors.push(`Failed to validate data map size: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      errors,
      warnings
    };
  }
};

// Banner plan complexity validation
export const validateBannerComplexity = (bannerContent: unknown): GuardrailResult => {
  const config = getEnvironmentConfig();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Estimate banner complexity
    let totalColumns = 0;
    let totalGroups = 0;

    if (typeof bannerContent === 'object' && bannerContent !== null) {
      const banner = bannerContent as { bannerCuts?: Array<{ columns?: Array<unknown> }> };
      if (banner.bannerCuts && Array.isArray(banner.bannerCuts)) {
        totalGroups = banner.bannerCuts.length;
        totalColumns = banner.bannerCuts.reduce((total: number, group) => {
          return total + (group.columns ? group.columns.length : 0);
        }, 0);
      }
    }

    // Check against MAX_BANNER_COLUMNS
    if (totalColumns > config.processingLimits.maxBannerColumns) {
      errors.push(`Banner plan contains ${totalColumns} columns, exceeding limit of ${config.processingLimits.maxBannerColumns}`);
    }

    // Warn about complex banners
    if (totalColumns > 50) {
      warnings.push(`Banner plan has ${totalColumns} columns across ${totalGroups} groups. Processing may take longer.`);
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
      metadata: {
        totalFiles: 1,
        totalSizeBytes: JSON.stringify(bannerContent).length
      }
    };

  } catch (error) {
    errors.push(`Failed to validate banner complexity: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      errors,
      warnings
    };
  }
};

// Combined guardrail validation
export const runAllGuardrails = async (
  files: { [key: string]: File },
  dataMapContent?: unknown,
  bannerContent?: unknown
): Promise<GuardrailResult> => {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let totalSizeBytes = 0;
  let estimatedTokenUsage = 0;

  // File validation
  const fileResult = validateFiles(files);
  allErrors.push(...fileResult.errors);
  allWarnings.push(...fileResult.warnings);
  if (fileResult.metadata) {
    totalSizeBytes += fileResult.metadata.totalSizeBytes;
  }

  // Data map validation (if content provided)
  if (dataMapContent) {
    const dataMapResult = await validateDataMapSize(dataMapContent);
    allErrors.push(...dataMapResult.errors);
    allWarnings.push(...dataMapResult.warnings);
    if (dataMapResult.metadata?.estimatedTokenUsage) {
      estimatedTokenUsage += dataMapResult.metadata.estimatedTokenUsage;
    }
  }

  // Banner validation (if content provided)
  if (bannerContent) {
    const bannerResult = validateBannerComplexity(bannerContent);
    allErrors.push(...bannerResult.errors);
    allWarnings.push(...bannerResult.warnings);
  }

  return {
    success: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    metadata: {
      totalFiles: Object.keys(files).length,
      totalSizeBytes,
      estimatedTokenUsage: estimatedTokenUsage || undefined
    }
  };
};