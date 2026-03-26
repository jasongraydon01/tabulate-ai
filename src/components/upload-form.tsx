/**
 * @deprecated Phase 3.3 — Replaced by the wizard flow at /projects/new.
 * The wizard uses StepUploadFiles + StepDataValidation instead.
 * Keep for backward compatibility; will be removed in a future cleanup.
 */
'use client';

import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { LoopDetectionResult } from '@/hooks/useLoopDetection';

export interface UploadedFiles {
  dataMap: File;
  bannerPlan: File;
  dataFile: File;
  survey: File | null;
}

interface UploadFormProps {
  isProcessing: boolean;
  loopDetection: LoopDetectionResult | null;
  isDetectingLoops: boolean;
  loopStatTestingMode: 'suppress' | 'complement';
  onLoopStatTestingModeChange: (mode: 'suppress' | 'complement') => void;
  onSubmit: (files: UploadedFiles) => void;
  onCancel: () => void;
  onDataFileChange: (file: File | null) => void;
}

export function UploadForm({
  isProcessing,
  loopDetection,
  isDetectingLoops,
  loopStatTestingMode,
  onLoopStatTestingModeChange,
  onSubmit,
  onCancel,
  onDataFileChange,
}: UploadFormProps) {
  const [dataMapFile, setDataMapFile] = useState<File | null>(null);
  const [bannerPlanFile, setBannerPlanFile] = useState<File | null>(null);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [surveyFile, setSurveyFile] = useState<File | null>(null);

  const requiredFilesUploaded = dataMapFile && bannerPlanFile && dataFile;

  const handleDataFileSelect = (file: File | null) => {
    setDataFile(file);
    onDataFileChange(file);
  };

  const handleSubmit = () => {
    if (!requiredFilesUploaded) return;
    const files: UploadedFiles = {
      dataMap: dataMapFile!,
      bannerPlan: bannerPlanFile!,
      dataFile: dataFile!,
      survey: surveyFile,
    };

    // Clear form
    setDataMapFile(null);
    setBannerPlanFile(null);
    setDataFile(null);
    setSurveyFile(null);
    onDataFileChange(null);

    onSubmit(files);
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <FileUpload
          title="Data Map"
          description="Upload your data mapping file"
          acceptedTypes=".csv,.xlsx"
          fileExtensions={['.csv', '.xlsx']}
          onFileSelect={setDataMapFile}
          selectedFile={dataMapFile}
        />

        <FileUpload
          title="Banner Plan"
          description="Upload your banner plan document"
          acceptedTypes=".doc,.docx,.pdf"
          fileExtensions={['.doc', '.docx', '.pdf']}
          onFileSelect={setBannerPlanFile}
          selectedFile={bannerPlanFile}
        />

        <FileUpload
          title="Data File"
          description="Upload your SPSS data file"
          acceptedTypes=".sav,.spss"
          fileExtensions={['.sav', '.spss']}
          onFileSelect={handleDataFileSelect}
          selectedFile={dataFile}
        />

        <FileUpload
          title="Survey Document"
          description="Upload questionnaire for enhanced table labels"
          acceptedTypes=".doc,.docx"
          fileExtensions={['.doc', '.docx']}
          onFileSelect={setSurveyFile}
          selectedFile={surveyFile}
          optional
        />
      </div>

      {dataFile && (
        <div className="mb-8 flex justify-center">
          <div className="w-full max-w-2xl rounded-lg border border-muted p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Loop stat testing</p>
                <p className="text-xs text-muted-foreground">
                  {isDetectingLoops
                    ? 'Detecting loops in data file...'
                    : loopDetection?.hasLoops
                      ? `Loops detected (${loopDetection.loopCount})`
                      : 'No loops detected'}
                </p>
              </div>
              {loopDetection?.hasLoops && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Suppress</span>
                  <Switch
                    checked={loopStatTestingMode === 'complement'}
                    onCheckedChange={(checked) => onLoopStatTestingModeChange(checked ? 'complement' : 'suppress')}
                    aria-label="Toggle complement testing for loop tables"
                  />
                  <span className="text-xs text-muted-foreground">Complement</span>
                </div>
              )}
            </div>
            {loopDetection?.hasLoops && (
              <p className="mt-2 text-xs text-muted-foreground">
                Complement compares each cut vs not-A. Suppress disables within-group letters for entity-anchored loop groups.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="text-center">
        {isProcessing ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Pipeline is running in the background. You can navigate away or cancel below.
            </p>
            <Button
              onClick={onCancel}
              variant="outline"
              size="lg"
              className="px-8"
            >
              Cancel Pipeline
            </Button>
          </div>
        ) : (
          <>
            <Button
              onClick={handleSubmit}
              disabled={!requiredFilesUploaded}
              size="lg"
              className="px-8"
            >
              Generate Crosstabs
            </Button>

            {!requiredFilesUploaded && (
              <p className="text-sm text-muted-foreground mt-2">
                Please upload the required files to continue
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
