import type { StreamTextTransform, ToolSet } from "ai";
import { safeError, WorkflowError } from "./validation";

// Keep native tool events live, but validate the complete prose before displaying
// or persisting it. Tags can arrive split across arbitrary text chunks.
export function conciergeText<TOOLS extends ToolSet>(responseText: (text: string) => string): StreamTextTransform<TOOLS> {
  return () => {
    let text = "";
    const inputErrors = new Map<string, string>();
    return new TransformStream({
      transform(part, controller) {
        if (part.type === "tool-call" && part.invalid) inputErrors.set(part.toolCallId, safeError(part.error));
        if (part.type === "tool-error" && inputErrors.has(part.toolCallId)) {
          controller.enqueue({ ...part, error: new WorkflowError(inputErrors.get(part.toolCallId)!) });
          return;
        }
        if (part.type === "text-start" || part.type === "text-end") return;
        if (part.type === "text-delta") { text += part.text; return; }
        if (part.type === "finish") {
          const response = responseText(text);
          if (response) {
            const id = "concierge-response";
            controller.enqueue({ type: "text-start", id });
            controller.enqueue({ type: "text-delta", id, text: response });
            controller.enqueue({ type: "text-end", id });
          }
        }
        controller.enqueue(part);
      },
    });
  };
}
