"use client";

import Image from "next/image";
import { useChatReset } from "./chat-reset-context";
import "./site-header.css";

export function SiteHeader() {
  const chatReset = useChatReset();

  const handleLogoClick = () => {
    chatReset?.reset();
  };

  return (
    <header className="site-header">
      <button
        onClick={handleLogoClick}
        className="site-header-logo"
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
    </header>
  );
}
