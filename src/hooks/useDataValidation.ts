/**
 * useDataValidation hook
 *
 * Sends a .sav file to /api/validate-data and returns
 * weight candidates, stacked detection, and data quality info.
 * Used in the wizard Step 2B.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { INITIAL_VALIDATION, type DataValidationResult } from '@/schemas/wizardSchema';

export function useDataValidation(dataFile: File | null, endpoint = '/api/validate-data') {
  const [result, setResult] = useState<DataValidationResult>(INITIAL_VALIDATION);
  const abortRef = useRef<AbortController | null>(null);

  const runValidation = useCallback(async (file: File) => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setResult((prev) => ({ ...prev, status: 'validating' }));

    try {
      const formData = new FormData();
      formData.append('dataFile', file);

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Validation failed' }));
        setResult({
          ...INITIAL_VALIDATION,
          status: 'error',
          errors: [{ message: errorData.error || 'Validation failed', severity: 'error' }],
        });
        return;
      }

      const data = await response.json();
      setResult({
        status: 'success',
        rowCount: data.rowCount,
        columnCount: data.columnCount,
        weightCandidates: data.weightCandidates,
        isStacked: data.isStacked,
        stackedWarning: data.stackedWarning,
        loopSummary: { hasLoops: false, loopCount: 0 },
        errors: data.errors,
        canProceed: data.canProceed,
      });
    } catch (error) {
      // Ignore abort errors
      if (error instanceof DOMException && error.name === 'AbortError') return;

      setResult({
        ...INITIAL_VALIDATION,
        status: 'error',
        errors: [{ message: error instanceof Error ? error.message : 'Validation failed', severity: 'error' }],
      });
    }
  }, [endpoint]);

  useEffect(() => {
    if (!dataFile) {
      setResult(INITIAL_VALIDATION);
      return;
    }

    runValidation(dataFile);

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [dataFile, runValidation]);

  return result;
}
