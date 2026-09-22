import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { WorkflowError } from "./validation";

/** Findings are data, not actions. Validate JSON locally without requiring provider tool/schema support. */
export async function structuredResult<T>({ model, schema, instructions, messages, maxOutputTokens = 2200 }: {
  model: LanguageModel;
  schema: z.ZodType<T>;
  instructions: string;
  messages: ModelMessage[];
  maxOutputTokens?: number;
}): Promise<T> {
  const result = await generateText({
    model, messages,
    instructions: `${instructions}\nReturn only one JSON object matching this JSON schema. Do not call tools, add prose, or wrap the JSON in Markdown.\n${JSON.stringify(z.toJSONSchema(schema))}`,
    maxRetries: 0, timeout: 60000, maxOutputTokens,
  });
  // Tolerate only a complete Markdown JSON fence; never interpret pseudo-tool calls or partial JSON.
  const text = result.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  const invalid = (message: string): never => {
    // Enough to distinguish truncation from formatting without logging image/prompt/response data.
    console.warn(JSON.stringify({ event: "structured-findings-invalid", finishReason: result.finishReason,
      outputTokens: result.usage.outputTokens, reasoningTokens: result.usage.outputTokenDetails.reasoningTokens, textCharacters: result.text.length }));
    throw new WorkflowError(message, 502);
  };
  if (result.finishReason === "length") return invalid("The model’s findings were cut off at the output limit. Try again; no automatic retry was made.");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { invalid("The model did not return valid JSON findings. Try again; no automatic retry was made."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return invalid("The model returned invalid structured findings. Try again; no automatic retry was made.");
  return parsed.data;
}
