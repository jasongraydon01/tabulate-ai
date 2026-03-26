import type { QExportFilter, QExportFilterTree, QExportManifest, QExportTable } from '@/lib/exportData/types';
import { NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE } from './runtimeContract';

export function emitQScript(manifest: QExportManifest): string {
  const lines: string[] = [];
  lines.push('// TabulateAI Q Export Script (Native QScript Contract — Variable-Only Filters)');
  lines.push(`// packageId: ${manifest.packageId}`);
  lines.push(`// exporterVersion: ${manifest.exporterVersion}`);
  lines.push(`// manifestVersion: ${manifest.manifestVersion}`);
  lines.push(`// runtimeContract: ${manifest.runtimeContract.contractVersion}`);
  lines.push(`// generatedAt: ${manifest.generatedAt}`);
  lines.push('');
  lines.push('if (typeof project === "undefined" || !project) {');
  lines.push('  throw new Error("Native QScript export requires global project object.");');
  lines.push('}');
  lines.push('if (typeof project.addDataFile !== "function") {');
  lines.push('  throw new Error("Native QScript export requires project.addDataFile API.");');
  lines.push('}');
  lines.push('if (!project.report || typeof project.report.appendTable !== "function") {');
  lines.push('  throw new Error("Native QScript export requires project.report.appendTable API.");');
  lines.push('}');
  lines.push('');
  lines.push('if (typeof log === "function") { log("HT_CHECKPOINT_START"); }');
  lines.push('');
  lines.push(...NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE.split('\n'));
  lines.push('');
  lines.push('var __htDataFiles = Object.create(null);');
  lines.push('var __htFilterVars = Object.create(null);');
  lines.push('var __htBannersByFrame = Object.create(null);');
  lines.push('var __htFrameCapabilities = Object.create(null);');
  lines.push('var __htFrameBindStrategies = Object.create(null);');
  lines.push('');

  // Data file loading
  const sortedJobs = [...manifest.jobs].sort((a, b) => a.jobId.localeCompare(b.jobId));
  for (const [index, job] of sortedJobs.entries()) {
    const jobVar = `__htDataFile_${index}`;
    lines.push(`// Job ${job.jobId} (${job.dataFrameRef})`);
    lines.push(`var ${jobVar} = project.addDataFile("${escapeString(toQScriptDataFilePath(job.packageDataFilePath))}");`);
    lines.push(`htAssert(${jobVar}, "Failed to import data file for ${escapeString(job.jobId)}.");`);
    lines.push(`__htDataFiles["${escapeString(job.dataFrameRef)}"] = ${jobVar};`);
    lines.push(`if (typeof log === "function") { log("HT_CHECKPOINT_DATAFILE:${escapeString(job.dataFrameRef)}"); }`);
    lines.push('');
  }

  // Runtime preflight: probe capabilities and select bind strategy per frame
  const framesRequiringTableFilterBinding = new Set(
    manifest.tables
      .filter((table) => table.additionalFilterId)
      .map((table) => table.dataFrameRef),
  );
  const uniqueFrames = [...new Set(sortedJobs.map((j) => j.dataFrameRef))].sort((a, b) => a.localeCompare(b));
  for (const [frameIndex, frame] of uniqueFrames.entries()) {
    const frameKey = escapeString(frame);
    const blockedReasonVar = `__htFrameBindBlockedReason_${frameIndex}`;
    lines.push(`// Frame preflight: ${frame}`);
    lines.push(`var ${blockedReasonVar} = null;`);
    lines.push(`__htFrameCapabilities["${frameKey}"] = htProbeRuntimeCapabilities(__htDataFiles["${frameKey}"], "${frameKey}");`);
    lines.push(`htAssert(__htFrameCapabilities["${frameKey}"].supportsNewRVariable, "Frame ${frameKey} does not support newRVariable — cannot create filter helper variables.");`);
    lines.push(`__htFrameBindStrategies["${frameKey}"] = htSelectTableFilterBindStrategy(__htDataFiles["${frameKey}"], "${frameKey}", __htFrameCapabilities["${frameKey}"]);`);
    if (framesRequiringTableFilterBinding.has(frame)) {
      lines.push(`if (!__htFrameBindStrategies["${frameKey}"]) { ${blockedReasonVar} = "no_supported_table_filter_bind_strategy"; }`);
      lines.push(`if (typeof log === "function") { log("HT_FRAME_BINDING_STRATEGY:" + JSON.stringify({ dataFrameRef: "${frameKey}", selectedBindPath: __htFrameBindStrategies["${frameKey}"], capabilities: __htFrameCapabilities["${frameKey}"], blockedReason: ${blockedReasonVar} })); }`);
    } else {
      lines.push(`if (typeof log === "function") { log("HT_FRAME_BINDING_STRATEGY:" + JSON.stringify({ dataFrameRef: "${frameKey}", selectedBindPath: __htFrameBindStrategies["${frameKey}"], capabilities: __htFrameCapabilities["${frameKey}"], blockedReason: null })); }`);
    }
    lines.push('');
  }
  lines.push('if (typeof log === "function") { log("HT_RUNTIME_BINDING_SUMMARY:" + JSON.stringify(__htFrameBindStrategies)); }');
  lines.push('');

  // Filter variable materialization (variable-only path)
  const sortedFilters = [...manifest.filters].sort((a, b) => a.filterId.localeCompare(b.filterId));
  for (const filter of sortedFilters) {
    const varName = `__htFilterVar_${hashLabel(filter.filterId).slice(0, 12)}`;
    lines.push(`// Filter variable: ${filter.filterId} (${filter.source})`);
    lines.push(`htAssert(__htDataFiles["${escapeString(filter.dataFrameRef)}"], "Missing data file for filter ${escapeString(filter.filterId)}.");`);
    lines.push(
      `var ${varName} = htPersistFilterVariable(__htDataFiles["${escapeString(filter.dataFrameRef)}"], ${serializeFilterTree(filter.filterTree)}, "${escapeString(filter.filterId)}", "${escapeString(filter.helperVarName)}", "${escapeString(filter.helperVarLabel)}");`,
    );
    lines.push(`htAssert(${varName}, "Failed to persist filter variable for ${escapeString(filter.filterId)}.");`);
    lines.push(`__htFilterVars["${escapeString(filter.filterId)}"] = ${varName};`);
    lines.push('');
  }
  lines.push(`if (typeof log === "function") { log("HT_CHECKPOINT_FILTERS_DONE:${sortedFilters.length}"); }`);
  lines.push('');

  // Banner construction (grouped: one Pick Any per group, composed via createBanner)
  // Build filter lookup for column label extraction in native groups
  const filterById = new Map(manifest.filters.map((f) => [f.filterId, f]));
  const sortedBannerPlans = [...manifest.bannerPlans].sort((a, b) => a.planId.localeCompare(b.planId));
  for (const [index, plan] of sortedBannerPlans.entries()) {
    const planVar = `__htBannerQuestion_${index}`;
    const groupsVar = `__htBannerGroups_${index}`;
    const frameKey = escapeString(plan.dataFrameRef);

    lines.push(`// Banner plan ${plan.planId} (${plan.groups.length} groups)`);
    lines.push(`htAssert(__htFrameCapabilities["${frameKey}"].supportsSetQuestionPickAny, "Frame ${frameKey} does not support setQuestion — cannot build banner.");`);
    lines.push(`htAssert(__htFrameCapabilities["${frameKey}"].supportsCreateBanner, "Frame ${frameKey} does not support createBanner — cannot build grouped banner.");`);
    lines.push(`htAssert(__htDataFiles["${frameKey}"], "Missing data file for banner plan ${escapeString(plan.planId)}.");`);

    // Assert all filter variables exist — every group gets them for synthetic fallback
    for (const group of plan.groups) {
      for (const filterId of group.filterIds) {
        lines.push(`htAssert(__htFilterVars["${escapeString(filterId)}"], "Missing filter variable ${escapeString(filterId)} for banner group ${escapeString(group.groupName)} in ${escapeString(plan.planId)}.");`);
      }
    }

    // Build groups array for htBuildGroupedBanner
    // Every group gets helperVariables (for synthetic path / fallback).
    // Native groups additionally get sourceQuestionName + columnLabels.
    lines.push(`var ${groupsVar} = [];`);
    for (const group of plan.groups) {
      const strategy = group.groupStrategy ?? 'synthetic_filter';
      const varsArray = group.filterIds.map((filterId) => `__htFilterVars["${escapeString(filterId)}"]`).join(', ');
      if (strategy === 'native_question' && group.sourceQuestionName) {
        const columnLabels = extractColumnLabelsForNativeGroup(group.filterIds, filterById);
        const columnLabelsJson = JSON.stringify(stableValue(columnLabels));
        lines.push(`${groupsVar}.push({ groupName: "${escapeString(group.groupName)}", groupStrategy: "native_question", sourceQuestionName: "${escapeString(group.sourceQuestionName)}", columnLabels: ${columnLabelsJson}, helperVariables: [${varsArray}] });`);
      } else {
        lines.push(`${groupsVar}.push({ groupName: "${escapeString(group.groupName)}", groupStrategy: "synthetic_filter", helperVariables: [${varsArray}] });`);
      }
    }

    lines.push(`var ${planVar} = htBuildGroupedBanner(__htDataFiles["${frameKey}"], "${escapeString(plan.bannerQuestionName)}", ${groupsVar}, "${escapeString(plan.planId)}");`);
    lines.push(`__htBannersByFrame["${frameKey}"] = ${planVar};`);
    lines.push('');
  }
  lines.push(`if (typeof log === "function") { log("HT_CHECKPOINT_BANNERS_DONE:${sortedBannerPlans.length}"); }`);
  lines.push('');

  // Table creation
  const emittedTables = [...manifest.tables];
  lines.push(`if (typeof log === "function") { log("HT_CHECKPOINT_TABLES_BEGIN:${emittedTables.length}"); }`);
  lines.push('');
  for (const [index, table] of emittedTables.entries()) {
    const tableVar = `__htTable_${index}`;
    const primaryVar = `__htPrimary_${index}`;
    const secondaryVar = `__htSecondary_${index}`;
    lines.push(`// Table ${table.tableId}`);
    lines.push(`if (typeof log === "function") { log("HT_CHECKPOINT_TABLE_START:${escapeString(table.tableId)}:${index + 1}/${emittedTables.length}"); }`);
    lines.push(`htAssert(__htDataFiles["${escapeString(table.dataFrameRef)}"], "Missing data file for table ${escapeString(table.tableId)}.");`);
    const effectiveStrategy = table.tableStrategy ?? 'synthetic_rows';
    if (effectiveStrategy !== 'synthetic_rows' && effectiveStrategy !== 'excluded') {
      // Native strategy: pass full table job to native handler
      const tableJob = serializeTableJob(table);
      lines.push(`var ${primaryVar} = htBuildNativeQuestionTable(__htDataFiles["${escapeString(table.dataFrameRef)}"], ${tableJob});`);
    } else {
      lines.push(`var ${primaryVar} = htBuildTablePrimaryFromRows(__htDataFiles["${escapeString(table.dataFrameRef)}"], "${escapeString(table.questionId)}", "${escapeString(table.tableId)}", ${serializeRowPlans(table.rows)}, "${escapeString(table.primaryStrategy)}");`);
    }
    lines.push(`var ${secondaryVar} = __htBannersByFrame["${escapeString(table.dataFrameRef)}"] || "SUMMARY";`);
    lines.push(`var ${tableVar} = project.report.appendTable();`);
    lines.push(`htAssert(${tableVar}, "Failed to append table ${escapeString(table.tableId)}.");`);
    lines.push(`${tableVar}.name = "${escapeString(table.tableId)}";`);
    lines.push(`${tableVar}.primary = ${primaryVar};`);
    lines.push(`${tableVar}.secondary = ${secondaryVar};`);
    if (table.additionalFilterId) {
      lines.push(`htAssert(__htFilterVars["${escapeString(table.additionalFilterId)}"], "Missing additional filter variable ${escapeString(table.additionalFilterId)} for table ${escapeString(table.tableId)}.");`);
      lines.push(`htAttachTableAdditionalFilter(${tableVar}, __htFilterVars["${escapeString(table.additionalFilterId)}"], __htDataFiles["${escapeString(table.dataFrameRef)}"], ${primaryVar}, "${escapeString(table.tableId)}", "${escapeString(table.additionalFilterId)}", __htFrameBindStrategies["${escapeString(table.dataFrameRef)}"] || "table_filters_variable");`);
    }
    lines.push(`htApplyTableHeaderMetadata(${tableVar}, "${escapeString(table.tableId)}", ${serializeRowPlans(table.headerRows)});`);
    lines.push(`if (typeof log === "function") { log("HT_CHECKPOINT_TABLE:${escapeString(table.tableId)}"); }`);
    lines.push('');
  }

  // Blocked items
  const blocked = [...manifest.blockedItems].sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (blocked.length > 0) {
    lines.push('// Blocked items (manual intervention required)');
    for (const item of blocked) {
      lines.push(`// - ${item.itemType}:${item.itemId} (${item.reasonCodes.join(', ')})`);
    }
    lines.push('');
  }

  lines.push('if (typeof log === "function") { log("HT_CHECKPOINT_DONE"); }');
  lines.push('// End of deterministic native QScript (variable-only filters)');

  return `${lines.join('\n')}\n`;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeFilterTree(tree: QExportFilterTree): string {
  return JSON.stringify(stableValue(tree));
}

function serializeRowPlans(rows: unknown[]): string {
  return JSON.stringify(stableValue(rows));
}

function serializeTableJob(table: QExportTable): string {
  const job = {
    tableId: table.tableId,
    questionId: table.questionId,
    tableStrategy: table.tableStrategy,
    sourceQuestionName: table.sourceQuestionName,
    primaryStrategy: table.primaryStrategy,
    rows: table.rows,
  };
  return JSON.stringify(stableValue(job));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function hashLabel(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function toQScriptDataFilePath(packageDataFilePath: string): string {
  const normalized = packageDataFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    return normalized;
  }
  if (normalized.startsWith('data/')) {
    return `../${normalized}`;
  }
  return normalized;
}

/**
 * Extract column labels for a native banner group from the filter trees.
 * Each filter in a native group is a simple equality/any_of on a single variable.
 * We extract the selected values and pair them with the filter's helperVarLabel
 * (which is the clean column name like "Cards", "PCPs", etc.).
 */
function extractColumnLabelsForNativeGroup(
  filterIds: string[],
  filterById: Map<string, QExportFilter>,
): Array<{ value: string | number; label: string }> {
  const labels: Array<{ value: string | number; label: string }> = [];

  for (const filterId of filterIds) {
    const filter = filterById.get(filterId);
    if (!filter || !filter.filterTree) continue;

    const values = extractTermValues(filter.filterTree);
    const label = filter.helperVarLabel;
    if (!label) continue;

    for (const value of values) {
      labels.push({ value, label });
    }
  }

  return labels;
}

/**
 * Extract selected values from a simple filter tree (term or OR of terms).
 */
function extractTermValues(tree: QExportFilter['filterTree']): Array<string | number> {
  if (!tree) return [];

  if (tree.type === 'term') {
    return tree.values.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
  }

  if (tree.type === 'or') {
    const values: Array<string | number> = [];
    for (const child of tree.children) {
      values.push(...extractTermValues(child));
    }
    return values;
  }

  return [];
}
