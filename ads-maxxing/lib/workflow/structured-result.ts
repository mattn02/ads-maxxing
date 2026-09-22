import { generateText, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { WorkflowError } from "./validation";

/** Free Gateway models support function tools even when JSON-schema output is rejected. */
export async function structuredResult<T>({ model, schema, instructions, messages }: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  instructions: string;
  messages: ModelMessage[];
}): Promise<T> {
  const result = await generateText({
    model, instructions, messages,
    tools: { submitResult: tool({ description: "Return the requested findings using this schema.", inputSchema: schema }) },
    toolChoice: { type: "tool", toolName: "submitResult" },
    maxRetries: 0, timeout: 60000, maxOutputTokens: 2200,
  });
  const call = result.toolCalls.find(call => call.toolName === "submitResult");
  if (!call) throw new WorkflowError("The model did not return structured findings. Try again; no automatic retry was made.", 502);
  const parsed = schema.safeParse(call.input);
  if (!parsed.success) throw new WorkflowError("The model returned invalid structured findings. Try again; no automatic retry was made.", 502);
  return parsed.data;
}
