"use client";

import { createContext, useContext, useRef, ReactNode } from "react";

interface ChatResetContextType {
  registerReset: (resetFn: () => void) => void;
  reset: () => void;
}

const ChatResetContext = createContext<ChatResetContextType | null>(null);

export function ChatResetProvider({ children }: { children: ReactNode }) {
  const resetFnRef = useRef<(() => void) | null>(null);

  const registerReset = (resetFn: () => void) => {
    resetFnRef.current = resetFn;
  };

  const reset = () => {
    if (resetFnRef.current) {
      resetFnRef.current();
    }
  };

  return (
    <ChatResetContext.Provider value={{ registerReset, reset }}>
      {children}
    </ChatResetContext.Provider>
  );
}

export function useChatReset() {
  const context = useContext(ChatResetContext);
  if (!context) {
    return null;
  }
  return context;
}
