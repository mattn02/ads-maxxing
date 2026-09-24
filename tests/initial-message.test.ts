import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { scheduleInitialMessage } from "../lib/workspace/initial-message";

test("new-session first message survives Strict Mode cleanup and dispatches once", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: { id: string; message: { role: string; parts: { type: string; text: string }[] } }[] = [];
  const chat = new Chat({ id: "new-campaign", transport: new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, message: messages.at(-1) } }),
    fetch: async (url, init) => {
      assert.equal(url, "/api/chat");
      requests.push(JSON.parse(init!.body as string));
      return new Response('data: {"type":"start","messageId":"reply"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      });
    },
  }) });
  const sent = { current: false };
  let pending = Promise.resolve();
  const mount = () => scheduleInitialMessage(sent, () => { pending = chat.sendMessage({ text: "Research https://www.loopycases.com" }); });
  // React runs setup -> cleanup -> setup. useChat also calls stop in cleanup.
  const cancelFirstMount = mount();
  cancelFirstMount();
  await chat.stop();
  t.mock.timers.tick(0);
  assert.equal(sent.current, false);
  assert.equal(requests.length, 0);
  const cancelSecondMount = mount();
  t.mock.timers.tick(0);
  await pending;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, "new-campaign");
  assert.deepEqual(requests[0].message.parts, [{ type: "text", text: "Research https://www.loopycases.com" }]);
  assert.equal(requests[0].message.role, "user");
  // A later effect rerun must never duplicate the initial research request.
  cancelSecondMount();
  const cancelRerun = mount();
  t.mock.timers.tick(0);
  assert.equal(requests.length, 1);
  cancelRerun();
});
