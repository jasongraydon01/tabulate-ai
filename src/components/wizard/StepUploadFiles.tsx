'use client';

import FileUpload from '@/components/FileUpload';
import type { AnalysisMethod, BannerMode, StudyMethodology } from '@/schemas/wizardSchema';
import { StepDataValidation } from './StepDataValidation';
import type { DataValidationResult } from '@/schemas/wizardSchema';
import { Info } from 'lucide-react';

export interface WizardFiles {
  dataFile: File | null;
  surveyDocument: File | null;
  bannerPlan: File | null;
  messageList: File | null;
}

interface StepUploadFilesProps {
  files: WizardFiles;
  onFileChange: <K extends keyof WizardFiles>(key: K, file: WizardFiles[K]) => void;
  bannerMode: BannerMode;
  analysisMethod: AnalysisMethod;
  studyMethodology: StudyMethodology;
  maxdiffHasMessageList?: boolean;
  validationResult: DataValidationResult;
  onWeightConfirm?: (column: string) => void;
  onWeightDeny?: () => void;
}

export function StepUploadFiles({
  files,
  onFileChange,
  bannerMode,
  analysisMethod,
  studyMethodology,
  maxdiffHasMessageList,
  validationResult,
  onWeightConfirm,
  onWeightDeny,
}: StepUploadFilesProps) {
  const showBannerUpload = bannerMode === 'upload';
  const isMaxDiff = analysisMethod === 'maxdiff';

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* File uploads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FileUpload
          title="Data File"
          description={
            isMaxDiff
              ? 'SPSS data file with anchored scores appended, wide format'
              : studyMethodology === 'segmentation'
                ? 'SPSS data file with respondent-level segment assignments when available'
                : 'SPSS data file — qualified respondents, wide format'
          }
          acceptedTypes=".sav,.spss"
          fileExtensions={['.sav', '.spss']}
          onFileSelect={(file) => onFileChange('dataFile', file)}
          selectedFile={files.dataFile}
        />

        <FileUpload
          title="Survey Document"
          description="Survey questionnaire — used for question text, skip logic, and table structure"
          acceptedTypes=".pdf,.doc,.docx"
          fileExtensions={['.pdf', '.doc', '.docx']}
          onFileSelect={(file) => onFileChange('surveyDocument', file)}
          selectedFile={files.surveyDocument}
        />

        {showBannerUpload && (
          <FileUpload
            title="Banner Plan"
            description="Banner plan document defining your cuts"
            acceptedTypes=".pdf,.doc,.docx"
            fileExtensions={['.pdf', '.doc', '.docx']}
            onFileSelect={(file) => onFileChange('bannerPlan', file)}
            selectedFile={files.bannerPlan}
          />
        )}

      </div>

      {isMaxDiff && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            {maxdiffHasMessageList
              ? 'Message text is configured in the next step. No separate message-list file upload is used in this wizard flow.'
              : 'If you do not have a curated message list, the next step can fall back to `.sav` labels for message text.'}
          </p>
        </div>
      )}

      {/* Data validation (2B) — appears once .sav is uploaded */}
      {files.dataFile && (
        <StepDataValidation
          validationResult={validationResult}
          onWeightConfirm={onWeightConfirm}
          onWeightDeny={onWeightDeny}
        />
      )}
    </div>
  );
}
