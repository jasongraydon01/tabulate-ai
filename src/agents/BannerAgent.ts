/**
 * BannerAgent
 * Purpose: Extract banner groups and columns from DOC/PDF via Vercel AI SDK
 * Reads: uploaded banner plan file (doc/docx/pdf → converted to images)
 * Writes (dev): temp-outputs/output-<ts>/banner-*-{verbose|agent}-<ts>.json
 * Invariants: focus on logical group separation; preserve column names and originals
 */

import { generateText, Output, stepCountIs } from 'ai';
import { RESEARCH_DATA_PREAMBLE } from '../lib/promptSanitization';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';
import pdf2pic from 'pdf2pic';
import sharp from 'sharp';

// For LibreOffice headless conversion
const execFileAsync = promisify(execFile);

// Note: mammoth kept for potential future HTML extraction fallback
// import mammoth from 'mammoth';
import { z } from 'zod';
import { VerboseBannerPlan, AgentBannerGroup } from '../lib/contextBuilder';
import {
  getPromptVersions,
  getBannerModel,
  getBannerModelName,
  getBannerModelTokenLimit,
  getBannerReasoningEffort,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '../lib/env';
import { getBannerPrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import { bannerScratchpadTool, clearScratchpadEntries, getAndClearScratchpadEntries, formatScratchpadAsMarkdown } from './tools/scratchpad';

// Types for internal processing
export interface ProcessedImage {
  pageNumber: number;
  base64: string;
  width: number;
  height: number;
  format: string;
}

export interface BannerProcessingResult {
  verbose: VerboseBannerPlan;
  agent: AgentBannerGroup[];
  success: boolean;
  confidence: number;
  errors: string[];
  warnings: string[];
}

// Banner extraction schemas (same as BannerProcessor)
// NOTE: All properties must be required for Azure OpenAI structured output compatibility
// Azure OpenAI does not support optional properties in JSON Schema
const BannerColumnSchema = z.object({
  name: z.string(),
  original: z.string(),
  adjusted: z.string(),  // Required - AI must provide this
  statLetter: z.string(),
  confidence: z.number().min(0).max(1),
  requiresInference: z.boolean(),  // True if cut came from outside the banner plan
  reasoning: z.string(),           // Developer-facing: explains what was inferred and why
  uncertainties: z.array(z.string()) // What human should verify
});

const BannerCutSchema = z.object({
  groupName: z.string(),
  columns: z.array(BannerColumnSchema)
});

const BannerNotesSchema = z.object({
  type: z.enum(['calculation_rows', 'main_tab_notes', 'other']),
  original: z.string(),
  adjusted: z.string()  // Required - AI must provide this
});

const ExtractedBannerStructureSchema = z.object({
  bannerCuts: z.array(BannerCutSchema),
  notes: z.array(BannerNotesSchema),  // Required - AI must provide this (can be empty array)
  statisticalLettersUsed: z.array(z.string()),  // Only AI-knowable field; rest of processingMetadata is derived
});

const BannerExtractionResultSchema = z.object({
  success: z.boolean(),
  extractionType: z.literal('banner_extraction'),
  timestamp: z.string(),
  extractedStructure: ExtractedBannerStructureSchema,
  errors: z.array(z.string()),    // Required - AI returns empty array if no errors
  warnings: z.array(z.string())   // Required - AI returns empty array if no warnings
});

type BannerExtractionResult = z.infer<typeof BannerExtractionResultSchema>;

// Configuration
const BANNER_CONFIG = {
  maxFileSizeMB: 50,
  maxProcessingTimeMs: 300000, // 5 minutes
  imageFormat: 'png' as const,
  imageDPI: 300,
  maxImageResolution: 4096,
  confidenceThreshold: 0.7
};

// Get modular banner extraction prompt based on environment variable
const getBannerExtractionPrompt = (): string => {
  const promptVersions = getPromptVersions();
  return getBannerPrompt(promptVersions.bannerPromptVersion);
};

// NOTE: createBannerAgent() function removed - using generateText() directly

export class BannerAgent {
  // Main entry point - complete banner processing workflow
  async processDocument(
    filePath: string,
    outputDir?: string,
    abortSignal?: AbortSignal
  ): Promise<BannerProcessingResult> {
    console.log(`[BannerAgent] Starting document processing: ${path.basename(filePath)}`);
    const startTime = Date.now();

    // Check for cancellation before starting
    if (abortSignal?.aborted) {
      console.log('[BannerAgent] Aborted before processing started');
      throw new DOMException('BannerAgent aborted', 'AbortError');
    }

    // Clear scratchpad from any previous runs
    clearScratchpadEntries();

    try {
      // Step 1: Ensure we have a PDF
      const pdfPath = await this.ensurePDF(filePath);
      console.log(`[BannerAgent] PDF ready: ${path.basename(pdfPath)}`);

      // Check for cancellation after PDF conversion
      if (abortSignal?.aborted) {
        console.log('[BannerAgent] Aborted after PDF conversion');
        throw new DOMException('BannerAgent aborted', 'AbortError');
      }

      // Step 2: Convert PDF to images
      const images = await this.convertPDFToImages(pdfPath);
      console.log(`[BannerAgent] Generated ${images.length} images for processing`);

      if (images.length === 0) {
        return this.createFailureResult('No images could be generated from PDF');
      }

      // Check for cancellation after image conversion
      if (abortSignal?.aborted) {
        console.log('[BannerAgent] Aborted after image conversion');
        throw new DOMException('BannerAgent aborted', 'AbortError');
      }

      // Step 3: Extract banner structure using generateText with vision
      const extractionResult = await this.extractBannerStructureWithAgent(images, abortSignal);
      console.log(`[BannerAgent] Agent extraction completed - Success: ${extractionResult.success}`);

      // Step 4: Collect scratchpad entries for debugging (agent-specific to avoid contamination)
      const scratchpadEntries = getAndClearScratchpadEntries('BannerAgent');
      console.log(`[BannerAgent] Collected ${scratchpadEntries.length} scratchpad entries`);

      // Step 5: Generate dual outputs
      const dualOutputs = this.generateDualOutputs(extractionResult);

      // Step 6: Save outputs (always save for MVP)
      if (outputDir) {
        await this.saveDevelopmentOutputs(dualOutputs, filePath, outputDir, scratchpadEntries, images);
      }

      const processingTime = Date.now() - startTime;
      console.log(`[BannerAgent] Processing completed in ${processingTime}ms`);

      return {
        verbose: dualOutputs.verbose,
        agent: dualOutputs.agent,
        success: extractionResult.success,
        confidence: this.calculateConfidence(extractionResult),
        errors: extractionResult.errors || [],
        warnings: extractionResult.warnings || []
      };

    } catch (error) {
      console.error('[BannerAgent] Processing failed:', error);
      if (outputDir) {
        try {
          await persistAgentErrorAuto({
            outputDir,
            agentName: 'BannerAgent',
            severity: error instanceof DOMException && error.name === 'AbortError' ? 'warning' : 'error',
            actionTaken: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'continued',
            error,
            meta: {
              fileName: path.basename(filePath),
              durationMs: Date.now() - startTime,
            },
          });
        } catch {
          // ignore
        }
      }
      return this.createFailureResult(
        error instanceof Error ? error.message : 'Unknown processing error'
      );
    }
  }

  // Agent-based extraction using Vercel AI SDK with vision
  private async extractBannerStructureWithAgent(
    images: ProcessedImage[],
    abortSignal?: AbortSignal
  ): Promise<BannerExtractionResult> {
    console.log(`[BannerAgent] Starting agent-based extraction with ${images.length} images`);
    console.log(`[BannerAgent] Using model: ${getBannerModelName()}`);
    console.log(`[BannerAgent] Reasoning effort: ${getBannerReasoningEffort()}`);
    const genConfig = getGenerationConfig();
    const startTime = Date.now();

    // Check for cancellation before AI call
    if (abortSignal?.aborted) {
      console.log('[BannerAgent] Aborted before AI extraction');
      throw new DOMException('BannerAgent aborted', 'AbortError');
    }

    const systemPrompt = `
${RESEARCH_DATA_PREAMBLE}${getBannerExtractionPrompt()}

IMAGES TO ANALYZE:
You have ${images.length} image(s) of the banner plan document to analyze.

PROCESSING REQUIREMENTS:
- Use your scratchpad to think through the group identification process
- Identify visual separators, merged headers, and logical groupings
- Create separate bannerCuts entries for each logical group
- Show your reasoning for group boundaries in the scratchpad
- Extract all columns with exact filter expressions

Begin analysis now.
`;

    // Check if this is an abort error
    const checkAbortError = (error: unknown): boolean => {
      return error instanceof DOMException && error.name === 'AbortError';
    };

    const maxAttempts = 10;

    // Wrap the AI call with retry logic for policy errors
    const retryResult = await retryWithPolicyHandling(
      async () => {
        // CRITICAL: Image format is different in Vercel AI SDK
        // OpenAI Agents SDK: { type: 'input_image', image: 'data:image/png;base64,...' }
        // Vercel AI SDK: { type: 'image', image: Buffer.from(base64, 'base64') }
        const { output, usage } = await generateText({
          model: getBannerModel(),  // Task-based: banner model for vision/extraction tasks
          system: systemPrompt,
          maxRetries: 0,  // Centralized outer retries via retryWithPolicyHandling
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze the banner plan images and extract column specifications with proper group separation.' },
                ...images.map(img => ({
                  type: 'image' as const,
                  image: Buffer.from(img.base64, 'base64'),
                  mimeType: `image/${img.format}` as const,
                })),
              ],
            },
          ],
          tools: {
            scratchpad: bannerScratchpadTool,
          },
          stopWhen: stepCountIs(15),  // AI SDK 5+: replaces maxTurns/maxSteps
          maxOutputTokens: Math.min(getBannerModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getBannerModelName()),
          // Configure reasoning effort and tool call ordering for Azure OpenAI GPT-5/o-series models
          providerOptions: {
            openai: {
              reasoningEffort: getBannerReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: BannerExtractionResultSchema,
          }),
          abortSignal,  // Pass abort signal to AI SDK
        });

        if (!output || !output.extractedStructure) {
          throw new Error('Invalid agent response structure');
        }

        // Record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'BannerAgent',
          getBannerModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          durationMs
        );

        return output;
      },
      {
        abortSignal,
        maxAttempts,
        onRetry: (attempt, err) => {
          // Check for abort errors and propagate them
          if (checkAbortError(err)) {
            throw err;
          }
          console.warn(`[BannerAgent] Retry ${attempt}/${maxAttempts} for banner extraction: ${err.message}`);
        },
      }
    );

    if (retryResult.success && retryResult.result) {
      console.log(`[BannerAgent] Agent extracted ${retryResult.result.extractedStructure.bannerCuts.length} groups`);
      return retryResult.result;
    }

    // Handle abort errors
    if (retryResult.error === 'Operation was cancelled') {
      console.log('[BannerAgent] Aborted by signal during AI extraction');
      throw new DOMException('BannerAgent aborted', 'AbortError');
    }

    // All retries failed - return structured failure result
    const errorMessage = retryResult.error || 'Unknown error';
    const retryContext = retryResult.wasPolicyError
      ? ` (failed after ${retryResult.attempts} retries due to content policy)`
      : '';
    console.error(`[BannerAgent] Extraction failed:`, errorMessage + retryContext);

    return {
      success: false,
      extractionType: 'banner_extraction',
      timestamp: new Date().toISOString(),
      extractedStructure: {
        bannerCuts: [],
        notes: [],
        statisticalLettersUsed: [],
      },
      errors: [errorMessage + retryContext],
      warnings: []
    };
  }

  // Step 1: DOC/DOCX → PDF conversion
  private async ensurePDF(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      return filePath;
    }

    if (ext === '.doc' || ext === '.docx') {
      return await this.convertDocToPDF(filePath);
    }

    throw new Error(`Unsupported file format: ${ext}. Only PDF, DOC, and DOCX files are supported.`);
  }

  /**
   * Convert DOC/DOCX to PDF using LibreOffice headless mode.
   *
   * This preserves all formatting (tables, colors, shading) so the model
   * sees the document exactly as the user sees it in Word.
   *
   * FUTURE CONSIDERATION: For cloud deployment, LibreOffice adds container complexity.
   * Alternative approach using mammoth.convertToHtml():
   *
   *   const result = await mammoth.convertToHtml({ path: docPath });
   *   // HTML preserves table structure with colspan for headers, <strong> for bold
   *   // Could either:
   *   //   1. Parse HTML programmatically (no AI needed for structure)
   *   //   2. Pass HTML directly to model as text input
   *   //
   * This would eliminate LibreOffice dependency but requires building parsing logic.
   * See conversation from Jan 3, 2026 for full discussion.
   */
  private async convertDocToPDF(docPath: string): Promise<string> {
    console.log(`[BannerAgent] Converting ${path.basename(docPath)} to PDF via LibreOffice`);

    try {
      // Verify input file exists and has content
      const inputStats = await fs.stat(docPath);
      console.log(`[BannerAgent] Input file: ${docPath} (${inputStats.size} bytes)`);
      if (inputStats.size === 0) {
        throw new Error('Input file is empty (0 bytes)');
      }

      // Use temp directory for PDF output (don't pollute source folder)
      const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'banner-pdf-'));
      const baseName = path.basename(docPath).replace(/\.(doc|docx)$/i, '.pdf');
      const pdfPath = path.join(outputDir, baseName);

      // Find LibreOffice in common locations
      const libreofficePaths = [
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',  // macOS
        '/usr/bin/libreoffice',                                   // Linux
        '/usr/bin/soffice',                                       // Linux alternative
        'libreoffice',                                            // In PATH
        'soffice',                                                // In PATH
      ];

      let libreofficeCommand: string | null = null;
      for (const loPath of libreofficePaths) {
        try {
          await execFileAsync(loPath, ['--version'], { timeout: 5000 });
          libreofficeCommand = loPath;
          console.log(`[BannerAgent] Found LibreOffice at: ${loPath}`);
          break;
        } catch {
          // Try next path
        }
      }

      if (!libreofficeCommand) {
        throw new Error(
          'LibreOffice not found. Please install LibreOffice:\n' +
          '  macOS: brew install --cask libreoffice\n' +
          '  Ubuntu: sudo apt install libreoffice\n' +
          'Or use the HTML extraction fallback (see code comments).'
        );
      }

      // Convert DOCX to PDF preserving formatting
      // Use isolated user installation to avoid profile conflicts in headless mode
      const userInstallation = `file://${outputDir}/lo-profile`;
      const loArgs = [
        `-env:UserInstallation=${userInstallation}`,
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', outputDir,
        docPath,
      ];
      console.log(`[BannerAgent] LibreOffice command: ${libreofficeCommand} ${loArgs.join(' ')}`);
      const { stdout, stderr } = await execFileAsync(libreofficeCommand, loArgs, { timeout: 30000 });

      if (stdout) {
        console.log(`[BannerAgent] LibreOffice stdout: ${stdout}`);
      }
      if (stderr && !stderr.includes('warn')) {
        console.warn(`[BannerAgent] LibreOffice stderr: ${stderr}`);
      }

      // List what was actually created in the output directory
      const dirContents = await fs.readdir(outputDir);
      console.log(`[BannerAgent] Output directory contents: ${dirContents.join(', ') || '(empty)'}`);
      console.log(`[BannerAgent] Expected PDF path: ${pdfPath}`);

      // Verify PDF was created - if exact name doesn't match, try to find any PDF
      try {
        await fs.access(pdfPath);
      } catch {
        // Try to find any PDF in the directory
        const pdfFiles = dirContents.filter(f => f.endsWith('.pdf'));
        if (pdfFiles.length > 0) {
          const actualPdfPath = path.join(outputDir, pdfFiles[0]);
          console.log(`[BannerAgent] Found PDF with different name: ${pdfFiles[0]}, using it instead`);
          return actualPdfPath;
        }
        throw new Error(`LibreOffice conversion completed but PDF file not found. Expected: ${baseName}, Directory contents: ${dirContents.join(', ') || '(empty)'}`);
      }

      console.log(`[BannerAgent] PDF created with formatting preserved: ${path.basename(pdfPath)}`);
      return pdfPath;

    } catch (error) {
      throw new Error(`DOC to PDF conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Step 2: PDF → Images conversion
  private async convertPDFToImages(pdfPath: string): Promise<ProcessedImage[]> {
    console.log(`[BannerAgent] Converting PDF to images: ${path.basename(pdfPath)}`);

    try {
      // Create temp directory for image conversion
      const tempDir = path.join(process.cwd(), 'temp-images');
      await fs.mkdir(tempDir, { recursive: true });

      // Get PDF page count first
      const pdfBuffer = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();

      const convert = pdf2pic.fromPath(pdfPath, {
        density: BANNER_CONFIG.imageDPI,
        saveFilename: 'page',
        savePath: tempDir,
        format: BANNER_CONFIG.imageFormat,
        width: BANNER_CONFIG.maxImageResolution,
        height: BANNER_CONFIG.maxImageResolution
      });

      // Convert each page individually (more reliable than bulk)
      const processedImages: ProcessedImage[] = [];

      for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        try {
          const result = await convert(pageNum);

          if (result && result.path) {
            // Read and optimize image
            const imageBuffer = await fs.readFile(result.path);
            const optimizedBuffer = await sharp(imageBuffer)
              .resize(BANNER_CONFIG.maxImageResolution, BANNER_CONFIG.maxImageResolution, {
                fit: 'inside',
                withoutEnlargement: true
              })
              .png({ quality: 90 })
              .toBuffer();

            const base64 = optimizedBuffer.toString('base64');
            const metadata = await sharp(optimizedBuffer).metadata();

            processedImages.push({
              pageNumber: pageNum,
              base64,
              width: metadata.width || 0,
              height: metadata.height || 0,
              format: BANNER_CONFIG.imageFormat
            });

            // Clean up temp file
            await fs.unlink(result.path);
          }
        } catch (pageError) {
          console.error(`[BannerAgent] Error converting page ${pageNum}:`, pageError);
          // Continue with other pages
        }
      }

      console.log(`[BannerAgent] Successfully converted ${processedImages.length}/${pageCount} pages`);

      // Clean up temp directory
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch (cleanupError) {
        console.warn(`[BannerAgent] Failed to clean up temp directory: ${cleanupError}`);
      }

      console.log(`[BannerAgent] Generated ${processedImages.length} optimized images`);
      return processedImages;

    } catch (error) {
      throw new Error(`PDF to images conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Derive processingMetadata from extracted structure (not AI-generated)
  private deriveProcessingMetadata(extractionResult: BannerExtractionResult) {
    const structure = extractionResult.extractedStructure;
    return {
      totalColumns: structure.bannerCuts.flatMap(g => g.columns).length,
      groupCount: structure.bannerCuts.length,
      statisticalLettersUsed: structure.statisticalLettersUsed,
      processingTimestamp: new Date().toISOString(),
    };
  }

  // Generate dual outputs (verbose + agent)
  private generateDualOutputs(extractionResult: BannerExtractionResult) {
    // Derive processingMetadata deterministically
    const processingMetadata = this.deriveProcessingMetadata(extractionResult);

    // Verbose output (full structure with derived metadata)
    const verbose: VerboseBannerPlan = {
      success: extractionResult.success,
      data: {
        ...extractionResult,
        extractedStructure: {
          ...extractionResult.extractedStructure,
          processingMetadata,
        },
      },
      timestamp: new Date().toISOString()
    };

    // Agent output (simplified structure)
    const agent: AgentBannerGroup[] = extractionResult.success
      ? extractionResult.extractedStructure.bannerCuts.map(group => ({
          groupName: group.groupName,
          columns: group.columns.map(col => ({
            name: col.name,
            original: col.original
          }))
        }))
      : [];

    return { verbose, agent };
  }

  // Calculate confidence score based on extraction results
  private calculateConfidence(result: BannerExtractionResult): number {
    if (!result.success || result.extractedStructure.bannerCuts.length === 0) {
      return 0.0;
    }

    const totalColumns = result.extractedStructure.bannerCuts
      .reduce((sum, group) => sum + group.columns.length, 0);
    const groupCount = result.extractedStructure.bannerCuts.length;

    let confidence = 0.75; // Base confidence
    if (groupCount === 1) confidence -= 0.15;     // 1 group is suspicious
    else if (groupCount >= 2) confidence += 0.15;  // 2+ groups = valid
    if (groupCount >= 4) confidence += 0.05;       // Small bonus for rich structure
    if (totalColumns >= 10) confidence += 0.05;    // Content volume bonus

    return Math.min(confidence, 1.0);
  }

  // Create failure result
  private createFailureResult(error: string): BannerProcessingResult {
    return {
      verbose: {
        success: false,
        data: {
          success: false,
          extractionType: 'banner_extraction',
          timestamp: new Date().toISOString(),
          extractedStructure: {
            bannerCuts: [],
            notes: [],
            processingMetadata: {
              totalColumns: 0,
              groupCount: 0,
              statisticalLettersUsed: [],
              processingTimestamp: new Date().toISOString(),
            },
          },
          errors: [error],
          warnings: []
        },
        timestamp: new Date().toISOString()
      },
      agent: [],
      success: false,
      confidence: 0.0,
      errors: [error],
      warnings: []
    };
  }

  // Save development outputs
  private async saveDevelopmentOutputs(
    dualOutputs: { verbose: VerboseBannerPlan; agent: AgentBannerGroup[] },
    originalFilePath: string,
    outputDir: string,
    scratchpadEntries?: Array<{ timestamp: string; action: string; content: string }>,
    images?: ProcessedImage[]
  ): Promise<void> {
    try {
      // Create per-agent output folder
      const bannerDir = path.join(outputDir, 'agents', 'banner');
      await fs.mkdir(bannerDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = path.basename(originalFilePath, path.extname(originalFilePath));

      // Save verbose output
      const verboseFilename = `banner-${baseName}-verbose-${timestamp}.json`;
      const verbosePath = path.join(bannerDir, verboseFilename);
      await fs.writeFile(verbosePath, JSON.stringify(dualOutputs.verbose, null, 2), 'utf-8');

      // Save agent output
      const agentFilename = `banner-${baseName}-agent-${timestamp}.json`;
      const agentPath = path.join(bannerDir, agentFilename);
      await fs.writeFile(agentPath, JSON.stringify(dualOutputs.agent, null, 2), 'utf-8');

      // Save raw output (complete model output - for golden dataset comparison)
      // This is the full extractedStructure: bannerCuts, notes, processingMetadata
      const rawOutput = dualOutputs.verbose.data.extractedStructure;
      const rawPath = path.join(bannerDir, 'banner-output-raw.json');
      await fs.writeFile(rawPath, JSON.stringify(rawOutput, null, 2), 'utf-8');

      // Save scratchpad trace as markdown
      if (scratchpadEntries) {
        const scratchpadFilename = `scratchpad-banner-${timestamp}.md`;
        const scratchpadPath = path.join(bannerDir, scratchpadFilename);
        const markdown = formatScratchpadAsMarkdown('BannerAgent', scratchpadEntries);
        await fs.writeFile(scratchpadPath, markdown, 'utf-8');
      }

      // Save images at root level (these are INPUTS, not agent outputs)
      if (images && images.length > 0) {
        const imagesDir = path.join(outputDir, 'banner-images');
        await fs.mkdir(imagesDir, { recursive: true });

        for (const img of images) {
          const imgFilename = `page-${img.pageNumber}.${img.format}`;
          const imgPath = path.join(imagesDir, imgFilename);
          const imgBuffer = Buffer.from(img.base64, 'base64');
          await fs.writeFile(imgPath, imgBuffer);
        }
        console.log(`[BannerAgent] Saved ${images.length} input images to banner-images/`);
      }

      console.log(`[BannerAgent] Development outputs saved to agents/banner/: ${verboseFilename}, ${agentFilename}`);
    } catch (error) {
      console.error('[BannerAgent] Failed to save development outputs:', error);
    }
  }
}
