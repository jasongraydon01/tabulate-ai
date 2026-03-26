import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { AgentDataMapItem } from './types';

export function buildAgentDataMapForCrosstab(
  agentRows: Array<{ Column: string; Description: string; Answer_Options: string }>,
  verboseDataMap: VerboseDataMapType[],
): AgentDataMapItem[] {
  const verboseByColumn = new Map(verboseDataMap.map(v => [v.column, v]));
  return agentRows.map(v => ({
    Column: v.Column,
    Description: v.Description,
    Answer_Options: v.Answer_Options,
    Type: verboseByColumn.get(v.Column)?.normalizedType || '',
  }));
}
