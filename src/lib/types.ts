/**
 * Shared types
 * Purpose: Common environment, limits, and execution context types for agents and APIs
 */

/**
 * Reasoning effort levels supported by modern GPT-5/o-series reasoning models.
 * Exact availability varies by provider and model family, but the AI SDK accepts
 * this shared enum for current GPT-5-era chat models.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Per-agent reasoning effort configuration
 */
export interface AgentReasoningConfig {
  crosstabReasoningEffort: ReasoningEffort;
  bannerReasoningEffort: ReasoningEffort;
  bannerGenerateReasoningEffort: ReasoningEffort;
  verificationReasoningEffort: ReasoningEffort;
  skipLogicReasoningEffort: ReasoningEffort;
  filterTranslatorReasoningEffort: ReasoningEffort;
  loopSemanticsReasoningEffort: ReasoningEffort;
  aiGateReasoningEffort: ReasoningEffort;
  loopGateReasoningEffort: ReasoningEffort;
  subtypeGateReasoningEffort: ReasoningEffort;
  structureGateReasoningEffort: ReasoningEffort;
  surveyCleanupReasoningEffort: ReasoningEffort;
  tableContextReasoningEffort: ReasoningEffort;
  netEnrichmentReasoningEffort: ReasoningEffort;
}

/**
 * Global generation sampling parameters for output consistency.
 * Applied to all agents uniformly (not per-agent).
 *
 * Note: gpt-5-mini is a reasoning model that ignores temperature internally.
 * The seed parameter is the primary lever for reproducibility.
 * parallelToolCalls: false reduces non-deterministic tool call ordering.
 * We set temperature: 0 to document intent and safeguard non-reasoning models.
 */
export interface GenerationConfig {
  temperature: number;
  seed: number;
  parallelToolCalls: boolean;
}

export interface ProcessingLimits {
  maxDataMapVariables: number;
  maxBannerColumns: number;
  // Legacy token limits (for backward compatibility)
  reasoningModelTokens: number;
  baseModelTokens: number;
  // Per-agent token limits
  crosstabModelTokens: number;
  bannerModelTokens: number;
  bannerGenerateModelTokens: number;
  verificationModelTokens: number;
  skipLogicModelTokens: number;
  filterTranslatorModelTokens: number;
  loopSemanticsModelTokens: number;
  aiGateModelTokens: number;
  loopGateModelTokens: number;
  subtypeGateModelTokens: number;
  structureGateModelTokens: number;
  surveyCleanupModelTokens: number;
  tableContextModelTokens: number;
  netEnrichmentModelTokens: number;
}

export interface PromptVersions {
  crosstabPromptVersion: string;
  bannerPromptVersion: string;
  verificationPromptVersion: string;
  skipLogicPromptVersion: string;
  filterTranslatorPromptVersion: string;
  loopSemanticsPromptVersion: string;
  bannerGeneratePromptVersion: string;
  aiGatePromptVersion: string;
  loopGatePromptVersion: string;
  subtypeGatePromptVersion: string;
  structureGatePromptVersion: string;
  surveyCleanupPromptVersion: string;
  tableContextPromptVersion: string;
  netEnrichmentPromptVersion: string;
}

export type AIProvider = 'azure' | 'openai';

export interface EnvironmentConfig {
  // Provider selection
  aiProvider: AIProvider;  // 'azure' or 'openai' (default: 'azure')

  // Azure OpenAI (required when aiProvider === 'azure')
  azureApiKey: string;
  azureResourceName: string;
  azureApiVersion: string;  // e.g., '2024-10-21' for Azure AI Foundry

  // OpenAI API key (required when aiProvider === 'openai')
  openaiApiKey?: string;

  // Legacy model configuration (for backward compatibility)
  reasoningModel: string;  // e.g., 'o4-mini' - alias for crosstabModel
  baseModel: string;       // e.g., 'gpt-5-nano' - alias for bannerModel

  // Per-agent model configuration (deployment names for Azure, model IDs for OpenAI)
  crosstabModel: string;   // e.g., 'o4-mini' - used by CrosstabAgent (complex validation)
  bannerModel: string;     // e.g., 'gpt-5-nano' - used by BannerAgent (vision/extraction)
  bannerGenerateModel: string; // e.g., 'gpt-5-mini' - used by BannerGenerateAgent (text-based cut design)
  verificationModel: string; // e.g., 'gpt-5-mini' - used by VerificationAgent (survey enhancement)
  skipLogicModel: string;    // e.g., 'gpt-5-mini' - used by SkipLogicAgent (survey rule extraction)
  filterTranslatorModel: string; // e.g., 'o4-mini' - used by FilterTranslatorAgent (R expression translation)
  loopSemanticsModel: string;    // e.g., 'gpt-5-mini' - used by LoopSemanticsPolicyAgent (loop classification)
  aiGateModel: string;            // e.g., 'gpt-5-mini' - used by AIGateAgent (structural validation)
  loopGateModel: string;          // e.g., 'gpt-5-mini' - used by LoopGateAgent (loop false-positive detection)
  subtypeGateModel: string;       // e.g., 'gpt-5-mini' - used by SubtypeGateAgent (subtype confirmation gate)
  structureGateModel: string;     // e.g., 'gpt-5-mini' - used by StructureGateAgent (structure review gate)
  surveyCleanupModel: string;     // e.g., 'gpt-5-mini' - used by SurveyCleanupAgent (08b survey parse cleanup)
  tableContextModel: string;      // e.g., 'gpt-5-mini' - used by TableContextAgent (13e table context review)
  netEnrichmentModel: string;      // e.g., 'gpt-5-mini' - used by NETEnrichmentAgent (13e NET proposal)

  nodeEnv: 'development' | 'production';
  tracingEnabled: boolean;  // Renamed from tracingDisabled (positive naming)
  useQuestionCentric: boolean;  // USE_QUESTION_CENTRIC=true enables V2 question-centric agent paths
  promptVersions: PromptVersions;
  processingLimits: ProcessingLimits;
  reasoningConfig: AgentReasoningConfig;
  generationConfig: GenerationConfig;
}

export interface FileUploadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface ProcessingContext {
  sessionId: string;
  timestamp: string;
  environment: 'development' | 'production';
  model: string;
}

// Agent execution results
export interface AgentExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  context: ProcessingContext;
}
