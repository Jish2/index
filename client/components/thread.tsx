"use client";

import { useState, useCallback, useRef } from "react";
import "./thread.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function Thread() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const isSubmittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageIdCounterRef = useRef(0);
  const lastSubmissionTimeRef = useRef(0);
  const lastSubmissionContentRef = useRef<string>("");

  const handleSend = useCallback((e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Prevent double submission - check and set atomically
    if (isSubmittingRef.current) {
      return;
    }
    
    // Set flag immediately to prevent duplicate submissions
    isSubmittingRef.current = true;
    
    setInput((currentInput) => {
      if (!currentInput.trim()) {
        isSubmittingRef.current = false;
        return currentInput;
      }

      const messageContent = currentInput.trim();
      const now = Date.now();
      
      // Check if this is a duplicate submission within 500ms with the same content
      if (
        now - lastSubmissionTimeRef.current < 500 &&
        lastSubmissionContentRef.current === messageContent
      ) {
        // This is a duplicate submission - ignore it
        isSubmittingRef.current = false;
        return "";
      }
      
      // Update refs to track this submission
      lastSubmissionTimeRef.current = now;
      lastSubmissionContentRef.current = messageContent;
      
      const userId = `user-${now}-${++messageIdCounterRef.current}`;
      
      const userMessage: Message = {
        id: userId,
        role: "user",
        content: messageContent,
      };

      // Use functional update
      setMessages((prev) => [...prev, userMessage]);

      // Simulate assistant response (no actual backend call)
      const assistantId = `assistant-${now}-${++messageIdCounterRef.current}`;
      setTimeout(() => {
        const assistantMessage: Message = {
          id: assistantId,
          role: "assistant",
          content: "I'm a UI-only version of Grok. Backend integration coming soon!",
        };
        setMessages((prev) => {
          // Check if this assistant message was already added by ID
          if (prev.some((msg) => msg.id === assistantId)) {
            return prev;
          }
          return [...prev, assistantMessage];
        });
        isSubmittingRef.current = false;
      }, 500);

      return "";
    });
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      // Call handleSend directly - the guard will prevent duplicates
      handleSend(e);
    }
  }, [handleSend]);

  const handleFormSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only handle if not already submitting (button click case)
    if (!isSubmittingRef.current) {
      handleSend(e);
    }
  }, [handleSend]);

  const hasMessages = messages.length > 0;

  const composerForm = (
    <form ref={formRef} onSubmit={handleFormSubmit} className="composer-root">
      <button type="button" className="composer-icon-button" aria-label="Attach file">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      
      <button type="submit" className="composer-mic-button" aria-label={hasMessages ? "Send message" : "Search"}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <span className="grok-logo-text">Index - Find someone with a prompt.</span>
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
              <div className="message-content">{message.content}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Input Bar Footer */}
      <div className="thread-footer">
        {composerForm}
      </div>
    </div>
  );
}

