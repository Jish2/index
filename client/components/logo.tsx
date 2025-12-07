"use client";

import Image from "next/image";
import { useChatReset } from "./chat-reset-context";

export function Logo() {
  const chatReset = useChatReset();

  const handleClick = () => {
    if (chatReset) {
      chatReset.reset();
    }
  };

  return (
    <div className="fixed top-0 left-0 z-50 pl-4 pt-3">
      <button
        onClick={handleClick}
        className="cursor-pointer border-none bg-transparent p-0"
        aria-label="Reset chat"
      >
        <Image
          src="/indexai-white-new.png"
          alt="IndexAI Logo"
          width={120}
          height={40}
          priority
          className="h-auto"
        />
      </button>
    </div>
  );
}
