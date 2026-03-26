import { createHash } from 'crypto';

export const Q_EXPORT_RUNTIME_ENGINE = 'native-qscript' as const;
export const Q_EXPORT_RUNTIME_CONTRACT_VERSION = 'qscript-native.v8' as const;
export const Q_EXPORT_RUNTIME_MIN_Q_VERSION = '11.0.0' as const;

// This helper runtime is inlined into setup-project.QScript for deterministic offline execution.
// Variable-only filter architecture: all filters become 0/1 helper R variables.
// No dependency on createFilterTerm/newFilterQuestion for business filters.
export const NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE = `function htAssert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function htHashLabel(value) {
  var hash = 2166136261;
  var text = String(value || "");
  for (var i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function htSafeIdentifier(prefix, value, maxLength) {
  var normalized = String(value || "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    normalized = "x";
  }
  var candidate = prefix + "_" + normalized;
  if (candidate.length > maxLength) {
    candidate = prefix + "_" + htHashLabel(value);
  }
  return candidate;
}

function htStableValue(value) {
  if (Array.isArray(value)) {
    var mapped = [];
    for (var i = 0; i < value.length; i += 1) {
      mapped.push(htStableValue(value[i]));
    }
    return mapped;
  }
  if (value && typeof value === "object") {
    var keys = Object.keys(value).sort();
    var output = {};
    for (var j = 0; j < keys.length; j += 1) {
      var key = keys[j];
      var child = value[key];
      if (child !== undefined) {
        output[key] = htStableValue(child);
      }
    }
    return output;
  }
  return value;
}

function htStableStringify(value) {
  try {
    return JSON.stringify(htStableValue(value));
  } catch (_error) {
    return "";
  }
}

function htResolveQuestionOrVariable(dataFile, name, contextLabel) {
  var rawName = String(name || "");
  var trimmedName = rawName.replace(/^\\s+|\\s+$/g, "");
  var candidates = [];
  var pushCandidate = function (value) {
    if (!value) return;
    if (candidates.indexOf(value) === -1) candidates.push(value);
  };
  pushCandidate(rawName);
  pushCandidate(trimmedName);
  pushCandidate(trimmedName.toUpperCase());
  pushCandidate(trimmedName.toLowerCase());

  for (var i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    var question = null;
    if (typeof dataFile.getQuestionByName === "function") {
      try {
        question = dataFile.getQuestionByName(candidate);
      } catch (_errorQ) {
        question = null;
      }
    }
    if (question) {
      return question;
    }

    var variable = null;
    if (typeof dataFile.getVariableByName === "function") {
      try {
        variable = dataFile.getVariableByName(candidate);
      } catch (_errorV) {
        variable = null;
      }
    }
    if (variable) {
      return variable;
    }
  }
  throw new Error("Unable to resolve question/variable '" + rawName + "' for " + contextLabel + ". Tried: " + candidates.join(", "));
}

function htEscapeRegexLiteral(value) {
  return String(value || "").replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
}

function htGetVariablesByQuestionPrefix(dataFile, questionId) {
  if (typeof dataFile.getVariablesByName !== "function") {
    return [];
  }
  var rawId = String(questionId || "").replace(/^\\s+|\\s+$/g, "");
  if (!rawId) return [];
  var outputs = [];
  var seenNames = {};
  var namePattern = new RegExp("^" + htEscapeRegexLiteral(rawId) + "(?:$|[^0-9].*)", "i");
  var prefixes = [rawId, rawId + "r", rawId + "_"];
  for (var i = 0; i < prefixes.length; i += 1) {
    var prefix = prefixes[i];
    var vars = null;
    try {
      vars = dataFile.getVariablesByName(prefix);
    } catch (_errorVars) {
      vars = null;
    }
    if (!vars || !Array.isArray(vars)) continue;
    for (var j = 0; j < vars.length; j += 1) {
      var v = vars[j];
      var name = v && v.name ? String(v.name) : "";
      if (!name || !namePattern.test(name)) continue;
      if (seenNames[name]) continue;
      seenNames[name] = true;
      outputs.push(v);
    }
  }
  return outputs;
}

function htCopyVariablesForTable(dataFile, originalVars, tableId) {
  // Create independent copies of variables so each table owns its own set.
  // This prevents Q from "stealing" variables when setQuestion reassigns ownership.
  var copies = [];
  for (var i = 0; i < originalVars.length; i += 1) {
    var original = originalVars[i];
    var originalName = original && original.name ? String(original.name) : "";
    if (!originalName) continue;
    var copyName = htSafeIdentifier("HT_Var_" + String(tableId || "x"), originalName, 120);
    var copyLabel = original.label ? String(original.label) : originalName;
    try {
      dataFile.newRVariable(originalName, copyName, copyLabel, null);
      var copied = htReadVariableIfExists(dataFile, copyName);
      if (copied) {
        copies.push(copied);
      }
    } catch (_copyErr) {
      // If copy fails, skip this variable
      htLogDiag("HT_VAR_COPY_SKIP", { tableId: tableId, originalName: originalName, copyName: copyName, reason: _copyErr && _copyErr.message ? _copyErr.message : String(_copyErr) });
    }
  }
  return copies;
}

var __htSyntheticPrimaryCache = Object.create(null);

function htResolveTablePrimary(dataFile, questionId, tableId) {
  var diagnostics = {
    tableId: tableId,
    questionId: questionId,
    strategy: "direct_question_or_variable",
    matchedRef: null,
    fallbackCandidateCount: 0,
    blockedReason: null
  };
  try {
    var direct = htResolveQuestionOrVariable(dataFile, questionId, "table " + tableId + " primary");
    diagnostics.matchedRef = direct && direct.name ? String(direct.name) : String(questionId || "");
    htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
    return direct;
  } catch (directError) {
    // Check cache: reuse synthetic question if another table already created one for this questionId.
    // This prevents variable stealing — only one setQuestion call per unique questionId.
    if (__htSyntheticPrimaryCache[questionId]) {
      diagnostics.strategy = "synthetic_cached";
      diagnostics.matchedRef = __htSyntheticPrimaryCache[questionId].name ? String(__htSyntheticPrimaryCache[questionId].name) : String(questionId);
      htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
      return __htSyntheticPrimaryCache[questionId];
    }

    var fallbackVars = htGetVariablesByQuestionPrefix(dataFile, questionId);
    diagnostics.fallbackCandidateCount = fallbackVars.length;

    if (fallbackVars.length >= 2 && typeof dataFile.setQuestion === "function") {
      // Create ONE synthetic question per questionId and cache it.
      // Multiple tables sharing the same questionId reuse the same synthetic question,
      // avoiding variable stealing (only one setQuestion call per set of shared variables).
      // Using original variables (not copies) preserves their categorical metadata
      // (value labels, factor levels) which Q needs for valid table primaries.
      var synthName = htSafeIdentifier("HT_Primary", questionId || "x", 120);
      var synthTypes = ["Pick One - Multi", "Number - Multi", "Pick Any"];
      for (var i = 0; i < synthTypes.length; i += 1) {
        var synthType = synthTypes[i];
        try {
          var synthQuestion = dataFile.setQuestion(synthName, synthType, fallbackVars);
          if (synthQuestion) {
            __htSyntheticPrimaryCache[questionId] = synthQuestion;
            diagnostics.strategy = "synthetic_set_question";
            diagnostics.matchedRef = synthName;
            diagnostics.syntheticType = synthType;
            htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
            return synthQuestion;
          }
        } catch (_setQuestionError) {
          // try next synth type
        }
      }
    }

    if (fallbackVars.length >= 1) {
      diagnostics.strategy = "fallback_first_variable";
      diagnostics.matchedRef = fallbackVars[0] && fallbackVars[0].name ? String(fallbackVars[0].name) : null;
      htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
      return fallbackVars[0];
    }

    diagnostics.blockedReason = directError && directError.message ? directError.message : String(directError);
    htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
    throw directError;
  }
}

function htToComparableKey(value) {
  return String(value === null || value === undefined ? "" : value);
}

function htExtractFirstVariable(candidate) {
  if (!candidate) {
    return null;
  }
  if (candidate.name && !candidate.variables) {
    return candidate;
  }
  if (candidate.variables && Array.isArray(candidate.variables) && candidate.variables.length > 0) {
    return candidate.variables[0];
  }
  return null;
}

function htResolveVariableByName(dataFile, variableName, tableId, rowIndex) {
  var variable = htReadVariableIfExists(dataFile, variableName);
  if (variable) {
    return variable;
  }

  try {
    var candidate = htResolveQuestionOrVariable(dataFile, variableName, "table " + tableId + " row " + String(rowIndex) + " variable");
    return htExtractFirstVariable(candidate);
  } catch (_resolveError) {
    return null;
  }
}

function htApplyRowLabel(rowVariable, rowQuestion, rowPlan, tableId) {
  var effectiveLabel = rowPlan && rowPlan.effectiveLabel ? String(rowPlan.effectiveLabel) : "";
  var sourceLabel = rowPlan && rowPlan.sourceLabel ? String(rowPlan.sourceLabel) : null;
  var labelSource = rowPlan && rowPlan.labelSource ? String(rowPlan.labelSource) : "unknown";

  if (!effectiveLabel) {
    effectiveLabel = rowPlan && rowPlan.label ? String(rowPlan.label) : "";
  }

  if (effectiveLabel) {
    try {
      if (rowVariable) {
        rowVariable.label = effectiveLabel;
      }
    } catch (_varLabelErr) {
      // ignore label assignment failures in locked runtimes
    }
    try {
      if (rowQuestion) {
        rowQuestion.label = effectiveLabel;
      }
    } catch (_questionLabelErr) {
      // ignore label assignment failures in locked runtimes
    }
  }

  htLogDiag("HT_ROW_LABEL_DIAG", {
    tableId: tableId,
    rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
    variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
    strategy: rowPlan && rowPlan.strategy ? String(rowPlan.strategy) : null,
    sourceLabel: sourceLabel,
    effectiveLabel: effectiveLabel || null,
    labelSource: labelSource
  });
}

function htGetKnownValuesFromAttributes(valueAttributes) {
  if (!valueAttributes) {
    return [];
  }
  var seen = Object.create(null);
  var knownValues = [];

  var pushKnown = function (rawValue) {
    var value = htExtractComparableValue(rawValue);
    if (value === null || value === undefined) {
      return;
    }
    var key = htToComparableKey(value);
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    knownValues.push(value);
  };

  if (Array.isArray(valueAttributes.knownValues)) {
    for (var i = 0; i < valueAttributes.knownValues.length; i += 1) {
      pushKnown(valueAttributes.knownValues[i]);
    }
  }
  if (Array.isArray(valueAttributes.values)) {
    for (var j = 0; j < valueAttributes.values.length; j += 1) {
      pushKnown(valueAttributes.values[j]);
    }
  }
  if (typeof valueAttributes.getValues === "function") {
    try {
      var values = valueAttributes.getValues();
      if (Array.isArray(values)) {
        for (var k = 0; k < values.length; k += 1) {
          pushKnown(values[k]);
        }
      }
    } catch (_getValuesErr) {
      // ignore
    }
  }
  return knownValues;
}

function htExtractComparableValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return rawValue;
  }
  if (typeof rawValue !== "object") {
    return rawValue;
  }

  var keys = ["value", "Value", "code", "Code", "id", "Id", "name", "Name"];
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(rawValue, key)) {
      continue;
    }
    var candidate = rawValue[key];
    if (
      candidate === null
      || candidate === undefined
      || typeof candidate === "string"
      || typeof candidate === "number"
      || typeof candidate === "boolean"
    ) {
      return candidate;
    }
  }
  return null;
}

function htCollectKnownValuesFromRowContext(rowContext) {
  var seen = Object.create(null);
  var values = [];
  var pushValue = function (rawValue) {
    var value = htExtractComparableValue(rawValue);
    if (value === null || value === undefined) {
      return;
    }
    var key = htToComparableKey(value);
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    values.push(value);
  };

  var collectFromCandidate = function (candidate) {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    if (candidate.valueAttributes) {
      var fromAttributes = htGetKnownValuesFromAttributes(candidate.valueAttributes);
      for (var i = 0; i < fromAttributes.length; i += 1) {
        pushValue(fromAttributes[i]);
      }
    }
    if (candidate.question && candidate.question.valueAttributes) {
      var fromQuestionAttributes = htGetKnownValuesFromAttributes(candidate.question.valueAttributes);
      for (var j = 0; j < fromQuestionAttributes.length; j += 1) {
        pushValue(fromQuestionAttributes[j]);
      }
    }
    if (Array.isArray(candidate.values)) {
      for (var k = 0; k < candidate.values.length; k += 1) {
        pushValue(candidate.values[k]);
      }
    }
  };

  collectFromCandidate(rowContext && rowContext.duplicatedQuestion ? rowContext.duplicatedQuestion : null);
  collectFromCandidate(rowContext && rowContext.duplicatedVariable ? rowContext.duplicatedVariable : null);
  collectFromCandidate(rowContext && rowContext.duplicatedResult ? rowContext.duplicatedResult : null);
  collectFromCandidate(rowContext && rowContext.sourceQuestion ? rowContext.sourceQuestion : null);
  collectFromCandidate(rowContext && rowContext.sourceVariable ? rowContext.sourceVariable : null);

  return values;
}

function htResolvePreferredValueAttributes(rowContext) {
  var candidates = [
    rowContext && rowContext.duplicatedQuestion ? rowContext.duplicatedQuestion.valueAttributes : null,
    rowContext && rowContext.duplicatedVariable ? rowContext.duplicatedVariable.valueAttributes : null,
    rowContext && rowContext.duplicatedVariable && rowContext.duplicatedVariable.question
      ? rowContext.duplicatedVariable.question.valueAttributes
      : null,
    rowContext && rowContext.duplicatedResult ? rowContext.duplicatedResult.valueAttributes : null,
    rowContext && rowContext.sourceQuestion ? rowContext.sourceQuestion.valueAttributes : null,
    rowContext && rowContext.sourceVariable ? rowContext.sourceVariable.valueAttributes : null
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    if (candidate && typeof candidate.setCountThisValue === "function") {
      return candidate;
    }
  }
  return null;
}

function htApplyRowCountThisValue(valueAttributes, selectedValues, options) {
  var selected = Array.isArray(selectedValues) ? selectedValues : [];
  var context = options || {};
  var diagnostics = {
    tableId: context.tableId || null,
    rowIndex: context.rowPlan && context.rowPlan.rowIndex !== undefined ? context.rowPlan.rowIndex : null,
    variable: context.rowPlan && context.rowPlan.variable ? String(context.rowPlan.variable) : null,
    strategy: context.rowPlan && context.rowPlan.strategy ? String(context.rowPlan.strategy) : null,
    phase: context.phase || "initial",
    selectedCount: selected.length,
    resolvedCount: 0,
    knownValueCount: 0,
    applied: false,
    appliedCount: 0,
    reasonCode: null,
    fallbackUsed: context.fallbackUsed === true
  };

  if (selected.length === 0) {
    diagnostics.applied = true;
    diagnostics.reasonCode = "no_selected_values";
    htLogDiag("HT_ROW_COUNT_THIS_VALUE_DIAG", diagnostics);
    return diagnostics;
  }

  if (!valueAttributes || typeof valueAttributes.setCountThisValue !== "function") {
    diagnostics.reasonCode = "missing_set_count_this_value";
    htLogDiag("HT_ROW_COUNT_THIS_VALUE_DIAG", diagnostics);
    return diagnostics;
  }

  var selectedKeys = Object.create(null);
  for (var i = 0; i < selected.length; i += 1) {
    selectedKeys[htToComparableKey(selected[i])] = true;
  }

  var knownValues = Array.isArray(context.knownValues)
    ? context.knownValues.slice()
    : htGetKnownValuesFromAttributes(valueAttributes);
  diagnostics.knownValueCount = knownValues.length;

  var resolvedSelected = [];
  if (knownValues.length > 0) {
    for (var j = 0; j < knownValues.length; j += 1) {
      var known = knownValues[j];
      if (selectedKeys[htToComparableKey(known)]) {
        resolvedSelected.push(known);
      }
    }
    if (resolvedSelected.length === 0) {
      diagnostics.reasonCode = "no_matching_known_values";
      htLogDiag("HT_ROW_COUNT_THIS_VALUE_DIAG", diagnostics);
      return diagnostics;
    }
  } else {
    resolvedSelected = selected.slice();
  }
  diagnostics.resolvedCount = resolvedSelected.length;

  var resetValues = knownValues.length > 0 ? knownValues : resolvedSelected;
  for (var k = 0; k < resetValues.length; k += 1) {
    var knownValue = resetValues[k];
    try {
      valueAttributes.setCountThisValue(knownValue, false);
    } catch (_resetErr) {
      // ignore reset failures for unsupported values
    }
  }

  var appliedCount = 0;
  for (var m = 0; m < resolvedSelected.length; m += 1) {
    var setVariants = htExpandCountThisValueCandidates(resolvedSelected[m]);
    var setApplied = false;
    for (var sv = 0; sv < setVariants.length; sv += 1) {
      try {
        valueAttributes.setCountThisValue(setVariants[sv], true);
        setApplied = true;
        break;
      } catch (_setErr) {
        // try next variant
      }
    }
    if (setApplied) {
      appliedCount += 1;
    }
  }
  diagnostics.appliedCount = appliedCount;
  diagnostics.applied = appliedCount === resolvedSelected.length && resolvedSelected.length > 0;
  if (!diagnostics.applied) {
    diagnostics.reasonCode = appliedCount === 0
      ? "set_count_this_value_failed"
      : "partial_set_count_this_value";
  }
  htLogDiag("HT_ROW_COUNT_THIS_VALUE_DIAG", diagnostics);
  return diagnostics;
}

function htExpandCountThisValueCandidates(value) {
  var candidates = [];
  var seen = Object.create(null);
  var pushCandidate = function (candidate) {
    if (candidate === null || candidate === undefined) {
      return;
    }
    var key = htToComparableKey(candidate);
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    candidates.push(candidate);
  };

  pushCandidate(value);
  var asText = String(value);
  pushCandidate(asText);
  if (/^-?\d+(?:\.\d+)?$/.test(asText)) {
    pushCandidate(Number(asText));
  }
  return candidates;
}

function htEnsureCategoricalVariableType(variable) {
  try {
    if (
      variable
      && typeof variable === "object"
      && Object.prototype.hasOwnProperty.call(variable, "variableType")
      && variable.variableType !== "Categorical"
    ) {
      variable.variableType = "Categorical";
    }
  } catch (_error) {
    // ignore if runtime locks this property
  }
}

function htEnsureRowQuestionForCountThisValue(dataFile, rowVariable, rowPlan, tableId) {
  if (!rowVariable) {
    return null;
  }
  var currentQuestion = rowVariable.question || null;
  var currentAttributes = currentQuestion && currentQuestion.valueAttributes ? currentQuestion.valueAttributes : null;
  if (currentAttributes && typeof currentAttributes.setCountThisValue === "function") {
    return currentQuestion;
  }
  if (typeof dataFile.setQuestion !== "function") {
    return currentQuestion;
  }

  var rowQuestionName = htSafeIdentifier(
    "HT_Row",
    String(tableId || "x") + "_" + String(rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : "x"),
    120
  );
  try {
    var rowQuestion = dataFile.setQuestion(rowQuestionName, "Pick Any", [rowVariable]);
    htLogDiag("HT_ROW_COUNT_CONTEXT_DIAG", {
      tableId: tableId,
      rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
      variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
      applied: !!rowQuestion,
      reasonCode: rowQuestion ? "created_pick_any_row_context" : "set_question_returned_null"
    });
    return rowQuestion || currentQuestion;
  } catch (error) {
    htLogDiag("HT_ROW_COUNT_CONTEXT_DIAG", {
      tableId: tableId,
      rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
      variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
      applied: false,
      reasonCode: "set_question_pick_any_failed",
      blockedReason: error && error.message ? error.message : String(error)
    });
    return currentQuestion;
  }
}

function htToRVariableRef(variableName) {
  var trimmed = String(variableName || "").replace(/^\\s+|\\s+$/g, "");
  var tick = String.fromCharCode(96);
  var escaped = trimmed.split(tick).join(String.fromCharCode(92) + tick);
  return tick + escaped + tick;
}

function htBuildSelectedValuesExpression(variableName, selectedValues) {
  var selected = Array.isArray(selectedValues) ? selectedValues : [];
  if (selected.length === 0) {
    return null;
  }
  var ref = htToRVariableRef(variableName);
  var comparisons = [];
  for (var i = 0; i < selected.length; i += 1) {
    var value = selected[i];
    if (typeof value === "number") {
      comparisons.push("(as.numeric(" + ref + ") == " + String(value) + ")");
    } else {
      comparisons.push("(as.character(" + ref + ") == " + JSON.stringify(String(value)) + ")");
    }
  }
  return "(!is.na(" + ref + ") & (" + comparisons.join(" | ") + "))";
}

function htTryMaterializeCountFallbackRowVariable(dataFile, rowPlan, tableId, reasonCode) {
  var fallbackExpression = rowPlan && rowPlan.syntheticExpression
    ? String(rowPlan.syntheticExpression)
    : htBuildSelectedValuesExpression(rowPlan && rowPlan.variable ? rowPlan.variable : "", rowPlan && rowPlan.selectedValues ? rowPlan.selectedValues : []);

  if (!fallbackExpression) {
    htLogDiag("HT_ROW_COUNT_FALLBACK_DIAG", {
      tableId: tableId,
      rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
      variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
      fallbackUsed: false,
      reasonCode: reasonCode || "count_this_value_failed",
      fallbackReasonCode: "missing_fallback_expression"
    });
    return null;
  }

  var fallbackPlan = {};
  for (var key in rowPlan) {
    if (Object.prototype.hasOwnProperty.call(rowPlan, key)) {
      fallbackPlan[key] = rowPlan[key];
    }
  }
  fallbackPlan.strategy = "synthetic_expression";
  fallbackPlan.strategyReason = "count_this_value_fallback";
  fallbackPlan.syntheticExpression = fallbackExpression;
  fallbackPlan.selectedValues = [];

  try {
    var fallbackVariable = htMaterializeSyntheticRowVariable(dataFile, fallbackPlan, tableId);
    htLogDiag("HT_ROW_COUNT_FALLBACK_DIAG", {
      tableId: tableId,
      rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
      variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
      fallbackUsed: !!fallbackVariable,
      reasonCode: reasonCode || "count_this_value_failed",
      fallbackReasonCode: "synthetic_expression_fallback"
    });
    return fallbackVariable;
  } catch (error) {
    htLogDiag("HT_ROW_COUNT_FALLBACK_DIAG", {
      tableId: tableId,
      rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
      variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
      fallbackUsed: false,
      reasonCode: reasonCode || "count_this_value_failed",
      fallbackReasonCode: "synthetic_expression_fallback_failed",
      blockedReason: error && error.message ? error.message : String(error)
    });
    return null;
  }
}

function htMaterializeDuplicateRowVariable(dataFile, rowPlan, tableId) {
  var sourceVariable = htResolveVariableByName(dataFile, rowPlan.variable, tableId, rowPlan.rowIndex);
  if (!sourceVariable) {
    throw new Error("Unable to resolve source variable '" + String(rowPlan.variable || "") + "' for table " + tableId + " row " + String(rowPlan.rowIndex));
  }
  if (typeof sourceVariable.duplicate !== "function") {
    throw new Error("Source variable '" + String(rowPlan.variable || "") + "' does not support duplicate() in table " + tableId);
  }

  var duplicated = sourceVariable.duplicate();
  var duplicatedVariable = htExtractFirstVariable(duplicated);
  if (!duplicatedVariable) {
    throw new Error("Variable duplicate() returned no variable for " + String(rowPlan.variable || "") + " in table " + tableId);
  }
  htEnsureCategoricalVariableType(duplicatedVariable);
  var duplicatedQuestion = htEnsureRowQuestionForCountThisValue(dataFile, duplicatedVariable, rowPlan, tableId)
    || duplicatedVariable.question
    || (duplicated && duplicated.valueAttributes ? duplicated : null);
  var rowContext = {
    sourceVariable: sourceVariable,
    sourceQuestion: sourceVariable.question || null,
    duplicatedVariable: duplicatedVariable,
    duplicatedQuestion: duplicatedQuestion,
    duplicatedResult: duplicated
  };
  var valueAttributes = htResolvePreferredValueAttributes(rowContext);
  var knownValues = htCollectKnownValuesFromRowContext(rowContext);
  var countResult = htApplyRowCountThisValue(valueAttributes, rowPlan.selectedValues, {
    tableId: tableId,
    rowPlan: rowPlan,
    phase: "pre_compose",
    knownValues: knownValues,
    fallbackUsed: false
  });
  if (Array.isArray(rowPlan.selectedValues) && rowPlan.selectedValues.length > 0 && !countResult.applied) {
    throw new Error("count_this_value_not_applied:" + String(countResult.reasonCode || "unknown"));
  }
  htApplyRowLabel(duplicatedVariable, duplicatedQuestion, rowPlan, tableId);
  return {
    rowVariable: duplicatedVariable,
    rowPlan: rowPlan,
    countReassert: Array.isArray(rowPlan.selectedValues) && rowPlan.selectedValues.length > 0
      ? {
        selectedValues: rowPlan.selectedValues.slice(),
        knownValues: knownValues
      }
      : null
  };
}

function htMaterializeDirectSourceRowVariable(dataFile, rowPlan, tableId) {
  var sourceVariable = htResolveVariableByName(dataFile, rowPlan.variable, tableId, rowPlan.rowIndex);
  if (!sourceVariable) {
    throw new Error("Unable to resolve source variable '" + String(rowPlan.variable || "") + "' for table " + tableId + " row " + String(rowPlan.rowIndex));
  }

  var rowVariable = sourceVariable;
  if (typeof sourceVariable.duplicate === "function") {
    var duplicated = sourceVariable.duplicate();
    var duplicatedVariable = htExtractFirstVariable(duplicated);
    if (duplicatedVariable) {
      rowVariable = duplicatedVariable;
    }
  }

  htApplyRowLabel(rowVariable, rowVariable.question || null, rowPlan, tableId);
  htEnsureNumericVariableType(rowVariable);
  return {
    rowVariable: rowVariable,
    rowPlan: rowPlan,
    countReassert: null
  };
}

function htMaterializeSyntheticRowVariable(dataFile, rowPlan, tableId) {
  var syntheticExpression = rowPlan && rowPlan.syntheticExpression
    ? String(rowPlan.syntheticExpression)
    : "";
  htAssert(syntheticExpression.length > 0, "Missing synthetic expression for table " + tableId + " row " + String(rowPlan.rowIndex));

  var helperName = htSafeIdentifier(
    "HT_Row_" + String(tableId || "x"),
    String(rowPlan.variable || "row") + "_" + String(rowPlan.rowIndex || 0),
    120
  );
  var helperLabel = rowPlan && rowPlan.effectiveLabel
    ? String(rowPlan.effectiveLabel)
    : (rowPlan && rowPlan.label ? String(rowPlan.label) : String(rowPlan.variable || helperName));
  var expression = "ifelse(" + syntheticExpression + ", 1, 0)";
  var helperQuestionName = htSafeIdentifier(
    "HT_RowQ_" + String(tableId || "x"),
    String(rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : 0) + "_" + String(rowPlan.variable || "row"),
    120
  );
  var created = false;
  var createErrors = [];
  var createAttempts = [
    function () { dataFile.newRVariable(expression, helperName, helperLabel, null); },
    function () { dataFile.newRVariable(expression, helperName, helperQuestionName, helperLabel); },
    function () { dataFile.newRVariable(expression, helperName, helperQuestionName, null); },
  ];
  for (var ca = 0; ca < createAttempts.length; ca += 1) {
    try {
      createAttempts[ca]();
      created = true;
      break;
    } catch (createErr) {
      createErrors.push(createErr && createErr.message ? createErr.message : String(createErr));
    }
  }
  if (!created) {
    throw new Error("new_r_variable_failed:" + createErrors.join(" | "));
  }

  var helperVariable = htReadVariableIfExists(dataFile, helperName);
  htAssert(helperVariable, "Failed to create synthetic row helper '" + helperName + "' for table " + tableId);
  htApplyRowLabel(helperVariable, helperVariable.question || null, rowPlan, tableId);
  htEnsureCategoricalVariableType(helperVariable);
  return helperVariable;
}

function htComposeTablePrimaryQuestion(dataFile, primaryName, questionTypes, rowVariables) {
  for (var i = 0; i < questionTypes.length; i += 1) {
    try {
      var questionType = questionTypes[i];
      var primaryQuestion = dataFile.setQuestion(primaryName, questionType, rowVariables);
      if (primaryQuestion) {
        return {
          primaryQuestion: primaryQuestion,
          questionType: questionType
        };
      }
    } catch (_setQuestionErr) {
      // try next question type
    }
  }
  return null;
}

function htReassertRowCountThisValue(rowStates, tableId, phase) {
  var failedRows = [];
  for (var i = 0; i < rowStates.length; i += 1) {
    var rowState = rowStates[i];
    if (!rowState || !rowState.countReassert || !rowState.rowPlan) {
      continue;
    }
    var selectedValues = Array.isArray(rowState.countReassert.selectedValues)
      ? rowState.countReassert.selectedValues
      : [];
    if (selectedValues.length === 0) {
      continue;
    }
    var rowContext = {
      sourceVariable: null,
      sourceQuestion: null,
      duplicatedVariable: rowState.rowVariable,
      duplicatedQuestion: rowState.rowVariable && rowState.rowVariable.question ? rowState.rowVariable.question : null,
      duplicatedResult: null
    };
    var valueAttributes = htResolvePreferredValueAttributes(rowContext);
    var fallbackKnown = Array.isArray(rowState.countReassert.knownValues)
      ? rowState.countReassert.knownValues
      : [];
    var knownValues = fallbackKnown.length > 0
      ? fallbackKnown
      : htCollectKnownValuesFromRowContext(rowContext);
    var result = htApplyRowCountThisValue(valueAttributes, selectedValues, {
      tableId: tableId,
      rowPlan: rowState.rowPlan,
      phase: phase,
      knownValues: knownValues,
      fallbackUsed: false
    });
    if (!result.applied) {
      failedRows.push({
        rowState: rowState,
        reasonCode: result.reasonCode || "count_this_value_not_applied"
      });
    }
  }
  return failedRows;
}

function htBuildTablePrimaryFromRows(dataFile, questionId, tableId, rowPlans, primaryStrategy) {
  var resolvedPrimaryStrategy = primaryStrategy === "numeric_row_plan_primary"
    ? "numeric_row_plan_primary"
    : "row_plan_primary";
  var diagnostics = {
    tableId: tableId,
    questionId: questionId,
    strategy: resolvedPrimaryStrategy,
    totalRows: Array.isArray(rowPlans) ? rowPlans.length : 0,
    builtRows: 0,
    blockedRows: 0,
    fallbackRows: 0,
    fallbackStrategy: null,
    blockedReason: null
  };
  try {
    if (!Array.isArray(rowPlans) || rowPlans.length === 0) {
      diagnostics.fallbackStrategy = "resolve_direct_primary";
      var fallbackPrimary = htResolveQuestionOrVariable(dataFile, questionId, "table " + tableId + " primary fallback");
      htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
      return fallbackPrimary;
    }

    var rowStates = [];
    for (var i = 0; i < rowPlans.length; i += 1) {
      var rowPlan = rowPlans[i];
      if (!rowPlan || rowPlan.strategy === "blocked" || rowPlan.variable === "_CAT_") {
        diagnostics.blockedRows += 1;
        continue;
      }
      if (!rowPlan.variable) {
        diagnostics.blockedRows += 1;
        continue;
      }

      var rowState = null;
      try {
        if (rowPlan.strategy === "duplicate_value_attributes") {
          rowState = htMaterializeDuplicateRowVariable(dataFile, rowPlan, tableId);
        } else if (rowPlan.strategy === "synthetic_expression") {
          rowState = {
            rowVariable: htMaterializeSyntheticRowVariable(dataFile, rowPlan, tableId),
            rowPlan: rowPlan,
            countReassert: null
          };
        } else if (rowPlan.strategy === "direct_source_variable") {
          rowState = htMaterializeDirectSourceRowVariable(dataFile, rowPlan, tableId);
        } else {
          diagnostics.blockedRows += 1;
          continue;
        }
      } catch (rowError) {
        var fallbackRow = null;
        var rowErrorMessage = rowError && rowError.message ? rowError.message : String(rowError);
        var fallbackReasonCode = String(rowErrorMessage || "").replace(/^count_this_value_not_applied:/, "");
        if (
          rowPlan
          && rowPlan.strategy === "duplicate_value_attributes"
          && Array.isArray(rowPlan.selectedValues)
          && rowPlan.selectedValues.length > 0
        ) {
          fallbackRow = htTryMaterializeCountFallbackRowVariable(
            dataFile,
            rowPlan,
            tableId,
            fallbackReasonCode || "count_this_value_not_applied"
          );
        }

        if (fallbackRow) {
          rowState = {
            rowVariable: fallbackRow,
            rowPlan: rowPlan,
            countReassert: null
          };
          diagnostics.fallbackRows += 1;
          htLogDiag("HT_ROW_PRIMARY_BUILD_DIAG", {
            tableId: tableId,
            rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
            variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
            strategy: rowPlan && rowPlan.strategy ? String(rowPlan.strategy) : null,
            fallbackUsed: true,
            reasonCode: fallbackReasonCode || "count_this_value_not_applied"
          });
        } else {
          diagnostics.blockedRows += 1;
          htLogDiag("HT_ROW_PRIMARY_BUILD_DIAG", {
            tableId: tableId,
            rowIndex: rowPlan && rowPlan.rowIndex !== undefined ? rowPlan.rowIndex : null,
            variable: rowPlan && rowPlan.variable ? String(rowPlan.variable) : null,
            strategy: rowPlan && rowPlan.strategy ? String(rowPlan.strategy) : null,
            fallbackUsed: false,
            reasonCode: fallbackReasonCode || "row_materialization_failed",
            blockedReason: rowErrorMessage
          });
          continue;
        }
      }

      if (rowState && rowState.rowVariable) {
        rowStates.push(rowState);
        diagnostics.builtRows += 1;
      } else {
        diagnostics.blockedRows += 1;
      }
    }

    if (rowStates.length === 0) {
      diagnostics.fallbackStrategy = "resolve_direct_primary_no_rows";
      var fallbackNoRows = htResolveQuestionOrVariable(dataFile, questionId, "table " + tableId + " primary fallback");
      htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
      return fallbackNoRows;
    }

    htAssert(typeof dataFile.setQuestion === "function", "Data file does not support setQuestion for table " + tableId);
    var primaryName = htSafeIdentifier("HT_Primary", tableId || questionId || "x", 120);
    var rowVariables = [];
    for (var rv = 0; rv < rowStates.length; rv += 1) {
      rowVariables.push(rowStates[rv].rowVariable);
    }

    var questionTypes = resolvedPrimaryStrategy === "numeric_row_plan_primary"
      ? ["Number - Multi", "Pick One - Multi", "Pick Any"]
      : ["Pick Any", "Pick One - Multi", "Number - Multi"];
    var composed = htComposeTablePrimaryQuestion(dataFile, primaryName, questionTypes, rowVariables);
    if (composed && composed.primaryQuestion) {
      diagnostics.syntheticType = composed.questionType;

      var postComposeFailures = htReassertRowCountThisValue(rowStates, tableId, "post_compose");
      if (postComposeFailures.length > 0) {
        var recomposedCount = 0;
        for (var pf = 0; pf < postComposeFailures.length; pf += 1) {
          var failed = postComposeFailures[pf];
          var fallbackVariable = htTryMaterializeCountFallbackRowVariable(
            dataFile,
            failed.rowState.rowPlan,
            tableId,
            failed.reasonCode
          );
          if (!fallbackVariable) {
            continue;
          }
          failed.rowState.rowVariable = fallbackVariable;
          failed.rowState.countReassert = null;
          recomposedCount += 1;
          diagnostics.fallbackRows += 1;
        }

        if (recomposedCount > 0) {
          var recomposedVariables = [];
          for (var rv2 = 0; rv2 < rowStates.length; rv2 += 1) {
            recomposedVariables.push(rowStates[rv2].rowVariable);
          }
          var recomposedPrimary = htComposeTablePrimaryQuestion(dataFile, primaryName, questionTypes, recomposedVariables);
          if (recomposedPrimary && recomposedPrimary.primaryQuestion) {
            composed = recomposedPrimary;
            diagnostics.syntheticType = recomposedPrimary.questionType;
            postComposeFailures = htReassertRowCountThisValue(rowStates, tableId, "post_compose_recompose");
          }
        }
      }

      if (postComposeFailures.length > 0) {
        diagnostics.blockedReason = "count_this_value_post_compose_failure";
        diagnostics.fallbackStrategy = "first_row_variable_after_count_failure";
        htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
        return rowStates[0].rowVariable;
      }

      htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
      return composed.primaryQuestion;
    }

    diagnostics.fallbackStrategy = "first_row_variable";
    htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
    return rowStates[0].rowVariable;
  } catch (error) {
    diagnostics.blockedReason = error && error.message ? error.message : String(error);
    htLogDiag("HT_TABLE_PRIMARY_DIAG", diagnostics);
    throw error;
  }
}

function htReadVariableIfExists(dataFile, name) {
  if (typeof dataFile.getVariableByName !== "function") {
    return null;
  }
  try {
    return dataFile.getVariableByName(name) || null;
  } catch (_error) {
    return null;
  }
}

function htToRLiteral(value) {
  if (value === null || value === undefined) {
    return "NA";
  }
  if (typeof value === "number") {
    if (!isFinite(value)) {
      throw new Error("unsupported_non_finite_literal");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return JSON.stringify(String(value));
}

function htCompileTermNodeToBooleanExpression(node, filterId) {
  htAssert(node && typeof node.leftRef === "string" && node.leftRef.length > 0, "Invalid term.leftRef for " + filterId);
  var leftRef = node.leftRef;
  var values = Array.isArray(node.values) ? node.values.slice() : [];

  // Deterministic NA semantics:
  // - equals/not_equals/any_of/scalars: NA on the source variable evaluates to FALSE.
  // - is_missing: only NA evaluates to TRUE.
  if (node.op === "is_missing") {
    return "is.na(" + leftRef + ")";
  }

  // Q imports .sav variables as labeled factors where R sees the label strings,
  // not the underlying numeric codes. as.numeric() recovers the original SPSS codes.
  // For numeric value comparisons we must use as.numeric(leftRef) to match codes.
  // For string value comparisons we keep leftRef as-is.

  if (node.op === "any_of") {
    if (values.length === 0) {
      throw new Error("unsupported_any_of_empty");
    }
    var anyOfHasNumeric = false;
    for (var ai = 0; ai < values.length; ai += 1) {
      if (typeof values[ai] === "number") { anyOfHasNumeric = true; break; }
    }
    var anyOfLeft = anyOfHasNumeric ? "as.numeric(" + leftRef + ")" : leftRef;
    var anyOfParts = [];
    for (var i = 0; i < values.length; i += 1) {
      anyOfParts.push("(" + anyOfLeft + " == " + htToRLiteral(values[i]) + ")");
    }
    return "(!is.na(" + leftRef + ") & (" + anyOfParts.join(" | ") + "))";
  }

  if (values.length !== 1) {
    throw new Error("unsupported_term_arity_" + node.op);
  }

  var literal = htToRLiteral(values[0]);
  if (node.op === "equals") {
    var eqLeft = typeof values[0] === "number" ? "as.numeric(" + leftRef + ")" : leftRef;
    return "(!is.na(" + leftRef + ") & (" + eqLeft + " == " + literal + "))";
  }
  if (node.op === "not_equals") {
    var neqLeft = typeof values[0] === "number" ? "as.numeric(" + leftRef + ")" : leftRef;
    return "(!is.na(" + leftRef + ") & (" + neqLeft + " != " + literal + "))";
  }

  var scalarOperator = null;
  if (node.op === "greater_than") scalarOperator = ">";
  if (node.op === "greater_than_or_equals") scalarOperator = ">=";
  if (node.op === "less_than") scalarOperator = "<";
  if (node.op === "less_than_or_equals") scalarOperator = "<=";

  if (scalarOperator) {
    if (typeof values[0] === "number") {
      var numericLeft = "suppressWarnings(as.numeric(as.character(" + leftRef + ")))";
      return "(!is.na(" + numericLeft + ") & (" + numericLeft + " " + scalarOperator + " " + String(values[0]) + "))";
    }
    return "(!is.na(" + leftRef + ") & (" + leftRef + " " + scalarOperator + " " + literal + "))";
  }

  throw new Error("unsupported_term_operator_" + node.op);
}

function htCompileDerivedComparisonToBooleanExpression(node, filterId) {
  htAssert(node && typeof node.leftVar === "string" && node.leftVar.length > 0, "Invalid derived comparison leftVar for " + filterId);
  htAssert(node && typeof node.rightVar === "string" && node.rightVar.length > 0, "Invalid derived comparison rightVar for " + filterId);

  var op = String(node.op || "");
  if (op !== "==" && op !== "!=" && op !== ">" && op !== ">=" && op !== "<" && op !== "<=") {
    throw new Error("unsupported_derived_operator_" + op);
  }

  return "(!is.na(" + node.leftVar + ") & !is.na(" + node.rightVar + ") & (" + node.leftVar + " " + op + " " + node.rightVar + "))";
}

function htCompileFilterTreeToBooleanExpression(node, filterId) {
  htAssert(node && typeof node === "object", "Invalid filter node for " + filterId);

  if (node.type === "term") {
    return htCompileTermNodeToBooleanExpression(node, filterId);
  }

  if (node.type === "derived_comparison") {
    return htCompileDerivedComparisonToBooleanExpression(node, filterId);
  }

  if (node.type === "and") {
    htAssert(Array.isArray(node.children) && node.children.length > 0, "AND filter must include children for " + filterId);
    var andParts = [];
    for (var i = 0; i < node.children.length; i += 1) {
      andParts.push("(" + htCompileFilterTreeToBooleanExpression(node.children[i], filterId) + ")");
    }
    return "(" + andParts.join(" & ") + ")";
  }

  if (node.type === "or") {
    htAssert(Array.isArray(node.children) && node.children.length > 0, "OR filter must include children for " + filterId);
    var orParts = [];
    for (var j = 0; j < node.children.length; j += 1) {
      orParts.push("(" + htCompileFilterTreeToBooleanExpression(node.children[j], filterId) + ")");
    }
    return "(" + orParts.join(" | ") + ")";
  }

  if (node.type === "not") {
    htAssert(node.child, "NOT filter must include child node for " + filterId);
    return "(!(" + htCompileFilterTreeToBooleanExpression(node.child, filterId) + "))";
  }

  throw new Error("unsupported_filter_node_type_" + String(node.type || "unknown"));
}

function htCompileFilterTreeToRExpression(filterTree, filterId) {
  var booleanExpression = htCompileFilterTreeToBooleanExpression(filterTree, filterId);
  return "ifelse(" + booleanExpression + ", 1, 0)";
}

function htEnsureNumericVariableType(variable) {
  try {
    if (
      variable
      && typeof variable === "object"
      && Object.prototype.hasOwnProperty.call(variable, "variableType")
      && variable.variableType !== "Numeric"
    ) {
      variable.variableType = "Numeric";
    }
  } catch (_error) {
    // ignore if the runtime locks this property
  }
}

function htLogDiag(tag, details) {
  if (typeof log !== "function") {
    return;
  }
  try {
    log(tag + ":" + JSON.stringify(details));
  } catch (_error) {
    log(tag);
  }
}

function htProbeRuntimeCapabilities(dataFile, dataFrameRef) {
  var caps = {
    dataFrameRef: dataFrameRef,
    supportsNewRVariable: typeof dataFile.newRVariable === "function",
    supportsSetQuestionPickAny: typeof dataFile.setQuestion === "function",
    supportsCreateBanner: typeof dataFile.createBanner === "function",
    // If we can create R variables, the table_filters_variable path works.
    // We've empirically proven: newRVariable + isFilter=true + direct assignment succeeds.
    // The previous end-to-end probe (create table + assign filter) had a timing issue
    // in Q where isFilter=true wasn't recognized on freshly created variables in the
    // same execution context, producing false negatives.
    supportsTableFiltersAssignment: typeof dataFile.newRVariable === "function",
    supportsMaskedPrimary: false
  };

  // Probe masked-primary capability (dataFile.createFilterTerm exists)
  if (typeof dataFile.createFilterTerm === "function" && typeof dataFile.newFilterQuestion === "function") {
    caps.supportsMaskedPrimary = true;
  }

  return caps;
}

function htSelectTableFilterBindStrategy(dataFile, dataFrameRef, capabilities) {
  if (capabilities.supportsTableFiltersAssignment) return "table_filters_variable";
  if (capabilities.supportsMaskedPrimary) return "table_primary_masked";
  return null;
}

function htPersistFilterVariable(dataFile, filterTree, filterId, helperVarName, helperVarLabel) {
  var diagnostics = {
    filterId: filterId,
    helperVarName: helperVarName,
    compileStrategy: "compile_filter_tree_to_r",
    blockedReason: null
  };

  try {
    // Check for existing variable (reuse path)
    var existing = htReadVariableIfExists(dataFile, helperVarName);
    if (existing) {
      htEnsureNumericVariableType(existing);
      diagnostics.compileStrategy = "reuse_existing_helper_variable";
      htLogDiag("HT_FILTER_VAR_DIAG", diagnostics);
      return existing;
    }

    // Compile filter tree to deterministic R boolean expression -> ifelse(expr, 1, 0)
    var expression = htCompileFilterTreeToRExpression(filterTree, filterId);
    htAssert(typeof dataFile.newRVariable === "function", "Data file does not support newRVariable required for " + filterId + ".");
    var helperQuestionName = htSafeIdentifier("HT_FiltQ_" + htHashLabel(filterId).slice(0, 8), helperVarName, 120);
    var created = false;
    var createErrors = [];
    var createAttempts = [
      function () { dataFile.newRVariable(expression, helperVarName, helperVarLabel || "HT filter helper", null); },
      function () { dataFile.newRVariable(expression, helperVarName, helperQuestionName, helperVarLabel || "HT filter helper"); },
      function () { dataFile.newRVariable(expression, helperVarName, helperQuestionName, null); },
    ];
    for (var i = 0; i < createAttempts.length; i += 1) {
      try {
        createAttempts[i]();
        created = true;
        break;
      } catch (createErr) {
        createErrors.push(createErr && createErr.message ? createErr.message : String(createErr));
      }
    }
    if (!created) {
      throw new Error("new_r_variable_failed:" + createErrors.join(" | "));
    }

    // Retrieve and verify created variable
    var createdVariable = htReadVariableIfExists(dataFile, helperVarName);
    var helperVariable = createdVariable || htResolveQuestionOrVariable(dataFile, helperVarName, "filter variable " + filterId);
    htEnsureNumericVariableType(helperVariable);

    // Explicitly set label — Q may not preserve the label from newRVariable()
    try {
      if (helperVariable && helperVarLabel) {
        helperVariable.label = helperVarLabel;
      }
    } catch (_labelErr) {
      // ignore if runtime locks label property
    }

    htLogDiag("HT_FILTER_VAR_DIAG", diagnostics);
    return helperVariable;
  } catch (error) {
    diagnostics.blockedReason = error && error.message ? error.message : String(error);
    htLogDiag("HT_FILTER_VAR_DIAG", diagnostics);
    throw error;
  }
}

function htAttachTableAdditionalFilter(tableObj, helperVar, dataFile, primaryObj, tableId, additionalFilterId, bindStrategy) {
  var diagnostics = {
    tableId: tableId,
    additionalFilterId: additionalFilterId,
    helperVarName: helperVar && helperVar.name ? helperVar.name : null,
    bindPath: bindStrategy,
    blockedReason: null
  };

  try {
    if (bindStrategy === "table_filters_variable") {
      // Q requires the variable's parent question to have isFilter = true
      // before the variable can be used in table.filters. Variables created via
      // newRVariable get an auto-generated parent question with isFilter = false.
      var parentQuestion = helperVar && helperVar.question ? helperVar.question : null;
      htLogDiag("HT_TABLE_FILTER_BIND_STEP", { tableId: tableId, step: "marking_isFilter", hasParentQuestion: !!parentQuestion, previousIsFilter: parentQuestion ? !!parentQuestion.isFilter : null });
      if (parentQuestion) {
        parentQuestion.isFilter = true;
      }

      // Assign the variable directly to table.filters (not a question wrapper).
      htLogDiag("HT_TABLE_FILTER_BIND_STEP", { tableId: tableId, step: "direct_variable_assign", helperVarName: helperVar && helperVar.name ? helperVar.name : null });
      tableObj.filters = [helperVar];
      htLogDiag("HT_TABLE_FILTER_BIND_STEP", { tableId: tableId, step: "filters_assigned" });

      htLogDiag("HT_TABLE_FILTER_DIAG", diagnostics);
      return;
    }

    if (bindStrategy === "table_primary_masked") {
      htAssert(typeof dataFile.createFilterTerm === "function", "createFilterTerm not available for masked-primary bind on " + tableId);
      htAssert(typeof dataFile.newFilterQuestion === "function", "newFilterQuestion not available for masked-primary bind on " + tableId);

      var term = null;
      try {
        term = dataFile.createFilterTerm(helperVar, "Any of", null, [1], false);
      } catch (_e1) {
        try {
          term = dataFile.createFilterTerm(helperVar, "Equals", 1);
        } catch (_e2) {
          throw new Error("masked-primary filter term creation failed for " + tableId);
        }
      }
      htAssert(term, "Filter term is null for masked-primary on " + tableId);

      var filterQ = dataFile.newFilterQuestion(
        term,
        htSafeIdentifier("HT_TblFilt", tableId, 120),
        htSafeIdentifier("ht_tblfilt", tableId, 80),
        "HT table additional filter",
        null
      );
      htAssert(filterQ, "Filter question is null for masked-primary on " + tableId);

      tableObj.filters = [filterQ];
      htLogDiag("HT_TABLE_FILTER_DIAG", diagnostics);
      return;
    }

    throw new Error("Unknown bind strategy '" + bindStrategy + "' for table " + tableId);
  } catch (error) {
    diagnostics.blockedReason = error && error.message ? error.message : String(error);
    htLogDiag("HT_TABLE_FILTER_DIAG", diagnostics);
    throw error;
  }
}

function htApplyTableHeaderMetadata(tableObj, tableId, headerRows) {
  if (!Array.isArray(headerRows) || headerRows.length === 0) {
    htLogDiag("HT_TABLE_HEADER_METADATA_DIAG", {
      tableId: tableId,
      headerCount: 0,
      appliedTargets: [],
      notePreview: null
    });
    return;
  }

  var sortedHeaders = headerRows.slice().sort(function (a, b) {
    var aIndex = a && a.rowIndex !== undefined ? Number(a.rowIndex) : 0;
    var bIndex = b && b.rowIndex !== undefined ? Number(b.rowIndex) : 0;
    return aIndex - bIndex;
  });
  var nonEmptyLabels = [];
  for (var i = 0; i < sortedHeaders.length; i += 1) {
    var label = sortedHeaders[i] && sortedHeaders[i].label ? String(sortedHeaders[i].label).replace(/^\\s+|\\s+$/g, "") : "";
    if (label) {
      nonEmptyLabels.push(label);
    }
  }
  if (nonEmptyLabels.length === 0) {
    htLogDiag("HT_TABLE_HEADER_METADATA_DIAG", {
      tableId: tableId,
      headerCount: sortedHeaders.length,
      appliedTargets: [],
      notePreview: null
    });
    return;
  }

  var noteText = "Sections: " + nonEmptyLabels.join(" | ");
  var appliedTargets = [];
  try {
    tableObj.notes = noteText;
    appliedTargets.push("notes");
  } catch (_notesErr) {
    // ignore if runtime does not expose notes
  }
  try {
    tableObj.description = noteText;
    appliedTargets.push("description");
  } catch (_descriptionErr) {
    // ignore if runtime does not expose description
  }

  htLogDiag("HT_TABLE_HEADER_METADATA_DIAG", {
    tableId: tableId,
    headerCount: sortedHeaders.length,
    appliedTargets: appliedTargets,
    notePreview: noteText
  });
}

function htDuplicateBannerHelperVariable(helperVariable, planId, groupName, groupIndex, variableIndex) {
  if (!helperVariable) {
    return null;
  }
  var sourceLabel = helperVariable.label || null;
  if (typeof helperVariable.duplicate === "function") {
    try {
      var duplicated = helperVariable.duplicate();
      var duplicatedVariable = htExtractFirstVariable(duplicated);
      if (duplicatedVariable) {
        // Preserve label from source — Q may reset it during duplicate()
        if (sourceLabel) {
          try { duplicatedVariable.label = sourceLabel; } catch (_lbl) {}
        }
        return duplicatedVariable;
      }
    } catch (_dupErr) {
      // ignore and fallback to original helper variable
    }
  }
  return helperVariable;
}

function htBuildGroupedBanner(dataFile, bannerQuestionName, groups, planId) {
  htAssert(typeof dataFile.setQuestion === "function", "Data file does not support setQuestion for " + planId);
  htAssert(typeof dataFile.createBanner === "function", "Data file does not support createBanner for " + planId);
  htAssert(groups.length > 0, "Banner plan has no groups: " + planId);

  var groupQuestions = [];
  for (var i = 0; i < groups.length; i += 1) {
    var group = groups[i];

    // Native question strategy: duplicate source question directly instead of N synthetic variables
    if (group.groupStrategy === "native_question" && group.sourceQuestionName) {
      var nativeQ = null;
      try {
        nativeQ = htBuildNativeBannerGroup(dataFile, group, planId, i);
      } catch (nativeErr) {
        htLogDiag("HT_BANNER_NATIVE_FALLBACK", {
          planId: planId,
          groupName: group.groupName,
          error: nativeErr && nativeErr.message ? nativeErr.message : String(nativeErr),
          fallback: "synthetic_filter"
        });
        nativeQ = null;
      }
      if (nativeQ) {
        groupQuestions.push(nativeQ);
        continue;
      }
      // Fall through to synthetic path on failure
    }

    // Synthetic filter path (existing logic)
    htAssert(group.helperVariables && group.helperVariables.length > 0, "Banner group '" + group.groupName + "' has no filter variables in " + planId);
    var isolatedVariables = [];
    for (var h = 0; h < group.helperVariables.length; h += 1) {
      var duplicatedHelper = htDuplicateBannerHelperVariable(group.helperVariables[h], planId, group.groupName, i, h);
      if (!duplicatedHelper) {
        continue;
      }
      isolatedVariables.push(duplicatedHelper);
    }
    htAssert(isolatedVariables.length > 0, "Banner group '" + group.groupName + "' has no duplicable helper variables in " + planId);

    // Banner cut variables must be Categorical (not Numeric) for Pick Any to work.
    // htPersistFilterVariable sets them to Numeric for table filter use, but Q needs
    // Categorical so it interprets 0/1 as categories (not selected / selected).
    for (var k = 0; k < isolatedVariables.length; k += 1) {
      try {
        if (isolatedVariables[k] && typeof isolatedVariables[k] === "object" && Object.prototype.hasOwnProperty.call(isolatedVariables[k], "variableType")) {
          isolatedVariables[k].variableType = "Categorical";
        }
      } catch (_catErr) {
        // ignore if Q locks this property
      }
    }
    // Use a prefixed name to avoid colliding with existing questions in the data file.
    var groupQName = htSafeIdentifier("HT_BG_" + htHashLabel(planId).slice(0, 8), String(i + 1) + "_" + group.groupName, 120);
    var groupQ = dataFile.setQuestion(groupQName, "Pick Any", isolatedVariables);
    htAssert(groupQ, "Failed to create banner group question '" + group.groupName + "' for " + planId);
    // Set clean display name for the span header
    try { groupQ.name = group.groupName; } catch (_renameErr) {}
    htLogDiag("HT_BANNER_GROUP", {
      planId: planId,
      groupName: group.groupName,
      groupIndex: i,
      questionName: groupQ && groupQ.name ? groupQ.name : groupQName,
      variableCount: isolatedVariables.length,
      strategy: "synthetic_filter"
    });
    groupQuestions.push(groupQ);
  }

  // Each group in its own array = non-nested (side-by-side groups with column spans).
  // Total column is omitted — easy to add manually in Q and avoids createBanner parameter issues.
  var blocks = [];
  for (var j = 0; j < groupQuestions.length; j += 1) {
    blocks.push([groupQuestions[j]]);
  }
  var banner = dataFile.createBanner(htSafeIdentifier("HT_Banner", bannerQuestionName, 120), blocks, false, false, true);
  htAssert(banner, "Failed to create grouped banner for " + planId);
  htLogDiag("HT_BANNER_CREATED", { planId: planId, groupCount: groups.length, bannerName: banner && banner.name ? banner.name : bannerQuestionName });
  return banner;
}

function htBuildNativeBannerGroup(dataFile, group, planId, groupIndex) {
  // Resolve source by name — tries getQuestionByName first, then getVariableByName.
  // If we get a variable back, navigate to its parent question for duplicate().
  var resolved = htResolveQuestionOrVariable(dataFile, group.sourceQuestionName, "native banner group " + group.groupName);
  if (resolved && !resolved.variables && resolved.question) {
    resolved = resolved.question;
  }
  htAssert(resolved && typeof resolved.duplicate === "function",
    "Source for native banner group '" + group.groupName + "' (" + group.sourceQuestionName + ") does not support duplicate()");

  var dupName = htSafeIdentifier("HT_BG_native", group.groupName, 120);
  var dup = resolved.duplicate(dupName);
  htAssert(dup, "question.duplicate() returned null for native banner group '" + group.groupName + "'");

  // Set clean display name for the span header
  try { dup.name = group.groupName; } catch (_renameErr) {}

  // Apply custom labels from cut column names if available
  if (group.columnLabels && Array.isArray(group.columnLabels) && dup.variables && Array.isArray(dup.variables)) {
    var dupVar = dup.variables.length > 0 ? dup.variables[0] : null;
    if (dupVar && dupVar.valueAttributes && typeof dupVar.valueAttributes.setLabel === "function") {
      for (var i = 0; i < group.columnLabels.length; i += 1) {
        var cl = group.columnLabels[i];
        if (cl && cl.value !== undefined && cl.label) {
          try {
            dupVar.valueAttributes.setLabel(cl.value, cl.label);
          } catch (_lblErr) {
            try {
              var numVal = Number(cl.value);
              if (!isNaN(numVal)) {
                dupVar.valueAttributes.setLabel(numVal, cl.label);
              }
            } catch (_numLblErr) {}
          }
        }
      }
    }
  }

  htLogDiag("HT_BANNER_GROUP", {
    planId: planId,
    groupName: group.groupName,
    groupIndex: groupIndex,
    questionName: dup && dup.name ? dup.name : dupName,
    sourceQuestion: group.sourceQuestionName,
    strategy: "native_question"
  });

  return dup;
}

function htBuildNativeQuestionTable(dataFile, tableJob) {
  var strategy = tableJob.tableStrategy;
  var tableId = tableJob.tableId;
  try {
    switch (strategy) {
      case "native_pick_one":
        return htApplyNativePickOne(dataFile, tableJob);
      case "native_pick_one_with_nets":
        return htApplyNativePickOneWithNets(dataFile, tableJob);
      case "native_pick_any":
        return htApplyNativePickAny(dataFile, tableJob);
      case "native_numeric_single":
        return htApplyNativeNumericSingle(dataFile, tableJob);
      case "native_numeric_multi":
        return htApplyNativeNumericMulti(dataFile, tableJob);
      case "cross_variable":
        return htApplyNativeCrossVariable(dataFile, tableJob);
      case "synthetic_rows":
        return htBuildTablePrimaryFromRows(dataFile, tableJob.questionId, tableId, tableJob.rows, tableJob.primaryStrategy);
      case "excluded":
        htLogDiag("HT_NATIVE_TABLE_SKIP", { tableId: tableId, strategy: strategy, reason: "excluded" });
        return null;
      default:
        return htBuildTablePrimaryFromRows(dataFile, tableJob.questionId, tableId, tableJob.rows, tableJob.primaryStrategy);
    }
  } catch (e) {
    htLogDiag("HT_NATIVE_TABLE_FALLBACK", {
      tableId: tableId,
      strategy: strategy,
      error: e && e.message ? e.message : String(e),
      fallback: "synthetic_rows"
    });
    return htBuildTablePrimaryFromRows(dataFile, tableJob.questionId, tableId, tableJob.rows, tableJob.primaryStrategy);
  }
}

function htFindSourceQuestion(dataFile, sourceQuestionName, tableId) {
  if (!sourceQuestionName) {
    throw new Error("No sourceQuestionName for native table " + tableId);
  }
  var sourceQ = null;
  try {
    sourceQ = dataFile.getQuestionByName(sourceQuestionName);
  } catch (_e) {
    sourceQ = null;
  }
  if (!sourceQ) {
    // Try case variants
    var candidates = [sourceQuestionName, sourceQuestionName.toUpperCase(), sourceQuestionName.toLowerCase()];
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        sourceQ = dataFile.getQuestionByName(candidates[i]);
        if (sourceQ) break;
      } catch (_e2) {
        sourceQ = null;
      }
    }
  }
  htAssert(sourceQ, "Source question not found: " + sourceQuestionName + " for table " + tableId);
  return sourceQ;
}

function htApplyNativePickOne(dataFile, tableJob) {
  var tableId = tableJob.tableId;
  var sourceQ = htFindSourceQuestion(dataFile, tableJob.sourceQuestionName, tableId);

  var dupName = "__ht_" + tableId;
  var dup = sourceQ.duplicate(dupName);
  htAssert(dup, "question.duplicate() returned null for " + tableId);

  // Get the first variable from the duplicated question for value attribute operations
  var dupVar = null;
  if (dup.variables && Array.isArray(dup.variables) && dup.variables.length > 0) {
    dupVar = dup.variables[0];
  }

  // Apply custom labels from row plans
  var rows = tableJob.rows || [];
  var appliedLabels = 0;
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    if (row.strategy === "blocked") continue;
    var vals = row.selectedValues;
    if (vals && vals.length === 1 && dupVar && dupVar.valueAttributes) {
      try {
        dupVar.valueAttributes.setLabel(vals[0], row.effectiveLabel);
        appliedLabels += 1;
      } catch (_labelErr) {
        // Try numeric coercion
        try {
          var numVal = Number(vals[0]);
          if (!isNaN(numVal)) {
            dupVar.valueAttributes.setLabel(numVal, row.effectiveLabel);
            appliedLabels += 1;
          }
        } catch (_numLabelErr) {
          // ignore label set failures
        }
      }
    }
  }

  htLogDiag("HT_NATIVE_PICK_ONE", {
    tableId: tableId,
    sourceQuestion: tableJob.sourceQuestionName,
    dupName: dupName,
    rowCount: rows.length,
    appliedLabels: appliedLabels
  });

  return dup;
}

function htApplyNativePickOneWithNets(dataFile, tableJob) {
  var tableId = tableJob.tableId;
  // Base duplicate + labels
  var dup = htApplyNativePickOne(dataFile, tableJob);

  var dupVar = null;
  if (dup && dup.variables && Array.isArray(dup.variables) && dup.variables.length > 0) {
    dupVar = dup.variables[0];
  }

  if (!dupVar || !dupVar.dataReduction || typeof dupVar.dataReduction.createNET !== "function") {
    htLogDiag("HT_NATIVE_PICK_ONE_NETS_SKIP", {
      tableId: tableId,
      reason: "no_createNET_support",
      hasDupVar: !!dupVar,
      hasDataReduction: dupVar ? !!dupVar.dataReduction : false
    });
    return dup;
  }

  var rows = tableJob.rows || [];
  var netsCreated = 0;
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    if (!row.isNet || !row.netComponents || row.netComponents.length === 0) continue;

    // Find labels of component rows (already set via setLabel in htApplyNativePickOne)
    var componentLabels = [];
    for (var j = 0; j < row.netComponents.length; j += 1) {
      var compVar = row.netComponents[j];
      // Find the row plan for this component
      for (var k = 0; k < rows.length; k += 1) {
        if (rows[k].variable === compVar && !rows[k].isNet) {
          componentLabels.push(rows[k].effectiveLabel);
          break;
        }
      }
    }

    if (componentLabels.length > 0) {
      try {
        dupVar.dataReduction.createNET(componentLabels, row.effectiveLabel);
        netsCreated += 1;
      } catch (_netErr) {
        htLogDiag("HT_NATIVE_NET_CREATE_FAIL", {
          tableId: tableId,
          netLabel: row.effectiveLabel,
          componentCount: componentLabels.length,
          error: _netErr && _netErr.message ? _netErr.message : String(_netErr)
        });
      }
    }
  }

  htLogDiag("HT_NATIVE_PICK_ONE_NETS", {
    tableId: tableId,
    netsCreated: netsCreated
  });

  return dup;
}

function htApplyNativePickAny(dataFile, tableJob) {
  var tableId = tableJob.tableId;
  var sourceQ = htFindSourceQuestion(dataFile, tableJob.sourceQuestionName, tableId);

  var dupName = "__ht_" + tableId;
  var dup = sourceQ.duplicate(dupName);
  htAssert(dup, "question.duplicate() returned null for Pick Any table " + tableId);

  // For Pick Any / multi-select, apply labels per variable
  var rows = tableJob.rows || [];
  var appliedLabels = 0;
  if (dup.variables && Array.isArray(dup.variables)) {
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (row.strategy === "blocked" || row.isNet) continue;
      // Find matching variable in the duplicated question
      for (var v = 0; v < dup.variables.length; v += 1) {
        var dupVar = dup.variables[v];
        if (dupVar && dupVar.name && String(dupVar.name).indexOf(row.variable) !== -1) {
          try {
            dupVar.label = row.effectiveLabel;
            appliedLabels += 1;
          } catch (_labelErr) {
            // ignore
          }
          break;
        }
      }
    }
  }

  // Handle NETs if present
  var netsCreated = 0;
  var firstVar = dup.variables && dup.variables.length > 0 ? dup.variables[0] : null;
  if (firstVar && firstVar.dataReduction && typeof firstVar.dataReduction.createNET === "function") {
    for (var ni = 0; ni < rows.length; ni += 1) {
      var netRow = rows[ni];
      if (!netRow.isNet || !netRow.netComponents || netRow.netComponents.length === 0) continue;

      var componentLabels = [];
      for (var nj = 0; nj < netRow.netComponents.length; nj += 1) {
        var compVar = netRow.netComponents[nj];
        for (var nk = 0; nk < rows.length; nk += 1) {
          if (rows[nk].variable === compVar && !rows[nk].isNet) {
            componentLabels.push(rows[nk].effectiveLabel);
            break;
          }
        }
      }
      if (componentLabels.length > 0) {
        try {
          firstVar.dataReduction.createNET(componentLabels, netRow.effectiveLabel);
          netsCreated += 1;
        } catch (_netErr) {
          // ignore NET creation failures
        }
      }
    }
  }

  htLogDiag("HT_NATIVE_PICK_ANY", {
    tableId: tableId,
    sourceQuestion: tableJob.sourceQuestionName,
    appliedLabels: appliedLabels,
    netsCreated: netsCreated
  });

  return dup;
}

function htApplyNativeNumericSingle(dataFile, tableJob) {
  var tableId = tableJob.tableId;
  var sourceQ = htFindSourceQuestion(dataFile, tableJob.sourceQuestionName, tableId);

  var dupName = "__ht_" + tableId;
  var dup = sourceQ.duplicate(dupName);
  htAssert(dup, "question.duplicate() returned null for numeric single table " + tableId);

  try {
    dup.questionType = "Number";
  } catch (_typeErr) {
    // ignore if Q locks this
  }

  // Apply label from row plan
  var rows = tableJob.rows || [];
  if (rows.length > 0 && rows[0].effectiveLabel) {
    try {
      dup.name = dupName;
      if (dup.variables && dup.variables.length > 0) {
        dup.variables[0].label = rows[0].effectiveLabel;
      }
    } catch (_labelErr) {
      // ignore
    }
  }

  htLogDiag("HT_NATIVE_NUMERIC_SINGLE", {
    tableId: tableId,
    sourceQuestion: tableJob.sourceQuestionName
  });

  return dup;
}

function htApplyNativeNumericMulti(dataFile, tableJob) {
  // Multi-variable means are complex — each row is a different variable.
  // The as.numeric() fix resolves zeros. For now, fall back to existing synthetic path
  // but with the corrected as.numeric() call. Native handling can be added in a follow-up.
  htLogDiag("HT_NATIVE_NUMERIC_MULTI_FALLBACK", {
    tableId: tableJob.tableId,
    rowCount: tableJob.rows ? tableJob.rows.length : 0,
    reason: "multi_variable_means_use_synthetic"
  });
  return htBuildTablePrimaryFromRows(
    dataFile, tableJob.questionId, tableJob.tableId,
    tableJob.rows, tableJob.primaryStrategy
  );
}

function htApplyNativeCrossVariable(dataFile, tableJob) {
  // Cross-variable comparison: each row references a different variable for a specific value.
  // These tables compose multiple single-variable duplicates into a Pick Any.
  // For now, use the existing synthetic path which handles this pattern.
  htLogDiag("HT_NATIVE_CROSS_VARIABLE_FALLBACK", {
    tableId: tableJob.tableId,
    rowCount: tableJob.rows ? tableJob.rows.length : 0,
    reason: "cross_variable_use_synthetic"
  });
  return htBuildTablePrimaryFromRows(
    dataFile, tableJob.questionId, tableJob.tableId,
    tableJob.rows, tableJob.primaryStrategy
  );
}`;

export const Q_EXPORT_HELPER_RUNTIME_HASH = createHash('sha256')
  .update(NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE)
  .digest('hex');
