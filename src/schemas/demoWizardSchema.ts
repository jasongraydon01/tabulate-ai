/**
 * Demo Wizard Form Schema
 *
 * Extends WizardFormSchema with lead capture fields (name, email, company).
 * Used by the /demo page for unauthenticated demo submissions.
 */

import { z } from 'zod';
import { WizardFormSchema } from './wizardSchema';

export const DemoLeadCaptureSchema = z.object({
  demoName: z.string().min(1, 'Name is required'),
  demoEmail: z.string().email('Valid email is required'),
  demoCompany: z.string().optional(),
});

/**
 * Full demo wizard schema = lead capture + standard wizard fields.
 * The `demo` prefix avoids collisions with any existing form fields.
 */
export const DemoWizardFormSchema = WizardFormSchema.merge(DemoLeadCaptureSchema);

export type DemoWizardFormValues = z.infer<typeof DemoWizardFormSchema>;

/**
 * Step 1 validation for demo: lead capture + project setup fields.
 */
export const DemoStep1Schema = DemoLeadCaptureSchema.merge(
  WizardFormSchema.pick({
    projectName: true,
    studyMethodology: true,
    analysisMethod: true,
    isWaveStudy: true,
    bannerMode: true,
  }),
);
