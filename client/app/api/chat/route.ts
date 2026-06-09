import { mastra } from "@/mastra";
import {
  assertUnderUsageCap,
  recordBedrockUsage,
  UsageCapExceededError,
} from "@/lib/usage-cap";
import { NextResponse } from "next/server";
import { toAISdkFormat } from "@mastra/ai-sdk";
import { convertMessages } from "@mastra/core/agent";
import { createUIMessageStreamResponse } from "ai";

const personFinderAgent = mastra.getAgent("personFinderAgent");
const THREAD_ID = "person-finder-thread";
const RESOURCE_ID = "person-finder-chat";

export async function POST(req: Request) {
  try {
    await assertUnderUsageCap();
  } catch (error) {
    if (error instanceof UsageCapExceededError) {
      return NextResponse.json(
        { error: error.message },
        { status: 402 }
      );
    }
    throw error;
  }

  const { messages } = await req.json();

  const stream = await personFinderAgent.stream(messages, {
    memory: {
      thread: THREAD_ID,
      resource: RESOURCE_ID,
    },
    onFinish: async (event) => {
      const usage = event.usage;
      if (!usage) {
        return;
      }
      await recordBedrockUsage({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
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
