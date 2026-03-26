import { z } from 'zod';

// Simplified data map schema for agent processing
// Only includes essential fields needed for variable validation
export const DataMapItemSchema = z.object({
  Level: z.string().optional(),       // "parent" | "sub"
  ParentQ: z.string().optional(),     // Parent question id/name
  Column: z.string(),                 // Variable name: "S2", "S2a", "A3r1"
  Description: z.string(),            // Question text
  Value_Type: z.string().optional(),  // e.g., "Values: 0-1"
  Answer_Options: z.string().optional(), // "1=Cardiologist,2=..."
  Context: z.string().optional(),
  Type: z.string().optional()            // normalizedType: binary_flag, categorical_select, numeric_range
});

export const DataMapSchema = z.array(DataMapItemSchema);

export type DataMapType = z.infer<typeof DataMapSchema>;

// Individual data map item type for easier handling
export type DataMapItemType = z.infer<typeof DataMapItemSchema>;

// Schema validation utilities
export const validateDataMap = (data: unknown): DataMapType => {
  return DataMapSchema.parse(data);
};

export const isValidDataMap = (data: unknown): data is DataMapType => {
  return DataMapSchema.safeParse(data).success;
};

// Helper functions for data map processing
export const findVariable = (dataMap: DataMapType, columnName: string): DataMapItemType | undefined => {
  return dataMap.find(item => item.Column.toLowerCase() === columnName.toLowerCase());
};

export const getVariableNames = (dataMap: DataMapType): string[] => {
  return dataMap.map(item => item.Column);
};

export const searchByDescription = (dataMap: DataMapType, searchTerm: string): DataMapItemType[] => {
  const term = searchTerm.toLowerCase();
  return dataMap.filter(item => 
    item.Description.toLowerCase().includes(term) ||
    (item.Answer_Options ? item.Answer_Options.toLowerCase().includes(term) : false)
  );
};