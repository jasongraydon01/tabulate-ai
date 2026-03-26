/**
 * Storage utilities
 * Purpose: Manage session directories and dual-output files during processing
 * Reads: OS tmp session dir; session files as needed
 * Writes: OS tmp session dir (uploads, dual outputs)
 * Invariants: keep session-scoped paths; no writes outside session dir
 */

import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';

// Defense-in-depth: validate sessionId at the storage layer (callers may also validate)
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;
function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid session ID: contains disallowed characters`);
  }
}

// Storage configuration
export interface StorageConfig {
  tempDir: string;
  sessionId: string;
  cleanup: boolean;
}

// File storage result
export interface StorageResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

// Dual output file paths
export interface DualOutputPaths {
  verboseBanner: string;
  verboseDataMap: string;
  agentBanner: string;
  agentDataMap: string;
}

// Create temporary directory for session
export const createSessionDir = async (sessionId: string): Promise<StorageResult> => {
  try {
    validateSessionId(sessionId);
    const sessionDir = join(tmpdir(), 'hawktab-ai', sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    
    return {
      success: true,
      filePath: sessionDir
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create session directory'
    };
  }
};

// Generate unique session ID
export const generateSessionId = (): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).substring(2, 8);
  return `session-${timestamp}-${random}`;
};

// Save uploaded file to temporary storage
export const saveUploadedFile = async (
  file: File,
  sessionId: string,
  fileName: string
): Promise<StorageResult> => {
  try {
    validateSessionId(sessionId);
    // Prevent path traversal via fileName (e.g. "../../etc/passwd")
    const safeName = basename(fileName);
    if (safeName !== fileName || safeName.includes('\0')) {
      return { success: false, error: 'Invalid file name' };
    }
    const sessionDir = join(tmpdir(), 'hawktab-ai', sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const filePath = join(sessionDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    
    return {
      success: true,
      filePath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save file'
    };
  }
};

// Create dual output file paths
export const createDualOutputPaths = (sessionId: string): DualOutputPaths => {
  validateSessionId(sessionId);
  const sessionDir = join(tmpdir(), 'hawktab-ai', sessionId);
  
  return {
    verboseBanner: join(sessionDir, 'banner-plan-verbose.json'),
    verboseDataMap: join(sessionDir, 'data-map-verbose.json'),
    agentBanner: join(sessionDir, 'banner-plan-agent.json'),
    agentDataMap: join(sessionDir, 'data-map-agent.json')
  };
};

// Save dual output files
export const saveDualOutputs = async (
  sessionId: string,
  outputs: {
    verboseBanner: unknown;
    verboseDataMap: unknown;
    agentBanner: unknown;
    agentDataMap: unknown;
  }
): Promise<{ success: boolean; paths?: DualOutputPaths; error?: string }> => {
  try {
    validateSessionId(sessionId);
    const paths = createDualOutputPaths(sessionId);

    // Ensure directory exists
    await fs.mkdir(join(tmpdir(), 'hawktab-ai', sessionId), { recursive: true });
    
    // Save all four files
    await Promise.all([
      fs.writeFile(paths.verboseBanner, JSON.stringify(outputs.verboseBanner, null, 2)),
      fs.writeFile(paths.verboseDataMap, JSON.stringify(outputs.verboseDataMap, null, 2)),
      fs.writeFile(paths.agentBanner, JSON.stringify(outputs.agentBanner, null, 2)),
      fs.writeFile(paths.agentDataMap, JSON.stringify(outputs.agentDataMap, null, 2))
    ]);
    
    return {
      success: true,
      paths
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save dual outputs'
    };
  }
};

// Load agent files for processing
export const loadAgentFiles = async (sessionId: string): Promise<{
  success: boolean;
  data?: { banner: unknown; dataMap: unknown };
  error?: string;
}> => {
  try {
    validateSessionId(sessionId);
    const paths = createDualOutputPaths(sessionId);

    const [bannerContent, dataMapContent] = await Promise.all([
      fs.readFile(paths.agentBanner, 'utf8'),
      fs.readFile(paths.agentDataMap, 'utf8')
    ]);
    
    return {
      success: true,
      data: {
        banner: JSON.parse(bannerContent),
        dataMap: JSON.parse(dataMapContent)
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load agent files'
    };
  }
};

// Clean up session files
export const cleanupSession = async (sessionId: string): Promise<StorageResult> => {
  try {
    validateSessionId(sessionId);
    const sessionDir = join(tmpdir(), 'hawktab-ai', sessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cleanup session'
    };
  }
};

// List session files for debugging
export const listSessionFiles = async (sessionId: string): Promise<{
  success: boolean;
  files?: string[];
  error?: string;
}> => {
  try {
    validateSessionId(sessionId);
    const sessionDir = join(tmpdir(), 'hawktab-ai', sessionId);
    const files = await fs.readdir(sessionDir);
    
    return {
      success: true,
      files
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list session files'
    };
  }
};

// Get file info for debugging
export const getFileInfo = async (filePath: string): Promise<{
  success: boolean;
  info?: { size: number; modified: Date };
  error?: string;
}> => {
  try {
    const stats = await fs.stat(filePath);
    
    return {
      success: true,
      info: {
        size: stats.size,
        modified: stats.mtime
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get file info'
    };
  }
};