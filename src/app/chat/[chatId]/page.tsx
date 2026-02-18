// src/app/chat/[chatId]/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

type Mode = "normal" | "code";
type Theme = "dark" | "light";
type Provider = "openai" | "claude";

type ChatMeta = {
  id: string;
  project_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

type Project = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  chats: ChatMeta[];
};

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
};

type ChatPayload = {
  chat: ChatMeta;
  messages: Msg[];
};

function now() {
  return Date.now();
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shortTitle(s: string, max = 28) {
  const t = (s || "New chat").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function deriveTitleFromPrompt(prompt: string) {
  const cleaned = String(prompt || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");

  if (!cleaned) return "New chat";
  const words = cleaned.split(" ").slice(0, 7).join(" ");
  const maxChars = 42;
  return words.length <= maxChars ? words : words.slice(0, maxChars - 1) + "…";
}

function upsertTab(list: ChatMeta[], tab: ChatMeta): ChatMeta[] {
  const id = String(tab.id);
  const existingIdx = list.findIndex((x) => String(x.id) === id);
  const next = existingIdx >= 0 ? [...list] : [tab, ...list];
  if (existingIdx >= 0) {
    next.splice(existingIdx, 1);
    next.unshift(tab);
  }
  return next;
}

function removeTab(list: ChatMeta[], id: string) {
  return list.filter((t) => String(t.id) !== String(id));
}

function getStoredTabs(): ChatMeta[] {
  try {
    const raw = localStorage.getItem("hb_tabs");
    if (!raw) return [];
    const parsed = safeJsonParse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatMeta[];
  } catch {
    return [];
  }
}

function storeTabs(tabs: ChatMeta[]) {
  try {
    localStorage.setItem("hb_tabs", JSON.stringify(tabs));
  } catch {}
}

function CopyButton({ text, theme }: { text: string; theme: Theme }) {
  const [ok, setOk] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 900);
    } catch {}
  }

  const cls =
    theme === "light"
      ? "text-[11px] px-2 py-1 rounded-md border border-black/10 bg-black/5 hover:bg-black/10 text-zinc-700"
      : "text-[11px] px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200";

  return (
    <button onClick={copy} className={cls} title="Copy" type="button">
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

function MarkdownBubble({
  role,
  content,
  theme,
}: {
  role: Msg["role"];
  content: string;
  theme: Theme;
}) {
  const isUser = role === "user";

  const bubbleCls =
    theme === "light"
      ? [
          "max-w-[820px] w-fit rounded-2xl px-5 py-4 shadow-sm border",
          isUser
            ? "bg-indigo-50 border-indigo-100 text-zinc-900"
            : "bg-white border-black/10 text-zinc-900",
        ].join(" ")
      : [
          "max-w-[820px] w-fit rounded-2xl px-5 py-4 shadow-sm border",
          isUser
            ? "bg-white/10 border-white/10 text-zinc-100"
            : "bg-black/40 border-white/10 text-zinc-100",
        ].join(" ");

  const pCls = theme === "light" ? "my-2 leading-7 text-zinc-900" : "my-2 leading-7 text-zinc-100";
  const ulCls =
    theme === "light"
      ? "my-2 ml-5 list-disc space-y-1 text-zinc-900"
      : "my-2 ml-5 list-disc space-y-1 text-zinc-100";
  const olCls =
    theme === "light"
      ? "my-2 ml-5 list-decimal space-y-1 text-zinc-900"
      : "my-2 ml-5 list-decimal space-y-1 text-zinc-100";
  const linkCls =
    theme === "light"
      ? "text-indigo-600 hover:text-indigo-500 underline underline-offset-4"
      : "text-sky-300 hover:text-sky-200 underline underline-offset-4";
  const hrCls = theme === "light" ? "my-4 border-black/10" : "my-4 border-white/10";

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"} my-3`}>
      <div className={bubbleCls}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="text-xl font-semibold mt-4 mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-semibold mt-4 mb-2">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-2">{children}</h3>,
            hr: () => <hr className={hrCls} />,
            p: ({ children }) => <p className={pCls}>{children}</p>,
            ul: ({ children }) => <ul className={ulCls}>{children}</ul>,
            ol: ({ children }) => <ol className={olCls}>{children}</ol>,
            li: ({ children }) => (
              <li className={theme === "light" ? "leading-7 text-zinc-900" : "leading-7 text-zinc-100"}>
                {children}
              </li>
            ),
            a: ({ children, href }) => (
              <a href={href} className={linkCls} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
            code: ({ children, className }) => {
              const raw = String(children ?? "");
              const match = /language-(\w+)/.exec(className ?? "");
              const lang = match?.[1] ?? "";
              const isInline = !match && !raw.includes("\n");

              if (isInline) {
                const inlineCls =
                  theme === "light"
                    ? "px-1.5 py-[2px] rounded-md bg-black/5 border border-black/10 text-zinc-900 text-[12.5px] font-mono"
                    : "px-1.5 py-[2px] rounded-md bg-white/5 border border-white/10 text-zinc-100 text-[12.5px] font-mono";
                return <code className={inlineCls}>{raw}</code>;
              }

              return (
                <div className="my-3 rounded-xl overflow-hidden border border-white/10 bg-black/95">
                  <div className="px-3 py-2 flex items-center justify-between border-b border-white/10 bg-white/5">
                    <div className="text-xs text-zinc-200 font-mono">{lang || "code"}</div>
                    <CopyButton text={raw.replace(/\n$/, "")} theme={theme} />
                  </div>

                  <SyntaxHighlighter
                    language={lang || undefined}
                    style={vscDarkPlus}
                    customStyle={{
                      margin: 0,
                      background: "transparent",
                      padding: "14px 14px",
                      fontSize: "13px",
                      lineHeight: "1.65",
                    }}
                  >
                    {raw.replace(/\n$/, "")}
                  </SyntaxHighlighter>
                </div>
              );
            },
            blockquote: ({ children }) => (
              <blockquote
                className={
                  theme === "light"
                    ? "my-3 pl-4 border-l-2 border-black/20 text-zinc-700"
                    : "my-3 pl-4 border-l-2 border-white/20 text-zinc-200/90"
                }
              >
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div
                className={
                  theme === "light"
                    ? "my-3 overflow-auto rounded-xl border border-black/10 bg-white"
                    : "my-3 overflow-auto rounded-xl border border-white/10 bg-black/40"
                }
              >
                <table className="w-full text-sm">{children}</table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className={theme === "light" ? "bg-black/5" : "bg-white/5"}>{children}</thead>
            ),
            th: ({ children }) => (
              <th
                className={
                  theme === "light"
                    ? "text-left px-3 py-2 border-b border-black/10 font-semibold text-zinc-900"
                    : "text-left px-3 py-2 border-b border-white/10 font-semibold text-zinc-200"
                }
              >
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td
                className={
                  theme === "light"
                    ? "px-3 py-2 border-b border-black/10 text-zinc-800"
                    : "px-3 py-2 border-b border-white/10 text-zinc-200/90"
                }
              >
                {children}
              </td>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const params = useParams() as { chatId?: string | string[] };
  const routeChatId = Array.isArray(params?.chatId) ? params.chatId[0] : params?.chatId;

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");

  const [tabs, setTabs] = useState<ChatMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  const [mode, setMode] = useState<Mode>("normal");
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<string>("gpt-5-mini");
  const [web, setWeb] = useState<boolean>(false);
  const [sending, setSending] = useState(false);

  // status indicator ("Browsing…")
  const [statusLine, setStatusLine] = useState<string>("");
  const clearedStatusRef = useRef(false);

  const [chat, setChat] = useState<ChatMeta | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);

  const [editorText, setEditorText] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [theme, setTheme] = useState<Theme>("dark");

  const abortRef = useRef<AbortController | null>(null);
  const didInitialScrollRef = useRef(false);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || projects[0],
    [projects, activeProjectId]
  );

  // keep model valid when provider changes
  useEffect(() => {
    if (provider === "openai") {
      const allow = new Set(["gpt-5-mini", "gpt-5.2", "gpt-4.1"]);
      if (!allow.has(model)) setModel("gpt-5-mini");
    } else {
      const allow = new Set(["claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805"]);
      if (!allow.has(model)) setModel("claude-sonnet-4-5-20250929");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  function autosizeEditor() {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "0px";
    const max = 180;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
  }

  function collapseEditor() {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "44px";
  }

  async function refreshProjects() {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(text || "Failed to load projects");

    const data = safeJsonParse(text);
    const list: Project[] = (data?.projects ?? data ?? []) as Project[];
    setProjects(list);

    if (!activeProjectId && list[0]?.id) setActiveProjectId(String(list[0].id));
    return list;
  }

  async function loadChat(chatId: string) {
    if (!chatId) return;

    didInitialScrollRef.current = false;

    if (chatId === "new") {
      setChat(null);
      setMessages([]);
      setActiveTabId("");
      return;
    }

    const res = await fetch(`/api/chats/${chatId}`, { cache: "no-store" });
    const text = await res.text().catch(() => "");

    // ✅ FIX: if chat not found (DB reset / deleted), redirect cleanly and remove dead tab
    if (!res.ok) {
      if (res.status === 404) {
        setTabs((prev) => {
          const next = removeTab(prev, chatId);
          storeTabs(next);
          return next;
        });
        setChat(null);
        setMessages([]);
        setActiveTabId("");
        router.replace("/chat/new");
        return;
      }
      throw new Error(text || `Failed to load chat (HTTP ${res.status})`);
    }

    const data = safeJsonParse(text) as ChatPayload | null;
    if (!data?.chat?.id) throw new Error("Unexpected chat payload shape");

    setChat(data.chat);
    setMessages(data.messages || []);

    if (data.chat.project_id) setActiveProjectId(String(data.chat.project_id));

    setTabs((prev) => {
      const next = upsertTab(prev, data.chat);
      storeTabs(next);
      return next;
    });

    setActiveTabId(String(data.chat.id));
  }

  // initial scroll after load
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!scrollRef.current) return;
    if (messages.length === 0) return;

    didInitialScrollRef.current = true;
    requestAnimationFrame(() => {
      const el = scrollRef.current!;
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, messages]);

  async function createProject(): Promise<string | null> {
    const name = (prompt("Project name?") || "").trim();
    if (!name) return null;

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const text = await res.text().catch(() => "");
    const parsed = safeJsonParse(text) ?? {};
    if (!res.ok) {
      alert(parsed?.error || text || "Failed to create project");
      return null;
    }

    const created = parsed?.project || parsed;
    const id = created?.id ? String(created.id) : null;

    await refreshProjects();
    if (id) setActiveProjectId(id);
    return id;
  }

  async function createChat(projectId: string): Promise<string | null> {
    const res = await fetch(`/api/projects/${projectId}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New chat" }),
    });

    const text = await res.text().catch(() => "");
    const parsed = safeJsonParse(text) ?? {};

    if (!res.ok) {
      alert(parsed?.error || text || "Failed to create chat");
      return null;
    }

    const createdId =
      (parsed?.chatId ? String(parsed.chatId) : null) ??
      (parsed?.chat?.id ? String(parsed.chat.id) : null);

    if (!createdId) {
      console.error("createChat unexpected response:", parsed);
      alert("Create chat returned unexpected JSON.");
      return null;
    }

    await refreshProjects();

    const meta: ChatMeta = {
      id: createdId,
      project_id: projectId,
      title: "New chat",
      created_at: now(),
      updated_at: now(),
    };

    setTabs((prev) => {
      const next = upsertTab(prev, meta);
      storeTabs(next);
      return next;
    });

    setActiveTabId(createdId);
    router.push(`/chat/${createdId}`);
    return createdId;
  }

  async function updateChatTitle(chatId: string, title: string) {
    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {}
  }

  async function deleteChat(chatId: string) {
    if (!confirm("Delete this chat?")) return;

    const candidates = [
      { url: `/api/chats/${chatId}/delete`, method: "DELETE" as const },
      { url: `/api/chats/${chatId}`, method: "DELETE" as const },
    ];

    let ok = false;
    for (const c of candidates) {
      const res = await fetch(c.url, { method: c.method });
      if (res.ok) {
        ok = true;
        break;
      }
    }

    if (!ok) {
      alert("Delete failed. Confirm your chat delete route exists.");
      return;
    }

    setTabs((prev) => {
      const next = removeTab(prev, chatId);
      storeTabs(next);
      return next;
    });

    await refreshProjects();

    if (routeChatId === chatId) {
      const remaining = getStoredTabs().filter((t) => String(t.id) !== String(chatId));
      const fallback = remaining[0]?.id;
      router.push(fallback ? `/chat/${fallback}` : `/chat/new`);
    }
  }

  function onSidebarChatClick(e: React.MouseEvent, c: ChatMeta) {
    e.preventDefault();
    e.stopPropagation();

    setTabs((prev) => {
      const next = upsertTab(prev, c);
      storeTabs(next);
      return next;
    });

    setActiveTabId(String(c.id));
    router.push(`/chat/${c.id}`);
  }

  function stopGenerating() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setStatusLine("");
    clearedStatusRef.current = true;
  }

  async function send() {
    const text = editorText.trim();
    if (!text || sending) return;

    setSending(true);
    setStatusLine(web ? "Browsing…" : "");
    clearedStatusRef.current = false;

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text, ts: now() };
    setMessages((m) => [...m, userMsg]);
    setEditorText("");
    collapseEditor();

    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "", ts: now() }]);

    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 20);

    let watchdog: any = null;

    try {
      const pid = String(
        chat?.project_id || activeProjectId || activeProject?.id || projects[0]?.id || ""
      ).trim();
      if (!pid) throw new Error("Missing projectId");

      let chatId = String(
        chat?.id || (routeChatId && routeChatId !== "new" ? routeChatId : "") || ""
      ).trim();

      if (!chatId) {
        const createdId = await createChat(pid);
        if (!createdId) throw new Error("Failed to create chat");
        chatId = createdId;
      }

      const currentTitle = String(chat?.title || "").trim();
      const needsTitle = !currentTitle || currentTitle.toLowerCase() === "new chat";
      if (needsTitle) {
        const derived = deriveTitleFromPrompt(text);

        setTabs((prev) => {
          const existing = prev.find((t) => String(t.id) === String(chatId));
          const meta: ChatMeta = existing
            ? { ...existing, title: derived, updated_at: now() }
            : { id: chatId, project_id: pid, title: derived, created_at: now(), updated_at: now() };

          const next = upsertTab(prev, meta);
          storeTabs(next);
          return next;
        });

        setChat((c) => (c && String(c.id) === String(chatId) ? { ...c, title: derived } : c));
        updateChatTitle(chatId, derived);
      }

      const ac = new AbortController();
      abortRef.current = ac;

      let gotAnyBytes = false;
      const watchdogMs = web ? 12000 : 8000;
      watchdog = setTimeout(() => {
        if (gotAnyBytes) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    (m.content || "") +
                    "\n\n⏳ Still working… If this stalls, the website may be blocking automated fetching (CAPTCHA/403). Try turning Web off or paste the page text here.",
                }
              : m
          )
        );
      }, watchdogMs);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({ chatId, projectId: pid, message: text, mode, provider, model, web }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        const bodyText = await res.text().catch(() => "");
        clearTimeout(watchdog);

        if (!bodyText.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      (m.content || "") +
                      "\n\n⚠️ Got an empty response body. This usually means the server didn’t stream output or web fetch returned nothing readable.",
                  }
                : m
            )
          );
        } else {
          setStatusLine("");
          clearedStatusRef.current = true;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: bodyText } : m))
          );
        }
      } else {
        let full = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          gotAnyBytes = true;

          if (!clearedStatusRef.current) {
            clearedStatusRef.current = true;
            setStatusLine("");
          }

          const chunk = decoder.decode(value, { stream: true });
          full += chunk;

          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m))
          );
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        }

        clearTimeout(watchdog);

        if (!full.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      "\n\n⚠️ No readable text came back. Likely blocked by CAPTCHA/403 or JS-only page.\n\nTry: Web Off, or paste the page text here.",
                  }
                : m
            )
          );
        }
      }

      abortRef.current = null;
      setSending(false);
      setStatusLine("");

      await refreshProjects();
      await loadChat(chatId);
    } catch (e: any) {
      clearTimeout(watchdog);
      abortRef.current = null;
      setSending(false);
      setStatusLine("");
      clearedStatusRef.current = true;

      const msg = e?.name === "AbortError" ? "> *(stopped)*" : `**Error:** ${e?.message || "Failed"}`;

      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: msg } : m)));
    } finally {
      clearTimeout(watchdog);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }, 20);
    }
  }

  useEffect(() => {
    const stored = getStoredTabs();
    if (stored.length) setTabs(stored);

    try {
      const raw = localStorage.getItem("hb_sidebar_collapsed");
      if (raw === "1") setSidebarCollapsed(true);
    } catch {}

    try {
      const t = localStorage.getItem("hb_theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}

    try {
      const w = localStorage.getItem("hb_web");
      if (w === "1") setWeb(true);
    } catch {}

    refreshProjects().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("hb_web", web ? "1" : "0");
    } catch {}
  }, [web]);

  useEffect(() => {
    if (!routeChatId) return;
    loadChat(routeChatId).catch((e) => {
      console.error(e);
      if (routeChatId !== "new") router.replace("/chat/new");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeChatId]);

  useEffect(() => {
    autosizeEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorText]);

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      const c = (m.content || "").trim().toLowerCase();
      if (m.role === "assistant" && (c === "new chat started." || c === "new chat started")) return false;
      return true;
    });
  }, [messages]);

  const rootCls =
    theme === "light"
      ? "h-screen w-screen overflow-hidden text-zinc-900 bg-[#f6f7fb]"
      : "h-screen w-screen overflow-hidden text-zinc-100 bg-[#06070a]";

  const shellBorder = theme === "light" ? "border-black/10" : "border-white/10";
  const shellGlass = theme === "light" ? "bg-white/80" : "bg-black/30";
  const shellGlass2 = theme === "light" ? "bg-white/70" : "bg-black/25";
  const sidebarGlass = theme === "light" ? "bg-white/85" : "bg-black/35";

  return (
    <div className={rootCls}>
      {/* background */}
      {theme === "light" ? (
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_20%_15%,rgba(99,102,241,0.08),transparent_60%),radial-gradient(900px_500px_at_85%_10%,rgba(16,185,129,0.06),transparent_60%),radial-gradient(900px_500px_at_55%_90%,rgba(59,130,246,0.06),transparent_60%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white via-[#f6f7fb] to-[#eef1f7]" />
        </div>
      ) : (
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_20%_15%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(900px_500px_at_85%_10%,rgba(168,85,247,0.16),transparent_55%),radial-gradient(900px_500px_at_55%_90%,rgba(34,197,94,0.10),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black/80" />
        </div>
      )}

      <div
        className="grid h-screen"
        style={{
          gridTemplateColumns: sidebarCollapsed ? "64px 1fr" : "320px 1fr",
          transition: "grid-template-columns 220ms ease",
        }}
      >
        {/* LEFT */}
        <aside className={`h-screen overflow-hidden border-r ${shellBorder} ${sidebarGlass} backdrop-blur`}>
          <div className="h-full flex flex-col">
            <div className={`px-3 py-3 border-b ${shellBorder} flex items-center justify-between gap-2`}>
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() =>
                    setSidebarCollapsed((v) => {
                      const next = !v;
                      try {
                        localStorage.setItem("hb_sidebar_collapsed", next ? "1" : "0");
                      } catch {}
                      return next;
                    })
                  }
                  className={`h-8 w-8 rounded-lg border ${shellBorder} ${
                    theme === "light"
                      ? "bg-black/5 hover:bg-black/10 text-zinc-800"
                      : "bg-white/5 hover:bg-white/10 text-zinc-200"
                  }`}
                  title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {sidebarCollapsed ? "»" : "«"}
                </button>

                {!sidebarCollapsed && (
                  <div className={`font-semibold truncate ${theme === "light" ? "text-zinc-900" : "text-zinc-100"}`}>
                    Projects
                  </div>
                )}
              </div>

              {!sidebarCollapsed && (
                <button
                  className={`text-xs px-2 py-1 rounded-md border ${shellBorder} ${
                    theme === "light"
                      ? "bg-black/5 hover:bg-black/10 text-zinc-800"
                      : "bg-white/10 hover:bg-white/15 text-zinc-100"
                  }`}
                  type="button"
                  onClick={() => createProject()}
                  title="Create project"
                  disabled={sending}
                >
                  + New
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto px-2 py-2">
              {projects.map((p) => {
                const active = (activeProjectId || activeProject?.id) === p.id;
                return (
                  <div key={p.id} className="mb-2">
                    <div
                      className={[
                        "flex items-center justify-between rounded-lg px-2 py-2 cursor-pointer border",
                        active
                          ? theme === "light"
                            ? "bg-black/5 border-black/10"
                            : "bg-white/10 border-white/10"
                          : theme === "light"
                          ? "bg-transparent border-transparent hover:bg-black/5 hover:border-black/10"
                          : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10",
                      ].join(" ")}
                      onClick={() => setActiveProjectId(String(p.id))}
                      title={p.name}
                    >
                      <div className="min-w-0 flex-1">
                        {!sidebarCollapsed ? (
                          <div
                            className={`font-medium text-sm truncate ${
                              theme === "light" ? "text-zinc-900" : "text-zinc-100"
                            }`}
                          >
                            {p.name}
                          </div>
                        ) : (
                          <div
                            className={`h-2 w-2 rounded-full mx-auto ${
                              theme === "light" ? "bg-black/30" : "bg-white/30"
                            }`}
                          />
                        )}
                      </div>

                      {!sidebarCollapsed && (
                        <div className="flex items-center gap-2">
                          <button
                            className={`text-xs px-2 py-1 rounded-md border ${shellBorder} ${
                              theme === "light"
                                ? "bg-black/5 hover:bg-black/10 text-zinc-800"
                                : "bg-white/5 hover:bg-white/10 text-zinc-100"
                            }`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              createChat(String(p.id));
                            }}
                            title="New chat"
                            disabled={sending}
                          >
                            + Chat
                          </button>
                        </div>
                      )}
                    </div>

                    {!sidebarCollapsed && (
                      <div className="mt-1 ml-2">
                        {(p.chats || []).map((c) => {
                          const isActive = routeChatId === String(c.id);
                          return (
                            <div
                              key={c.id}
                              className={[
                                "group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm border",
                                isActive
                                  ? theme === "light"
                                    ? "bg-black/5 border-black/10"
                                    : "bg-white/10 border-white/10"
                                  : theme === "light"
                                  ? "bg-transparent border-transparent hover:bg-black/5 hover:border-black/10"
                                  : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10",
                              ].join(" ")}
                              onClick={(e) => onSidebarChatClick(e, c)}
                            >
                              <div className={`truncate ${theme === "light" ? "text-zinc-800" : "text-zinc-200/90"}`}>
                                {shortTitle(c.title)}
                              </div>

                              <button
                                type="button"
                                className={`opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-md border ${shellBorder} ${
                                  theme === "light"
                                    ? "bg-black/5 hover:bg-black/10 text-zinc-800"
                                    : "bg-white/5 hover:bg-white/10 text-zinc-200"
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteChat(String(c.id));
                                }}
                                title="Delete chat"
                                disabled={sending}
                              >
                                🗑
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              className={`px-4 py-3 border-t ${shellBorder} text-xs ${
                theme === "light" ? "text-zinc-500" : "text-zinc-400"
              }`}
            >
              {sidebarCollapsed ? "HB" : "Local-first: SQLite + disk"}
            </div>
          </div>
        </aside>

        {/* RIGHT */}
        <main className="h-screen overflow-hidden flex flex-col">
          <div className={`border-b ${shellBorder} ${shellGlass} backdrop-blur`}>
            <div className="flex items-end gap-2 px-3 pt-2 overflow-x-auto">
              {tabs.map((t) => {
                const active = routeChatId === String(t.id) || activeTabId === String(t.id);
                return (
                  <div
                    key={t.id}
                    className={[
                      "min-w-[220px] max-w-[320px] flex items-center justify-between gap-2 px-3 py-2 rounded-t-xl border",
                      active
                        ? theme === "light"
                          ? "bg-white border-black/10"
                          : "bg-black/40 border-white/15"
                        : theme === "light"
                        ? "bg-black/5 border-black/10 hover:bg-black/10"
                        : "bg-white/5 border-white/10 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setTabs((prev) => {
                          const next = upsertTab(prev, t);
                          storeTabs(next);
                          return next;
                        });
                        setActiveTabId(String(t.id));
                        router.push(`/chat/${t.id}`);
                      }}
                      className={`truncate text-sm text-left flex-1 ${theme === "light" ? "text-zinc-900" : "text-zinc-100"}`}
                      title={t.title}
                      disabled={sending}
                    >
                      {shortTitle(t.title, 34)}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setTabs((prev) => {
                          const next = removeTab(prev, String(t.id));
                          storeTabs(next);
                          return next;
                        });

                        if (routeChatId === String(t.id)) {
                          const remaining = getStoredTabs().filter((x) => String(x.id) !== String(t.id));
                          const fallback = remaining[0]?.id;
                          router.push(fallback ? `/chat/${fallback}` : `/chat/new`);
                        }
                      }}
                      className={
                        theme === "light"
                          ? "text-zinc-600 hover:text-zinc-900 text-sm"
                          : "text-zinc-300 hover:text-white text-sm"
                      }
                      title="Close tab"
                      disabled={sending}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  const pid = activeProjectId || activeProject?.id || projects[0]?.id;
                  if (!pid) return alert("No project available.");
                  createChat(String(pid));
                }}
                className={[
                  "mb-[2px] px-3 py-2 rounded-t-xl border text-sm",
                  theme === "light"
                    ? "border-black/10 bg-black/5 hover:bg-black/10 text-zinc-900"
                    : "border-white/10 bg-white/5 hover:bg-white/10 text-zinc-100",
                ].join(" ")}
                title="New chat"
                disabled={sending}
              >
                +
              </button>
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`font-semibold ${theme === "light" ? "text-zinc-900" : "text-zinc-100"}`}>
                  Home Brain
                </div>

                <select
                  className={[
                    "text-xs border rounded-md px-2 py-1",
                    theme === "light"
                      ? "bg-white border-black/10 text-zinc-900"
                      : "bg-black/40 border-white/10 text-zinc-200",
                  ].join(" ")}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  title="Provider"
                  disabled={sending}
                >
                  <option value="openai">OpenAI</option>
                  <option value="claude">Claude</option>
                </select>

                <select
                  className={[
                    "text-xs border rounded-md px-2 py-1",
                    theme === "light"
                      ? "bg-white border-black/10 text-zinc-900"
                      : "bg-black/40 border-white/10 text-zinc-200",
                  ].join(" ")}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  title="Model"
                  disabled={sending}
                >
                  {provider === "openai" ? (
                    <>
                      <option value="gpt-5-mini">gpt-5-mini (fast)</option>
                      <option value="gpt-5.2">gpt-5.2</option>
                      <option value="gpt-4.1">gpt-4.1</option>
                    </>
                  ) : (
                    <>
                      <option value="claude-sonnet-4-5-20250929">claude-sonnet-4-5</option>
                      <option value="claude-opus-4-1-20250805">claude-opus-4-1</option>
                    </>
                  )}
                </select>

                <button
                  type="button"
                  onClick={() => setWeb((v) => !v)}
                  className={[
                    "text-xs px-2 py-1 rounded-md border",
                    theme === "light"
                      ? web
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white border-black/10 text-zinc-900"
                      : web
                      ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/40"
                      : "bg-black/40 border-white/10 text-zinc-200",
                  ].join(" ")}
                  title="Enable web browsing"
                  disabled={sending}
                >
                  Web: {web ? "On" : "Off"}
                </button>

                <span className={theme === "light" ? "text-xs text-zinc-500" : "text-xs text-zinc-400"}>
                  {mode === "code" ? "Code mode" : "Normal"}
                </span>

                {sending && statusLine ? (
                  <span className={theme === "light" ? "text-xs text-zinc-600" : "text-xs text-zinc-300"}>
                    {statusLine}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTheme("dark");
                    try {
                      localStorage.setItem("hb_theme", "dark");
                    } catch {}
                  }}
                  className={[
                    "px-3 py-2 rounded-lg border text-sm",
                    theme === "dark"
                      ? "bg-white text-black border-white"
                      : theme === "light"
                      ? "bg-black/5 border-black/10 hover:bg-black/10 text-zinc-900"
                      : "bg-white/5 border-white/10 hover:bg-white/10",
                  ].join(" ")}
                  disabled={sending}
                >
                  Dark
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTheme("light");
                    try {
                      localStorage.setItem("hb_theme", "light");
                    } catch {}
                  }}
                  className={[
                    "px-3 py-2 rounded-lg border text-sm",
                    theme === "light"
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white/5 border-white/10 hover:bg-white/10",
                  ].join(" ")}
                  disabled={sending}
                >
                  Light
                </button>

                <button
                  type="button"
                  onClick={() => setMode("normal")}
                  className={[
                    "px-3 py-2 rounded-lg border text-sm",
                    mode === "normal"
                      ? theme === "light"
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-black border-white"
                      : theme === "light"
                      ? "bg-black/5 border-black/10 hover:bg-black/10 text-zinc-900"
                      : "bg-white/5 border-white/10 hover:bg-white/10",
                  ].join(" ")}
                  disabled={sending}
                >
                  Normal
                </button>

                <button
                  type="button"
                  onClick={() => setMode("code")}
                  className={[
                    "px-3 py-2 rounded-lg border text-sm",
                    mode === "code"
                      ? theme === "light"
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-black border-white"
                      : theme === "light"
                      ? "bg-black/5 border-black/10 hover:bg-black/10 text-zinc-900"
                      : "bg-white/5 border-white/10 hover:bg-white/10",
                  ].join(" ")}
                  disabled={sending}
                >
                  Code
                </button>

                {sending ? (
                  <button
                    type="button"
                    onClick={stopGenerating}
                    className={[
                      "px-4 py-2 rounded-lg border text-sm font-medium",
                      theme === "light"
                        ? "bg-red-600 text-white border-red-600 hover:bg-red-500"
                        : "bg-red-500/20 text-red-200 border-red-500/40 hover:bg-red-500/30",
                    ].join(" ")}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={send}
                    disabled={!editorText.trim()}
                    className={[
                      "px-4 py-2 rounded-lg border text-sm font-medium",
                      !editorText.trim()
                        ? theme === "light"
                          ? "bg-black/5 border-black/10 text-zinc-400 cursor-not-allowed"
                          : "bg-white/10 border-white/10 text-zinc-400 cursor-not-allowed"
                        : theme === "light"
                        ? "bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800"
                        : "bg-white text-black border-white hover:bg-zinc-200",
                    ].join(" ")}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={`border-b ${shellBorder} ${shellGlass2} backdrop-blur px-4 py-3`}>
            <div className={theme === "light" ? "text-xs text-zinc-500 mb-2" : "text-xs text-zinc-400 mb-2"}>
              Prompt Editor — <span className={theme === "light" ? "text-zinc-900" : "text-zinc-200"}>Enter</span>{" "}
              sends, <span className={theme === "light" ? "text-zinc-900" : "text-zinc-200"}>Shift+Enter</span>{" "}
              newline,{" "}
              <span className={theme === "light" ? "text-zinc-900" : "text-zinc-200"}>Cmd/Ctrl+Enter</span> sends
            </div>

            <textarea
              ref={editorRef}
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              onInput={autosizeEditor}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type your prompt…"
              className={[
                "w-full resize-none rounded-xl border px-4 py-3 outline-none",
                theme === "light"
                  ? "border-black/10 bg-white text-zinc-900 placeholder:text-zinc-500 focus:border-black/20"
                  : "border-white/10 bg-black/35 text-zinc-100 placeholder:text-zinc-500 focus:border-white/20",
              ].join(" ")}
              style={{ height: 44 }}
              disabled={sending}
            />
          </div>

          <div className="flex-1 overflow-hidden">
            <div ref={scrollRef} className="h-full overflow-auto px-6 py-8">
              {visibleMessages.length === 0 ? (
                <div className={theme === "light" ? "text-zinc-600 text-sm" : "text-zinc-400 text-sm"}>
                  Ask something to begin. (This chat will be named from your first prompt.)
                </div>
              ) : (
                <>
                  {visibleMessages.map((m) => (
                    <MarkdownBubble key={m.id} role={m.role} content={m.content} theme={theme} />
                  ))}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}