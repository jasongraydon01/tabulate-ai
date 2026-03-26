// Agent exports for CrossTab AI system
// Migrated to Vercel AI SDK + Azure OpenAI (Phase 1 complete)

// CrossTab Agent exports - Phase 6 Implementation
// NOTE: createCrosstabAgent REMOVED - no longer exists after migration to generateText()
export {
  processGroup,
  processAllGroups,
  processAllGroupsParallel,
  validateAgentResult,
  isValidAgentResult
} from './CrosstabAgent';

// Banner Agent exports (class-based)
export { BannerAgent } from './BannerAgent';
export type { BannerProcessingResult, ProcessedImage } from './BannerAgent';

// Tool exports
export { scratchpadTool } from './tools/scratchpad';

// Core types
export type { AgentExecutionResult } from '../lib/types';