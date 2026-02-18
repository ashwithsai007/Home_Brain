// src/app/page.tsx
// (No background-color changes needed here — leaving as-is.)
// If you want the homepage to also show the same light background while redirecting,
// tell me and I’ll update this too.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const text = await res.text();
        const data = safeJson(text);

        const projects = (data?.projects ?? data ?? []) as any[];
        if (!Array.isArray(projects) || projects.length === 0) {
          router.replace("/chat/new");
          return;
        }

        // Pick newest chat across all projects
        let bestChat: any = null;

        for (const p of projects) {
          const chats = Array.isArray(p?.chats) ? p.chats : [];
          for (const c of chats) {
            if (!bestChat) bestChat = c;
            else if ((c?.updated_at ?? 0) > (bestChat?.updated_at ?? 0)) bestChat = c;
          }
        }

        if (bestChat?.id) router.replace(`/chat/${bestChat.id}`);
        else router.replace("/chat/new");
      } catch {
        router.replace("/chat/new");
      }
    })();
  }, [router]);

  return null;
}