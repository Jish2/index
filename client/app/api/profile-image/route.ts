import { NextResponse } from "next/server";

const X_API_BASE = "https://api.x.com/2";

function upgradeProfileImageUrl(url?: string | null) {
  if (!url) return null;

  // Twitter/X profile URLs typically end with "_normal", "_bigger", etc.
  // Removing the suffix returns the original full-resolution avatar.
  return url.replace(/_(normal|bigger|mini)\./, ".");
}

async function fetchProfileImage({
  username,
  userId,
}: {
  username?: string | null;
  userId?: string | null;
}) {
  const token = process.env.X_API_BEARER_TOKEN;
  if (!token) {
    throw new Error("X_API_BEARER_TOKEN environment variable is not set");
  }

  let url: string;
  if (username) {
    url = `${X_API_BASE}/users/by/username/${encodeURIComponent(
      username
    )}?user.fields=profile_image_url`;
  } else if (userId) {
    url = `${X_API_BASE}/users/${encodeURIComponent(
      userId
    )}?user.fields=profile_image_url`;
  } else {
    return null;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `X API request failed (${response.status}): ${message || "Unknown error"}`
    );
  }

  const data = (await response.json()) as {
    data?: { profile_image_url?: string };
  };

  return upgradeProfileImageUrl(data.data?.profile_image_url ?? null);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username");
  const userId = url.searchParams.get("userId");

  if (!username && !userId) {
    return NextResponse.json(
      { error: "username or userId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const profileImageUrl = await fetchProfileImage({ username, userId });
    return NextResponse.json({ profileImageUrl });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch profile image",
      },
      { status: 500 }
    );
  }
}
