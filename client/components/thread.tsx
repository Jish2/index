"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import user1Image from "../app/user1.png";
import user2Image from "../app/user2.png";
import user3Image from "../app/user3.jpg";
import { useChatReset } from "./chat-reset-context";
import "./thread.css";

interface ProfileData {
  firstName?: string;
  lastName?: string;
  username?: string;
  website?: string;
  email?: string;
  bio?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingText?: string;
  thinkingActive?: boolean;
  profiles?: ProfileData[];
}

type ChatPayloadMessage = {
  role: Message["role"];
  content: string;
};

// Static profile data for testing
const staticProfiles: ProfileData[] = [
  {
    firstName: "Umesh",
    lastName: "Khanna",
    username: "umeshkhanna",
    website: "https://umeshkhanna.dev",
    email: "umesh@example.com",
    bio: "Full-stack developer passionate about building beautiful user experiences. Love working with React and TypeScript.",
  },
  {
    firstName: "Joshua",
    lastName: "Goon",
    username: "joshuagoon",
    website: "https://joshuagoon.io",
    email: "joshua@example.com",
    bio: "Product designer and entrepreneur. Currently building the next generation of design tools.",
  },
  {
    firstName: "Elon",
    lastName: "Musk",
    username: "elonmusk",
    website: "https://elonmusk.com",
    email: "elon@example.com",
    bio: "Data scientist and AI researcher. Exploring the intersection of machine learning and human creativity.",
  },
];

export function Thread() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const isSubmittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageIdCounterRef = useRef(0);
  const lastSubmissionTimeRef = useRef(0);
  const lastSubmissionContentRef = useRef<string>("");
  const populatedMessageIdsRef = useRef<Set<string>>(new Set());
  const chatReset = useChatReset();

  // Register reset function with context
  useEffect(() => {
    if (chatReset) {
      chatReset.registerReset(() => {
        setMessages([]);
        setInput("");
        isSubmittingRef.current = false;
        messageIdCounterRef.current = 0;
        lastSubmissionTimeRef.current = 0;
        lastSubmissionContentRef.current = "";
        populatedMessageIdsRef.current.clear();
      });
    }
  }, [chatReset]);

  // Populate static data when thinking finishes (fallback if stream handler doesn't populate)
  useEffect(() => {
    setMessages((prev) => {
      let hasChanges = false;
      const updated = prev.map((msg) => {
        // If this is an assistant message that just finished thinking and has no profiles yet
        if (
          msg.role === "assistant" &&
          !msg.thinkingActive &&
          !msg.profiles &&
          !populatedMessageIdsRef.current.has(msg.id)
        ) {
          hasChanges = true;
          populatedMessageIdsRef.current.add(msg.id);
          return {
            ...msg,
            profiles: staticProfiles,
          };
        }
        return msg;
      });
      return hasChanges ? updated : prev;
    });
  }, [messages]);

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
                  profiles: staticProfiles, // Populate with static data when thinking ends
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
          profiles: msg.profiles || staticProfiles, // Populate if not already populated
        }));
      } finally {
        updateAssistantMessage((msg) => ({
          ...msg,
          thinkingActive: false,
          profiles: msg.profiles || staticProfiles, // Populate if not already populated
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
        thinkingText: "Working on it...",
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
              Index - Find anyone with a prompt.
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
                (message.thinkingActive || message.thinkingText) &&
                !message.content && (
                  <div className="message-thinking" aria-live="polite">
                    {message.thinkingText || "Thinking..."}
                  </div>
                )}
              {message.content && (
                <div className="message-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
              {message.role === "assistant" && (
                <>
                  {message.thinkingActive && (
                    <div className="profile-cards-container">
                      {/* Skeleton state when thinking */}
                      <div className="profile-card profile-card-skeleton">
                        <div className="profile-card-top">
                          <div className="skeleton-profile-picture-large"></div>
                        </div>
                        <div className="profile-card-bottom">
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-bio"></div>
                        </div>
                      </div>
                      <div className="profile-card profile-card-skeleton">
                        <div className="profile-card-top">
                          <div className="skeleton-profile-picture-large"></div>
                        </div>
                        <div className="profile-card-bottom">
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-bio"></div>
                        </div>
                      </div>
                      <div className="profile-card profile-card-skeleton">
                        <div className="profile-card-top">
                          <div className="skeleton-profile-picture-large"></div>
                        </div>
                        <div className="profile-card-bottom">
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-field"></div>
                          <div className="skeleton-line skeleton-bio"></div>
                        </div>
                      </div>
                    </div>
                  )}
                  {!message.thinkingActive &&
                    message.profiles &&
                    message.profiles.length > 0 && (
                      <div className="profile-cards-container">
                        {/* Actual profile data after loading */}
                        {message.profiles.slice(0, 3).map((profile, index) => {
                          const imageFiles = [
                            user1Image,
                            user2Image,
                            user3Image,
                          ];
                          const imageSrc = imageFiles[index] || imageFiles[0];
                          return (
                            <div key={index} className="profile-card">
                              {/* Top Half - Profile Picture */}
                              <div className="profile-card-top">
                                <div className="profile-picture-large">
                                  <Image
                                    src={imageSrc}
                                    alt={
                                      `${profile.firstName || ""} ${profile.lastName || ""}`.trim() ||
                                      "Profile"
                                    }
                                    fill
                                    className="profile-image"
                                    style={{ objectFit: "cover" }}
                                  />
                                </div>
                              </div>
                              {/* Bottom Half - User Information */}
                              <div className="profile-card-bottom">
                                {(profile.firstName || profile.lastName) && (
                                  <div className="profile-name-line">
                                    {profile.firstName} {profile.lastName}
                                  </div>
                                )}
                                {profile.username && (
                                  <div className="profile-username-line">
                                    @{profile.username}
                                  </div>
                                )}
                                {profile.email && (
                                  <div className="profile-email-line">
                                    {profile.email}
                                  </div>
                                )}
                                {profile.bio && (
                                  <div className="profile-bio-line">
                                    {profile.bio}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input Bar Footer */}
      <div className="thread-footer">{composerForm}</div>
    </div>
  );
}
