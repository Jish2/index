"use client";

import { useState, useCallback, useRef } from "react";
import "./thread.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingText?: string;
  thinkingActive?: boolean;
}

type ChatPayloadMessage = {
  role: Message["role"];
  content: string;
};

export function Thread() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const isSubmittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageIdCounterRef = useRef(0);
  const lastSubmissionTimeRef = useRef(0);
  const lastSubmissionContentRef = useRef<string>("");

  const streamAssistantResponse = useCallback(
    async ({
      payloadMessages,
      assistantPlaceholderId,
    }: {
      payloadMessages: ChatPayloadMessage[];
      assistantPlaceholderId: string;
    }) => {
      let resolvedAssistantId = assistantPlaceholderId;
      const updateAssistantMessage = (
        updater: (current: Message) => Message
      ) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === resolvedAssistantId ? updater(msg) : msg
          )
        );
      };

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages: payloadMessages }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Unable to reach the Grok backend.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        const flushBuffer = () => {
          while (true) {
            const separatorIndex = buffer.indexOf("\n\n");
            if (separatorIndex === -1) {
              break;
            }

            const rawChunk = buffer.slice(0, separatorIndex).trim();
            buffer = buffer.slice(separatorIndex + 2);

            if (!rawChunk.startsWith("data:")) {
              continue;
            }

            const data = rawChunk.slice(5).trim();
            if (!data) {
              continue;
            }

            if (data === "[DONE]") {
              finished = true;
              break;
            }

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data);
            } catch (error) {
              console.error("Failed to parse Grok stream chunk", error);
              continue;
            }

            switch (parsed.type) {
              case "text-start": {
                const newId = typeof parsed.id === "string" ? parsed.id : null;
                if (newId && newId !== resolvedAssistantId) {
                  const targetId = resolvedAssistantId;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === targetId ? { ...msg, id: newId } : msg
                    )
                  );
                  resolvedAssistantId = newId;
                }
                break;
              }
              case "text-delta": {
                const delta =
                  typeof parsed.delta === "string" ? parsed.delta : "";
                if (delta) {
                  updateAssistantMessage((msg) => ({
                    ...msg,
                    content: msg.content + delta,
                  }));
                }
                break;
              }
              case "reasoning-start": {
                updateAssistantMessage((msg) => ({
                  ...msg,
                  thinkingActive: true,
                  thinkingText: "",
                }));
                break;
              }
              case "reasoning-delta": {
                const reasoningDelta =
                  typeof parsed.delta === "string" ? parsed.delta : "";
                if (reasoningDelta) {
                  updateAssistantMessage((msg) => ({
                    ...msg,
                    thinkingText: `${msg.thinkingText ?? ""}${reasoningDelta}`,
                  }));
                }
                break;
              }
              case "reasoning-end": {
                updateAssistantMessage((msg) => ({
                  ...msg,
                  thinkingActive: false,
                }));
                break;
              }
              case "error": {
                const errorText =
                  typeof parsed.errorText === "string"
                    ? parsed.errorText
                    : "The assistant returned an error.";
                updateAssistantMessage((msg) => ({
                  ...msg,
                  content: errorText,
                  thinkingActive: false,
                }));
                finished = true;
                break;
              }
              default:
                break;
            }
          }
        };

        while (!finished) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            flushBuffer();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          flushBuffer();
        }

        reader.releaseLock();
      } catch (error) {
        console.error("Error while streaming from Grok:", error);
        const fallbackMessage =
          "Sorry, something went wrong while contacting Grok. Please try again.";
        updateAssistantMessage((msg) => ({
          ...msg,
          content: fallbackMessage,
          thinkingActive: false,
        }));
      } finally {
        updateAssistantMessage((msg) => ({
          ...msg,
          thinkingActive: false,
        }));
        isSubmittingRef.current = false;
      }
    },
    []
  );

  const handleSend = useCallback(
    (e?: React.FormEvent | React.KeyboardEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (isSubmittingRef.current) {
        return;
      }

      const messageContent = input.trim();
      if (!messageContent) {
        return;
      }

      const now = Date.now();
      if (
        now - lastSubmissionTimeRef.current < 500 &&
        lastSubmissionContentRef.current === messageContent
      ) {
        return;
      }

      lastSubmissionTimeRef.current = now;
      lastSubmissionContentRef.current = messageContent;

      const userId = `user-${now}-${++messageIdCounterRef.current}`;
      const assistantId = `assistant-${now}-${++messageIdCounterRef.current}`;

      const userMessage: Message = {
        id: userId,
        role: "user",
        content: messageContent,
      };

      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        thinkingActive: true,
        thinkingText: "Connecting to Grok...",
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput("");

      isSubmittingRef.current = true;

      const payloadMessages: ChatPayloadMessage[] = [
        ...messages,
        userMessage,
      ].map(({ role, content }) => ({
        role,
        content,
      }));

      streamAssistantResponse({
        payloadMessages,
        assistantPlaceholderId: assistantId,
      });
    },
    [input, messages, streamAssistantResponse]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        // Call handleSend directly - the guard will prevent duplicates
        handleSend(e);
      }
    },
    [handleSend]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only handle if not already submitting (button click case)
      if (!isSubmittingRef.current) {
        handleSend(e);
      }
    },
    [handleSend]
  );

  const hasMessages = messages.length > 0;

  const composerForm = (
    <form ref={formRef} onSubmit={handleFormSubmit} className="composer-root">
      <button
        type="button"
        className="composer-icon-button"
        aria-label="Attach file"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      <textarea
        className="composer-input"
        placeholder="Who are you looking for?"
        value={input}
        onChange={handleInputChange}
        rows={1}
        onKeyDown={handleKeyDown}
      />

      <button
        type="submit"
        className="composer-mic-button"
        aria-label={hasMessages ? "Send message" : "Search"}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );

  if (!hasMessages) {
    // Centered layout when no messages
    return (
      <div className="thread-root thread-root-empty">
        <div className="thread-centered">
          <div className="grok-logo-container">
            <span className="grok-logo-text">
              Index - Find someone with a prompt.
            </span>
          </div>
          <div className="thread-footer thread-footer-centered">
            {composerForm}
          </div>
        </div>
      </div>
    );
  }

  // Normal layout when there are messages - centered like Grok
  return (
    <div className="thread-root thread-root-with-messages">
      {/* Grok Logo Header */}
      <div className="grok-header">
        <div className="grok-logo-container">
          <span className="grok-logo-text">index</span>
        </div>
      </div>

      {/* Messages Area - Centered */}
      <div className="thread-viewport">
        <div className="messages-container-centered">
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user" ? "message-user" : "message-assistant"
              }
            >
              {message.role === "assistant" &&
                (message.thinkingActive || message.thinkingText) && (
                  <div className="message-thinking" aria-live="polite">
                    <div className="message-thinking-header">
                      <span className="message-thinking-spinner" />
                      <span className="message-thinking-label">
                        {message.thinkingActive
                          ? "Thinking"
                          : "Thought process"}
                      </span>
                    </div>
                    {message.thinkingText ? (
                      <div className="message-thinking-text">
                        {message.thinkingText}
                      </div>
                    ) : null}
                  </div>
                )}
              <div className="message-content">
                {message.content || (message.thinkingActive ? "..." : "")}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Input Bar Footer */}
      <div className="thread-footer">{composerForm}</div>
    </div>
  );
}
