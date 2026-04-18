import { tool } from "ai";
import { z } from "zod";

export interface AnalysisScratchpadEntry {
  timestamp: string;
  action: "add" | "review" | "read";
  content: string;
}

export function createAnalysisScratchpadTool() {
  const entries: AnalysisScratchpadEntry[] = [];

  return {
    tool: tool({
      description:
        "Internal reasoning space. Use \"add\" to log analytical reasoning before answering. " +
        "Use \"review\" to self-audit your planned response. " +
        "Use \"read\" to retrieve previous entries. " +
        "Invisible to the user.",
      inputSchema: z.object({
        action: z.enum(["add", "review", "read"]),
        content: z.string().describe("Reasoning content (for add/review) or brief note (for read)."),
      }),
      execute: async ({ action, content }) => {
        const timestamp = new Date().toISOString();

        if (action === "read") {
          if (entries.length === 0) return "[Read] No entries yet.";
          const formatted = entries
            .map((entry, index) => `[${index + 1}] (${entry.action}) ${entry.content}`)
            .join("\n\n");
          return `[Read] ${entries.length} entries:\n\n${formatted}`;
        }

        entries.push({ timestamp, action, content });
        console.log(`[AnalysisAgent Scratchpad] ${action}: ${content}`);

        return action === "add"
          ? `[Thinking] Added: ${content}`
          : `[Review] ${content}`;
      },
    }),
    getEntries: () => [...entries],
  };
}
