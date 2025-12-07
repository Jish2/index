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

const weatherAgent = mastra.getAgent("weatherAgent");

export async function POST(req: Request) {
  const { messages } = await req.json();

  const stream = await weatherAgent.stream(messages, {
    memory: {
      thread: "example-user-id",
      resource: "weather-chat",
    },
  });

  return createUIMessageStreamResponse({
    stream: toAISdkFormat(stream, { from: "agent" }),
  });
}

export async function GET() {
  const memory = await weatherAgent.getMemory();
  const response = await memory?.query({
    threadId: "example-user-id",
    resourceId: "weather-chat",
  });

  const uiMessages = convertMessages(response?.uiMessages ?? []).to("AIV5.UI");
  return NextResponse.json(uiMessages);
}
