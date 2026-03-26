import { z } from 'zod';

// Simplified banner plan input schema for agent processing
// Only includes essential fields: groupName, name, original
export const BannerPlanInputSchema = z.object({
  bannerCuts: z.array(z.object({
    groupName: z.string(),
    columns: z.array(z.object({
      name: z.string(),     // "Cards", "PCPs", "HCP"
      original: z.string()  // "S2=1 AND S2a=1", "IF HCP"
    }))
  }))
});

export type BannerPlanInputType = z.infer<typeof BannerPlanInputSchema>;

// Individual banner group schema for group-by-group processing
export const BannerGroupSchema = z.object({
  groupName: z.string(),
  columns: z.array(z.object({
    name: z.string(),
    original: z.string()
  }))
});

export type BannerGroupType = z.infer<typeof BannerGroupSchema>;

// Individual banner column schema
export const BannerColumnSchema = z.object({
  name: z.string(),
  original: z.string()
});

export type BannerColumnType = z.infer<typeof BannerColumnSchema>;

// Schema validation utilities
export const validateBannerPlan = (data: unknown): BannerPlanInputType => {
  return BannerPlanInputSchema.parse(data);
};

export const isValidBannerPlan = (data: unknown): data is BannerPlanInputType => {
  return BannerPlanInputSchema.safeParse(data).success;
};

export const validateBannerGroup = (data: unknown): BannerGroupType => {
  return BannerGroupSchema.parse(data);
};

// Helper functions for banner plan processing
export const getBannerGroups = (bannerPlan: BannerPlanInputType): BannerGroupType[] => {
  return bannerPlan.bannerCuts;
};

export const getGroupByName = (bannerPlan: BannerPlanInputType, groupName: string): BannerGroupType | undefined => {
  return bannerPlan.bannerCuts.find(group => group.groupName === groupName);
};

export const getTotalColumns = (bannerPlan: BannerPlanInputType): number => {
  return bannerPlan.bannerCuts.reduce((total, group) => total + group.columns.length, 0);
};

export const getColumnsByGroup = (group: BannerGroupType): BannerColumnType[] => {
  return group.columns;
};

// Create single-group banner plan for focused processing
export const createSingleGroupBanner = (group: BannerGroupType): BannerPlanInputType => {
  return {
    bannerCuts: [group]
  };
};