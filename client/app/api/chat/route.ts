// import { streamText } from "ai";
// import { openai } from "@ai-sdk/openai";

// export async function POST(req: Request) {
//   const { messages } = await req.json();

//   const result = streamText({
//     model: openai('gpt-4o-mini'),
//     messages,
//   });

//   return result.toDataStreamResponse();
// }

import { mastra } from "@/mastra";
import { NextResponse } from "next/server";
import { toAISdkFormat } from "@mastra/ai-sdk";
import { convertMessages } from "@mastra/core/agent";
import { createUIMessageStreamResponse } from "ai";

const personFinderAgent = mastra.getAgent("personFinderAgent");
const THREAD_ID = "person-finder-thread";
const RESOURCE_ID = "person-finder-chat";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const stream = await personFinderAgent.stream(messages, {
    memory: {
      thread: THREAD_ID,
      resource: RESOURCE_ID,
    },
  });

  return createUIMessageStreamResponse({
    stream: toAISdkFormat(stream, { from: "agent" }),
  });
}

export async function GET() {
  const memory = await personFinderAgent.getMemory();
  const response = await memory?.query({
    threadId: THREAD_ID,
    resourceId: RESOURCE_ID,
  });

  const uiMessages = convertMessages(response?.uiMessages ?? []).to("AIV5.UI");
  return NextResponse.json(uiMessages);
}
