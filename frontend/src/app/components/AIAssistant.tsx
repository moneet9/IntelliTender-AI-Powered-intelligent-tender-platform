import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Bot, Clock, Maximize2, MessageSquare, Minimize2, Plus, Send, Trash2, X } from "lucide-react";
import { apiRequest, getLmStudioUrl } from "../api";

type Role = "cpo" | "po" | "committee" | "vendor" | "bidder";

type ChatMeta = {
  model?: string;
  responseMode?: string;
  collection?: string | null;
  count?: number;
  records?: unknown[];
  telemetry?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    generationTimeSeconds?: number;
    timeToFirstTokenSeconds?: number;
    tokensPerSecond?: number;
    source?: string;
  } | null;
  durationMs?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  pending?: boolean;
  meta?: ChatMeta;
};

type ChatSession = {
  _id: string;
  title: string;
  preview?: string;
  lastMessageAt?: string;
  messageCount?: number;
  messages?: ChatEntry[];
};

type ChatEntry = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  meta?: ChatMeta;
};

type ChatResponse = {
  chatId: string;
  chat?: ChatSession;
  reply: string;
  model?: string;
  responseMode?: string;
  collection?: string | null;
  count?: number;
  records?: unknown[];
  telemetry?: ChatMeta["telemetry"];
  durationMs?: number;
};

interface AIAssistantProps {
  role: Role;
}

const roleGreetings: Record<Role, string> = {
  cpo: "Hello! I can help with procurement-wide tenders, contracts, audits, and milestone tracking.",
  po: "Hello! I can help with your tenders, bids, contracts, committee members, and milestone progress.",
  committee: "Hello! I can help with your assigned tenders, bid reviews, and milestone updates.",
  vendor: "Hello! I can help with your visible tenders, bids, and contracts.",
  bidder: "Hello! I can help with your visible tenders, bids, and contracts.",
};

const quickQuestions: Record<Role, string[]> = {
  cpo: [
    "Show me the newest tenders",
    "How many contracts are in progress?",
    "Which milestones are delayed?",
  ],
  po: [
    "Show my latest tenders",
    "Which milestones are yet to review?",
    "How much work is completed on my contracts?",
  ],
  committee: [
    "Show me tenders under my PO",
    "Which milestone updates are pending?",
    "How much progress is complete?",
  ],
  vendor: [
    "Show published tenders",
    "What bids have I submitted?",
    "Show my contracts",
  ],
  bidder: [
    "Show published tenders",
    "What bids have I submitted?",
    "Show my contracts",
  ],
};

const getNowStamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const mapChatMessage = (entry: ChatEntry, index: number): ChatMessage => ({
  id: `${entry.role}-${entry.createdAt || index}-${index}`,
  role: entry.role,
  content: entry.content,
  timestamp: entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : getNowStamp(),
  meta: entry.meta,
});

const buildInitialMessages = (role: Role): ChatMessage[] => [
  {
    id: "welcome",
    role: "assistant",
    content: roleGreetings[role],
    timestamp: getNowStamp(),
  },
];

const normalizeChatList = (items: ChatSession[] = []) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.lastMessageAt || 0).getTime();
    const rightTime = new Date(right.lastMessageAt || 0).getTime();
    return rightTime - leftTime;
  });

function renderRecordCards(message: ChatMessage) {
  const records = Array.isArray(message.meta?.records) ? message.meta.records : [];
  if (!records.length) return null;

  const collection = String(message.meta?.collection || "").toLowerCase();
  const visibleRecords = records.slice(0, 3);

  if (collection === "tender") {
    return (
      <div className="mt-3 space-y-2">
        {visibleRecords.map((record: any, index) => (
          <div key={`${message.id}-tender-${index}`} className="rounded-xl border border-sky-100 bg-sky-50/80 p-3 text-xs text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">{record.title || "Untitled tender"}</p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-700">
                {record.status || "Unknown"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              <span>Category: {record.category || "-"}</span>
              <span>Budget: {record.budget ?? "-"}</span>
              <span>Final submission: {record.finalSubmissionDate || "-"}</span>
              <span>Created: {record.createdAt ? new Date(record.createdAt).toLocaleDateString() : "-"}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (collection === "contract") {
    return (
      <div className="mt-3 space-y-2">
        {visibleRecords.map((record: any, index) => (
          <div key={`${message.id}-contract-${index}`} className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3 text-xs text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">{record.tender || `Contract ${record.id || index + 1}`}</p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700">
                {record.status || "Unknown"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              <span>Timeline: {record.timelineStartDate || "-"} to {record.timelineEndDate || "-"}</span>
              <span>Avg progress: {record.milestoneStats?.averageProgress ?? 0}%</span>
              <span>Milestones completed: {record.milestoneStats?.completed ?? 0}/{record.milestoneStats?.total ?? 0}</span>
              <span>Pending: {record.milestoneStats?.pending ?? 0}</span>
            </div>
            {Array.isArray(record.milestones) && record.milestones.length > 0 && (
              <div className="mt-2 space-y-1">
                {record.milestones.slice(0, 3).map((milestone: any, milestoneIndex: number) => (
                  <div key={`${message.id}-milestone-${index}-${milestoneIndex}`} className="rounded-lg bg-white/80 px-2 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{milestone.title || `Milestone ${milestoneIndex + 1}`}</span>
                      <span>{Number(milestone.progress || 0)}%</span>
                    </div>
                    <p className="text-[11px] text-slate-500">{milestone.status || "Unknown"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {visibleRecords.map((record: any, index) => (
        <div key={`${message.id}-record-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">{record.name || record.title || record.id || "Record"}</p>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
            <span>Role: {record.role || "-"}</span>
            <span>Status: {record.accountStatus || record.status || "-"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatInlineMarkdown(value: string, keyPrefix: string) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={`${keyPrefix}-bold-${index}`}>{part.slice(2, -2)}</strong>
    : <span key={`${keyPrefix}-text-${index}`}>{part}</span>);
}

function FormattedAssistantMessage({ content }: { content: string }) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="space-y-2 text-sm leading-6">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={`space-${index}`} className="h-1" />;
        if (/^-{3,}$/.test(trimmed)) return <hr key={`rule-${index}`} className="my-2 border-slate-200" />;
        if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
          return <h4 key={`heading-${index}`} className="pt-1 text-xs font-bold uppercase tracking-[0.12em] text-[#0B3C5D]">{trimmed.slice(2, -2)}</h4>;
        }
        if (/^[-*]\s+/.test(trimmed)) {
          return <div key={`bullet-${index}`} className="flex gap-2 pl-2"><span className="text-[#1D4E89]">•</span><span>{formatInlineMarkdown(trimmed.replace(/^[-*]\s+/, ""), `line-${index}`)}</span></div>;
        }
        if (/^\d+[.)]\s+/.test(trimmed)) {
          const match = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
          return <div key={`number-${index}`} className="flex gap-2 pl-2"><span className="font-semibold text-[#1D4E89]">{match?.[1]}.</span><span>{formatInlineMarkdown(match?.[2] || trimmed, `line-${index}`)}</span></div>;
        }
        if (trimmed.startsWith(">")) {
          return <blockquote key={`quote-${index}`} className="border-l-2 border-amber-400 bg-amber-50 px-3 py-1 text-slate-700">{formatInlineMarkdown(trimmed.replace(/^>\s?/, ""), `line-${index}`)}</blockquote>;
        }
        return <p key={`paragraph-${index}`}>{formatInlineMarkdown(trimmed, `line-${index}`)}</p>;
      })}
    </div>
  );
}

export function AIAssistant({ role }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>(buildInitialMessages(role));
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat._id === currentChatId) || null,
    [chats, currentChatId]
  );

  const setChatMessages = (chat?: ChatSession | null) => {
    if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) {
      setMessages(buildInitialMessages(role));
      return;
    }

    setMessages(chat.messages.map(mapChatMessage));
  };

  const refreshChats = async (preferredChatId?: string) => {
    setIsLoadingChats(true);
    try {
      const response = await apiRequest<{ items: ChatSession[] }>("/api/ai/chats");
      const items = normalizeChatList(response.items || []);
      setChats(items);

      const targetId = preferredChatId || currentChatId || items[0]?._id || "";
      if (!targetId) {
        setCurrentChatId("");
        setChatMessages(null);
        return;
      }

      const chat = items.find((item) => item._id === targetId);
      if (chat) {
        setCurrentChatId(chat._id);
        setChatMessages(chat);
        return;
      }

      const detailed = await apiRequest<{ chat: ChatSession }>(`/api/ai/chats/${targetId}`);
      setCurrentChatId(detailed.chat._id);
      setChatMessages(detailed.chat);
    } catch {
      if (!currentChatId) {
        setChatMessages(null);
      }
    } finally {
      setIsLoadingChats(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshChats();
  }, [isOpen]);

  useEffect(() => {
    if (!chatContainerRef.current) return;
    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages]);

  const startNewChat = async () => {
    setError("");
    try {
      const response = await apiRequest<{ chat: ChatSession }>("/api/ai/chats", {
        method: "POST",
      });

      setChats((prev) => normalizeChatList([response.chat, ...prev.filter((chat) => chat._id !== response.chat._id)]));
      setCurrentChatId(response.chat._id);
      setChatMessages(response.chat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create a new chat");
    }
  };

  const openChat = async (chatId: string) => {
    if (!chatId) return;
    setError("");
    try {
      const response = await apiRequest<{ chat: ChatSession }>(`/api/ai/chats/${chatId}`);
      setCurrentChatId(response.chat._id);
      setChatMessages(response.chat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the selected chat");
    }
  };

  const deleteChat = async (chatId: string) => {
    if (!chatId) return;
    if (!window.confirm("Delete this chat thread?")) return;

    setError("");
    try {
      await apiRequest(`/api/ai/chats/${chatId}`, { method: "DELETE" });
      const remaining = chats.filter((chat) => chat._id !== chatId);
      setChats(remaining);

      const nextChat = remaining[0] || null;
      if (nextChat) {
        setCurrentChatId(nextChat._id);
        setChatMessages(nextChat);
        return;
      }

      const response = await apiRequest<{ chat: ChatSession }>("/api/ai/chats", {
        method: "POST",
      });
      setChats([response.chat]);
      setCurrentChatId(response.chat._id);
      setChatMessages(response.chat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the chat");
    }
  };

  const handleSend = async (question?: string) => {
    const messageText = String(question || input).trim();
    if (!messageText) return;

    const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMessage: ChatMessage = {
      id: `${pendingId}-user`,
      role: "user",
      content: messageText,
      timestamp: getNowStamp(),
    };
    const pendingMessage: ChatMessage = {
      id: pendingId,
      role: "assistant",
      content: "Thinking...",
      timestamp: getNowStamp(),
      pending: true,
    };

    setError("");
    setMessages((prev) => [...prev, userMessage, pendingMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await apiRequest<ChatResponse>("/api/ai/chat", {
        method: "POST",
        timeoutMs: 180000,
        body: {
          message: messageText,
          chatId: currentChatId || undefined,
          lmStudioUrl: getLmStudioUrl() || undefined,
        },
      });

      const savedAssistantReply = response.chat?.messages?.some((entry) => (
        entry?.role === "assistant" && typeof entry.content === "string" && entry.content.trim().length > 0
      ));
      if (response.chat && savedAssistantReply) {
        setChats((prev) => normalizeChatList([response.chat as ChatSession, ...prev.filter((chat) => chat._id !== response.chat?._id)]));
        setCurrentChatId(response.chat._id);
        setChatMessages(response.chat);
      } else if (String(response.reply || "").trim()) {
        // Keep the live model answer visible even if the persisted chat
        // payload is stale or temporarily missing its new messages.
        setMessages((prev) => prev.map((entry) => entry.id === pendingId
          ? {
              ...entry,
              content: String(response.reply).trim(),
              pending: false,
              timestamp: getNowStamp(),
              meta: {
                model: response.model,
                responseMode: response.responseMode,
                collection: response.collection,
                count: response.count,
                records: response.records,
                telemetry: response.telemetry,
                durationMs: response.durationMs,
              },
            }
          : entry));
        if (response.chatId) {
          setCurrentChatId(response.chatId);
          await refreshChats(response.chatId);
        }
      } else {
        setCurrentChatId(response.chatId);
        await refreshChats(response.chatId);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === pendingId
            ? {
                ...entry,
                content: err instanceof Error ? `I could not complete that request: ${err.message}` : "I could not complete that request right now.",
                pending: false,
                timestamp: getNowStamp(),
                meta: { model: "fallback", responseMode: "fallback" },
              }
            : entry
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const questions = quickQuestions[role];

  const beginModalDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (isFullScreen || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      originX: modalPosition.x,
      originY: modalPosition.y,
    });
  };

  const moveModal = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState || isFullScreen) return;
    setModalPosition({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => { setIsOpen(true); setIsFullScreen(true); }}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#0B3C5D] text-white shadow-lg transition-transform hover:scale-105 hover:bg-[#154068]"
        aria-label="Open IntelliTender assistant"
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div style={!isFullScreen ? { transform: `translate(${modalPosition.x}px, ${modalPosition.y}px)` } : undefined} className={isFullScreen
      ? "fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-white"
      : "fixed bottom-4 right-4 z-50 flex h-[min(88vh,44rem)] w-[min(94vw,60rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"}>
      <div
        className={`flex items-center justify-between border-b border-slate-200 bg-[#0B3C5D] px-4 py-3 text-white ${isFullScreen ? "" : "cursor-move select-none"}`}
        onPointerDown={beginModalDrag}
        onPointerMove={moveModal}
        onPointerUp={() => setDragState(null)}
        onPointerCancel={() => setDragState(null)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">IntelliTender AI Assistant</h3>
            <p className="text-xs text-white/70">
              {activeChat?.title || "New chat"} {isLoadingChats ? " - loading chats..." : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
          <button
            onClick={() => setIsFullScreen((current) => !current)}
            className="rounded-full p-1.5 transition-colors hover:bg-white/10"
            aria-label={isFullScreen ? "Minimize assistant" : "Maximize assistant"}
            title={isFullScreen ? "Minimize" : "Full screen"}
          >
            {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => { setIsOpen(false); setIsFullScreen(false); }}
            className="rounded-full p-1.5 transition-colors hover:bg-white/10"
            aria-label="Close assistant"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Conversation</p>
            <p className="text-sm text-slate-700">{chats.length ? `${chats.length} saved chat${chats.length === 1 ? "" : "s"}` : "No saved chats yet"}</p>
          </div>
          <button
            onClick={startNewChat}
            className="inline-flex items-center gap-2 rounded-full bg-[#1D4E89] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#154068]"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {normalizeChatList(chats).slice(0, 8).map((chat) => (
            <div
              key={chat._id}
              className={`min-w-[10rem] rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                chat._id === currentChatId
                  ? "border-[#1D4E89] bg-white text-[#0B3C5D]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => openChat(chat._id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold line-clamp-1">{chat.title || "New chat"}</span>
                    <Clock className="h-3 w-3 shrink-0 opacity-60" />
                  </div>
                  <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{chat.preview || "No messages yet"}</p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteChat(chat._id)}
                  className="rounded-full p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${chat.title || "chat"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Saved chats</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {normalizeChatList(chats).length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-500">Start a conversation and it will appear here.</p>
            )}
            {normalizeChatList(chats).map((chat) => (
              <div
                key={chat._id}
                className={`mb-2 w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                  chat._id === currentChatId
                    ? "border-[#1D4E89] bg-[#F2F7FC]"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => openChat(chat._id)}>
                    <p className="line-clamp-1 text-sm font-semibold text-slate-900">{chat.title || "New chat"}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{chat.preview || "No preview available yet."}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-400">
                      {chat.messageCount || 0} message{(chat.messageCount || 0) === 1 ? "" : "s"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteChat(chat._id)}
                    className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${chat.title || "chat"}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                {role.toUpperCase()}
              </span>
              <span className="text-sm text-slate-600">
                Ask about tenders, contracts, committee reviews, or milestone progress.
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {questions.slice(0, 3).map((question) => (
                <button
                  key={question}
                  onClick={() => handleSend(question)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-white"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>

          <div ref={chatContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4">
            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {error}
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "bg-[#1D4E89] text-white"
                      : message.pending
                        ? "border border-dashed border-slate-300 bg-white text-slate-500"
                        : "border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {message.role === "assistant" && !message.pending
                    ? <FormattedAssistantMessage content={message.content} />
                    : <p className={`whitespace-pre-line text-sm leading-6 ${message.pending ? "animate-pulse" : ""}`}>{message.content}</p>}
                  {message.pending && (
                    <p className="mt-2 text-xs text-slate-400">Looking through your records...</p>
                  )}
                  {!message.pending && message.role === "assistant" && message.meta?.responseMode && (
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-400">
                      {message.meta.responseMode === "lmstudio"
                        ? "Live AI + DB"
                        : message.meta.responseMode === "local"
                          ? "Local record answer"
                          : message.meta.responseMode}
                      {typeof message.meta.count === "number" ? ` | ${message.meta.count} result${message.meta.count === 1 ? "" : "s"}` : ""}
                    </p>
                  )}
                  {!message.pending && message.role === "assistant" && message.meta?.telemetry && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">
                        Tokens: {message.meta.telemetry.totalTokens ?? ((message.meta.telemetry.promptTokens || 0) + (message.meta.telemetry.completionTokens || 0))}
                      </span>
                      {typeof message.meta.durationMs === "number" && message.meta.durationMs > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">Time: {(message.meta.durationMs / 1000).toFixed(2)}s</span>
                      )}
                      {message.meta.telemetry.tokensPerSecond ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">Speed: {message.meta.telemetry.tokensPerSecond.toFixed(1)} tok/s</span>
                      ) : null}
                      {message.meta.telemetry.source && <span className="rounded-full bg-slate-100 px-2 py-0.5">{message.meta.telemetry.source}</span>}
                    </div>
                  )}
                  {!message.pending && message.role === "assistant" && renderRecordCards(message)}
                  <p className={`mt-2 text-xs ${message.role === "user" ? "text-white/70" : "text-slate-400"}`}>
                    {message.timestamp}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 bg-white p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Type a message..."
                className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#1D4E89] focus:ring-2 focus:ring-[#1D4E89]/20"
              />
              <button
                onClick={() => handleSend()}
                disabled={isSending}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1D4E89] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#154068] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
