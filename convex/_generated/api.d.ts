/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accessRequests from "../accessRequests.js";
import type * as analysisArtifacts from "../analysisArtifacts.js";
import type * as analysisMessages from "../analysisMessages.js";
import type * as analysisSessions from "../analysisSessions.js";
import type * as crons from "../crons.js";
import type * as demoRuns from "../demoRuns.js";
import type * as goldenBaselines from "../goldenBaselines.js";
import type * as orgMemberships from "../orgMemberships.js";
import type * as organizations from "../organizations.js";
import type * as projectConfigValidators from "../projectConfigValidators.js";
import type * as projects from "../projects.js";
import type * as runEvaluations from "../runEvaluations.js";
import type * as runExecutionValidators from "../runExecutionValidators.js";
import type * as runs from "../runs.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tableRegenerations from "../tableRegenerations.js";
import type * as users from "../users.js";
import type * as wincrossPreferenceProfiles from "../wincrossPreferenceProfiles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accessRequests: typeof accessRequests;
  analysisArtifacts: typeof analysisArtifacts;
  analysisMessages: typeof analysisMessages;
  analysisSessions: typeof analysisSessions;
  crons: typeof crons;
  demoRuns: typeof demoRuns;
  goldenBaselines: typeof goldenBaselines;
  orgMemberships: typeof orgMemberships;
  organizations: typeof organizations;
  projectConfigValidators: typeof projectConfigValidators;
  projects: typeof projects;
  runEvaluations: typeof runEvaluations;
  runExecutionValidators: typeof runExecutionValidators;
  runs: typeof runs;
  subscriptions: typeof subscriptions;
  tableRegenerations: typeof tableRegenerations;
  users: typeof users;
  wincrossPreferenceProfiles: typeof wincrossPreferenceProfiles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
