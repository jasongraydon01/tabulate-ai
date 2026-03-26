import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Disable base ESLint rule in favor of TypeScript-specific version
      "no-unused-vars": "off",
      
      // Configure TypeScript ESLint to ignore underscore-prefixed variables
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "args": "all",
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_", 
          "caughtErrors": "all",
          "caughtErrorsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_"
        }
      ]
    }
  },
  {
    files: [
      "src/lib/v3/runtime/**/*.ts",
      "src/lib/pipeline/PipelineRunner.ts",
      "src/lib/api/pipelineOrchestrator.ts",
      "src/lib/api/reviewCompletion.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/tables/DataMapGrouper", "@/lib/tables/DataMapGrouper"],
              message: "Use the transitional adapter at src/lib/v3/runtime/questionId/groupingAdapter.ts."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/lib/v3/runtime/questionId/groupingAdapter.ts"],
    rules: {
      "no-restricted-imports": "off"
    }
  }
];

export default eslintConfig;
