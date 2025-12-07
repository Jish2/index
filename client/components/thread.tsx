"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatReset } from "./chat-reset-context";
import "./thread.css";

interface ProfileData {
  id: string;
  name?: string | null;
  username?: string | null;
  location?: string | null;
  followers?: number | null;
  derivedRole?: string | null;
  derivedTopics?: string[] | null;
  summary?: string | null;
  profileImageUrl?: string | null;
  similarity?: number | null;
  url?: string | null;
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

interface ProfileCardProps {
  profile: ProfileData;
  index: number;
}

function formatFollowers(value?: number | null) {
  if (value == null) return null;
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toString();
}

function getInitials(name?: string | null, username?: string | null) {
  const source = name?.trim() || username?.trim();
  if (!source) return "??";

  const parts = source.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function ProfileCard({ profile }: ProfileCardProps) {
  const initials = useMemo(
    () => getInitials(profile.name, profile.username),
    [profile.name, profile.username]
  );
  const topics = profile.derivedTopics?.slice(0, 4) ?? [];
  const followerLabel = formatFollowers(profile.followers);
  const relevance =
    profile.similarity != null
      ? `${Math.round(profile.similarity * 100)}%`
      : null;

  const cacheKey = profile.username || profile.id;
  const [imageSrc, setImageSrc] = useState<string | null>(
    profile.profileImageUrl ?? null
  );
  const [hasTriedFetching, setHasTriedFetching] = useState(
    Boolean(profile.profileImageUrl)
  );

  useEffect(() => {
    setImageSrc(profile.profileImageUrl ?? null);
    setHasTriedFetching(Boolean(profile.profileImageUrl));
  }, [profile.profileImageUrl, cacheKey]);

  useEffect(() => {
    if (imageSrc || hasTriedFetching) {
      return;
    }
    if (!cacheKey) {
      setHasTriedFetching(true);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const params = profile.username
          ? `username=${encodeURIComponent(profile.username)}`
          : `userId=${encodeURIComponent(profile.id)}`;
        const response = await fetch(`/api/profile-image?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to fetch profile image");
        }
        const data = (await response.json()) as {
          profileImageUrl?: string | null;
        };
        if (!isCancelled) {
          setImageSrc(data.profileImageUrl ?? null);
          setHasTriedFetching(true);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error("Profile image fetch failed:", error);
          setHasTriedFetching(true);
        }
      }
    })();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [cacheKey, imageSrc, hasTriedFetching, profile.id, profile.username]);

  const hasImage = Boolean(imageSrc);

  return (
    <div className="profile-card">
      <div className="profile-card-top">
        <div className="profile-picture-large">
          {hasImage ? (
            <Image
              src={imageSrc as string}
              alt={profile.name ?? profile.username ?? "Profile"}
              fill
              className="profile-image"
              style={{ objectFit: "cover" }}
              unoptimized
            />
          ) : (
            <div className="profile-placeholder">
              <span>{initials}</span>
            </div>
          )}
        </div>
      </div>
      <div className="profile-card-bottom">
        {profile.name && (
          <div className="profile-name-line">
            {profile.name}
            {profile.derivedRole && (
              <span className="profile-role-pill">{profile.derivedRole}</span>
            )}
          </div>
        )}
        {profile.username && (
          <div className="profile-username-line">@{profile.username}</div>
        )}
        <div className="profile-meta-grid">
          {profile.location && (
            <div className="profile-meta">
              <span className="profile-meta-label">Location</span>
              <span>{profile.location}</span>
            </div>
          )}
          {followerLabel && (
            <div className="profile-meta">
              <span className="profile-meta-label">Followers</span>
              <span>{followerLabel}</span>
            </div>
          )}
          {relevance && (
            <div className="profile-meta">
              <span className="profile-meta-label">Relevance</span>
              <span>{relevance}</span>
            </div>
          )}
        </div>
        {topics.length > 0 && (
          <div className="profile-topics">
            {topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        )}
        {profile.summary && (
          <div className="profile-bio-line">{profile.summary}</div>
        )}
        {profile.url && (
          <a
            className="profile-link"
            href={profile.url}
            target="_blank"
            rel="noreferrer"
          >
            View profile
          </a>
        )}
      </div>
    </div>
  );
}

type PeopleToolResult = {
  xUserId: string;
  username: string | null;
  name: string | null;
  location: string | null;
  derivedRole: string | null;
  derivedTopics: string[] | null;
  followers: number | null;
  similarity: number | null;
  summary: string | null;
  profileImageUrl: string | null;
  url: string | null;
};

function mapToolResultsToProfiles(results: PeopleToolResult[]): ProfileData[] {
  return results.map((result) => ({
    id: result.xUserId,
    name: result.name,
    username: result.username,
    location: result.location,
    derivedRole: result.derivedRole,
    derivedTopics: result.derivedTopics,
    followers: result.followers,
    similarity: result.similarity,
    summary: result.summary,
    profileImageUrl: result.profileImageUrl,
    url:
      result.url ??
      (result.username ? `https://x.com/${result.username}` : null),
  }));
}

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
              case "data-tool-people": {
                const data = parsed.data;
                if (
                  data &&
                  Array.isArray((data as { results?: unknown }).results)
                ) {
                  const profiles = mapToolResultsToProfiles(
                    (data as { results: PeopleToolResult[] }).results
                  );
                  updateAssistantMessage((msg) => {
                    if (populatedMessageIdsRef.current.has(msg.id)) {
                      return { ...msg, profiles };
                    }
                    populatedMessageIdsRef.current.add(msg.id);
                    return {
                      ...msg,
                      profiles,
                    };
                  });
                }
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
    (e?: React.FormEvent | React.KeyboardEvent, messageOverride?: string) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (isSubmittingRef.current) {
        return;
      }

      const messageContent = (messageOverride || input).trim();
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

  const handleHintClick = useCallback(
    (hintText: string) => {
      setInput(hintText);
      // Automatically send the message with the hint text
      handleSend(undefined, hintText);
    },
    [handleSend]
  );

  const hasMessages = messages.length > 0;
  const githubLink = (
    <a
      className="github-link"
      href="https://github.com/jish2/index"
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Open the Index project on GitHub"
      title="View the project on GitHub"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        aria-hidden="true"
      >
        <path d="M12 .5C5.648.5.5 5.648.5 12c0 5.086 3.292 9.389 7.865 10.909.575.107.785-.25.785-.556 0-.274-.01-1-.015-1.962-3.2.696-3.877-1.543-3.877-1.543-.523-1.329-1.278-1.684-1.278-1.684-1.045-.714.08-.699.08-.699 1.156.081 1.765 1.188 1.765 1.188 1.029 1.763 2.7 1.254 3.36.959.104-.746.403-1.254.732-1.543-2.554-.29-5.238-1.277-5.238-5.684 0-1.256.448-2.284 1.182-3.088-.118-.29-.512-1.458.112-3.04 0 0 .964-.309 3.162 1.179a10.98 10.98 0 0 1 5.756 0c2.197-1.488 3.16-1.18 3.16-1.18.626 1.583.232 2.752.114 3.042.736.804 1.182 1.832 1.182 3.088 0 4.419-2.69 5.39-5.254 5.675.414.357.783 1.062.783 2.142 0 1.546-.014 2.792-.014 3.172 0 .309.208.67.79.555C20.21 21.384 23.5 17.084 23.5 12c0-6.352-5.148-11.5-11.5-11.5Z" />
      </svg>
    </a>
  );

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
        {githubLink}
        <div className="thread-centered">
          <div className="grok-logo-container">
            <span className="grok-logo-text">
              Index - Find anyone with a prompt.
            </span>
          </div>
          <div className="thread-footer thread-footer-centered">
            {composerForm}
            <div className="hints-container">
              <button
                type="button"
                className="hint-pill"
                onClick={() =>
                  handleHintClick("SWE in Palo Alto who attended Stanford")
                }
              >
                SWE in Palo Alto who attended Stanford
              </button>
              <button
                type="button"
                className="hint-pill"
                onClick={() =>
                  handleHintClick(
                    "Senior SWE with ML Background in Mountain View"
                  )
                }
              >
                Senior SWE with ML Background in Mountain View
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal layout when there are messages - centered like Grok
  return (
    <div className="thread-root thread-root-with-messages">
      {githubLink}
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
                    {message.thinkingActive && (
                      <span className="thinking-dot" aria-hidden="true" />
                    )}
                    <span>{message.thinkingText || "Thinking..."}</span>
                  </div>
                )}
              {message.content && (
                <div className="message-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
              {message.role === "assistant" &&
                !message.thinkingActive &&
                message.profiles &&
                message.profiles.length > 0 && (
                  <div className="profile-cards-container">
                    {message.profiles.slice(0, 3).map((profile, index) => (
                      <ProfileCard
                        key={`${profile.id}-${index}`}
                        profile={profile}
                        index={index}
                      />
                    ))}
                  </div>
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
