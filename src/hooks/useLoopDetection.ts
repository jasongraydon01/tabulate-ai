/**
 * @deprecated Phase 3.3 — Replaced by useDataValidation which includes loop detection,
 * weight detection, and stacked-data detection in a single validation pass.
 */
import { useState, useEffect } from 'react';

export interface LoopDetectionResult {
  hasLoops: boolean;
  loopCount: number;
}

export function useLoopDetection(dataFile: File | null) {
  const [loopDetection, setLoopDetection] = useState<LoopDetectionResult | null>(null);
  const [isDetectingLoops, setIsDetectingLoops] = useState(false);
  const [loopStatTestingMode, setLoopStatTestingMode] = useState<'suppress' | 'complement'>('suppress');

  useEffect(() => {
    let cancelled = false;

    const detectLoops = async () => {
      if (!dataFile) {
        setLoopDetection(null);
        setIsDetectingLoops(false);
        setLoopStatTestingMode('suppress');
        return;
      }

      const lowerName = dataFile.name.toLowerCase();
      if (!lowerName.endsWith('.sav')) {
        setLoopDetection(null);
        setIsDetectingLoops(false);
        setLoopStatTestingMode('suppress');
        return;
      }

      setIsDetectingLoops(true);
      try {
        const fd = new FormData();
        fd.append('dataFile', dataFile);
        const res = await fetch('/api/loop-detect', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('Loop detection failed');
        const data = await res.json();
        if (cancelled) return;
        setLoopDetection({ hasLoops: !!data.hasLoops, loopCount: Number(data.loopCount) || 0 });
        if (!data.hasLoops) {
          setLoopStatTestingMode('suppress');
        }
      } catch {
        if (!cancelled) {
          setLoopDetection({ hasLoops: false, loopCount: 0 });
          setLoopStatTestingMode('suppress');
        }
      } finally {
        if (!cancelled) setIsDetectingLoops(false);
      }
    };

    detectLoops();
    return () => {
      cancelled = true;
    };
  }, [dataFile]);

  return { loopDetection, isDetectingLoops, loopStatTestingMode, setLoopStatTestingMode };
}
