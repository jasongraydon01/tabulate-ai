import { describe, expect, it } from 'vitest';
import {
  deriveStudyFlagsFromConfig,
  deriveLegacyProjectSubType,
  deriveMethodologyFromLegacy,
  ProjectConfigSchema,
  wizardToProjectConfig,
} from '../projectConfigSchema';

describe('projectConfigSchema compatibility helpers', () => {
  it('derives the legacy project sub-type from the new analysis fields', () => {
    const config = ProjectConfigSchema.parse({
      studyMethodology: 'message_testing',
      analysisMethod: 'maxdiff',
      bannerMode: 'upload',
    });

    expect(deriveLegacyProjectSubType(config)).toBe('maxdiff');
  });

  it('maps legacy maxdiff configs onto the new methodology fields at read time', () => {
    const config = ProjectConfigSchema.parse({
      projectSubType: 'maxdiff',
      bannerMode: 'upload',
    });

    expect(deriveMethodologyFromLegacy(config)).toEqual({
      studyMethodology: 'message_testing',
      analysisMethod: 'maxdiff',
    });
  });

  it('preserves explicit new methodology fields and fills the default analysis method', () => {
    const config = ProjectConfigSchema.parse({
      projectSubType: 'standard',
      studyMethodology: 'concept_testing',
      bannerMode: 'upload',
    });

    expect(deriveMethodologyFromLegacy(config)).toEqual({
      studyMethodology: 'concept_testing',
      analysisMethod: 'standard_crosstab',
    });
  });

  it('derives conservative study flags with legacy maxdiff fallback', () => {
    const legacyMaxDiff = ProjectConfigSchema.parse({
      projectSubType: 'maxdiff',
      bannerMode: 'upload',
    });
    const standard = ProjectConfigSchema.parse({
      projectSubType: 'standard',
      studyMethodology: 'concept_testing',
      analysisMethod: 'standard_crosstab',
      bannerMode: 'upload',
    });

    expect(deriveStudyFlagsFromConfig(legacyMaxDiff)).toEqual({
      isDemandSurvey: false,
      hasChoiceModelExercise: null,
      hasMaxDiff: true,
    });
    expect(deriveStudyFlagsFromConfig(standard)).toEqual({
      isDemandSurvey: false,
      hasChoiceModelExercise: null,
      hasMaxDiff: false,
    });
  });

  it('writes new wizard fields while persisting a derived legacy projectSubType', () => {
    const config = wizardToProjectConfig({
      studyMethodology: 'segmentation',
      analysisMethod: 'standard_crosstab',
      bannerMode: 'upload',
      displayMode: 'frequency',
      theme: 'classic',
      statTestingThreshold: 90,
      minBaseSize: 0,
      loopStatTestingMode: 'complement',
      exportFormats: ['excel', 'wincross'],
      wincrossProfileId: 'profile-123',
    });

    expect(config.projectSubType).toBe('segmentation');
    expect(config.studyMethodology).toBe('segmentation');
    expect(config.analysisMethod).toBe('standard_crosstab');
    expect(config.loopStatTestingMode).toBe('complement');
    expect(config.exportFormats).toEqual(['excel', 'wincross']);
    expect(config.wincrossProfileId).toBe('profile-123');
  });
});
