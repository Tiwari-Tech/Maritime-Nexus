"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { askRag, RAGSourceReference } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  AIAssistantIcon,
  DocumentsIcon,
  SpinnerIcon,
  SendIcon,
  RefreshIcon,
  CloseIcon,
} from "@/components/icons";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RAGSourceReference[];
  timestamp: string;
  error?: string;
  failedQuery?: string;
}

export default function AIAssistantPage() {
  const { user, backendUser } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Derive user initials for user avatar badge
  const userInitials = (() => {
    const sourceName = backendUser?.full_name || user?.displayName;
    if (sourceName) {
      const parts = sourceName.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "ME";
  })();

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputQuery(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const handleSendMessage = async (queryText?: string) => {
    const q = (queryText ?? inputQuery).trim();
    if (!q || isLoading) return;

    const userMsgId = crypto.randomUUID();
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // 1. Add user question to UI
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: q, timestamp: now },
    ]);

    // 2. Clear input
    if (!queryText) {
      setInputQuery("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }

    // 3. Call real POST /api/v1/rag/ask endpoint with loading state
    setIsLoading(true);

    try {
      const res = await askRag({ query: q });
      const assistantMsgId = crypto.randomUUID();
      const assistantNow = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      // 4 & 5. Render real backend answer and sources
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          timestamp: assistantNow,
        },
      ]);
    } catch (err: unknown) {
      const errorMsg = getApiErrorMessage(
        err,
        "Unable to generate an answer. Please verify your connection and try again."
      );

      const errorMsgId = crypto.randomUUID();
      const errorNow = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      setMessages((prev) => [
        ...prev,
        {
          id: errorMsgId,
          role: "assistant",
          content: "",
          error: errorMsg,
          failedQuery: q,
          timestamp: errorNow,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearConversation = () => {
    if (isLoading) return;
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="shrink-0 mb-4">
        <PageHeader
          title="AI Assistant"
          description="Grounded maritime copilot answering questions strictly using your uploaded maritime documents."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "AI Assistant" },
          ]}
          actions={
            messages.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearConversation}
                disabled={isLoading}
                title="Clear current conversation"
                aria-label="Clear current conversation"
                className="gap-1 text-xs"
              >
                <CloseIcon size={14} />
                <span>Clear chat</span>
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Main Conversation Workspace */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              icon={<AIAssistantIcon size={28} className="text-blue-600" />}
              badgeText="Grounded Maritime Intelligence"
              title="Ask Anything About Your Documents"
              description="Inquire about charter party clauses, demurrage rates, laytime definitions, and notice of readiness terms. Answers are verified and grounded against your organization's indexed documents using BGE-M3 embeddings and Gemma 3:1B."
              action={
                <Link href="/documents">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <DocumentsIcon size={14} />
                    <span>View Documents</span>
                  </Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div
            className="flex-1 p-4 sm:p-6 space-y-6"
            role="log"
            aria-live="polite"
            aria-label="Conversation message history"
          >
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end items-start gap-3">
                    <div className="max-w-[85%] sm:max-w-[75%] space-y-1">
                      <div className="rounded-2xl rounded-tr-xs bg-blue-600 px-4 py-3 text-white text-sm leading-relaxed shadow-xs">
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                      <span className="block text-[11px] text-slate-400 text-right pr-1 font-mono">
                        {msg.timestamp}
                      </span>
                    </div>
                    <div
                      className="shrink-0 w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-semibold"
                      aria-hidden="true"
                    >
                      {userInitials}
                    </div>
                  </div>
                );
              }

              // Assistant message
              return (
                <div key={msg.id} className="flex justify-start items-start gap-3">
                  <div
                    className="shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 border border-blue-200/80 flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <AIAssistantIcon size={16} />
                  </div>
                  <div className="max-w-[90%] sm:max-w-[80%] space-y-1">
                    {msg.error ? (
                      /* Error state */
                      <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 text-xs text-red-800 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold break-words">{msg.error}</p>
                        </div>
                        {msg.failedQuery && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendMessage(msg.failedQuery)}
                            disabled={isLoading}
                            className="gap-1.5 text-xs bg-white hover:bg-slate-50 border-red-200 text-red-700 hover:text-red-800"
                          >
                            <RefreshIcon size={12} />
                            <span>Retry question</span>
                          </Button>
                        )}
                      </div>
                    ) : (
                      /* Grounded Answer Card */
                      <div className="rounded-2xl rounded-tl-xs bg-slate-50/90 border border-slate-200/80 p-4 sm:p-5 text-slate-900 shadow-xs space-y-3">
                        <p className="whitespace-pre-wrap break-words leading-relaxed text-sm text-slate-800">
                          {msg.content}
                        </p>

                        {/* Source Citations */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="pt-3 border-t border-slate-200/70 space-y-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                              <DocumentsIcon size={13} className="text-slate-400" />
                              <span>Sources Cited ({msg.sources.length})</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {msg.sources.map((src) => (
                                <div
                                  key={src.chunk_id}
                                  className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-slate-200/80 text-xs shadow-2xs hover:border-slate-300 transition-colors"
                                >
                                  <div className="mt-0.5 shrink-0 rounded bg-slate-50 p-1 border border-slate-200 text-slate-500">
                                    <DocumentsIcon size={13} />
                                  </div>
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <p
                                      className="font-semibold text-slate-800 truncate"
                                      title={src.document_title}
                                    >
                                      {src.document_title}
                                    </p>
                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                      {src.page_number !== null && (
                                        <span>Page {src.page_number}</span>
                                      )}
                                      {src.page_number !== null && <span>•</span>}
                                      <span className="font-mono text-slate-600">
                                        Score: {Math.round(src.score * 100)}%
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <span className="block text-[11px] text-slate-400 pl-1 font-mono">
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Loading state message placeholder */}
            {isLoading && (
              <div className="flex justify-start items-start gap-3">
                <div
                  className="shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 border border-blue-200/80 flex items-center justify-center animate-pulse"
                  aria-hidden="true"
                >
                  <AIAssistantIcon size={16} />
                </div>
                <div className="rounded-2xl rounded-tl-xs bg-slate-50/90 border border-slate-200/80 px-4 py-3 text-slate-600 text-xs shadow-xs flex items-center gap-2.5">
                  <SpinnerIcon size={14} className="text-blue-600" />
                  <span>Searching organization documents and generating answer...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Question Composer */}
      <div className="shrink-0 mt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative bg-white rounded-xl border border-slate-200/90 shadow-xs p-2 sm:p-2.5 focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent transition-all"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputQuery}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              maxLength={2000}
              placeholder="Ask a question about your charter parties, notices of readiness, or statements of facts..."
              aria-label="Ask a question about your documents"
              className="w-full resize-none rounded-lg p-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none max-h-40 min-h-[40px] leading-relaxed"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!inputQuery.trim() || isLoading}
              aria-label="Send question"
              className="h-10 px-3.5 gap-1.5 shrink-0"
            >
              {isLoading ? (
                <SpinnerIcon size={16} />
              ) : (
                <>
                  <SendIcon size={15} />
                  <span className="hidden sm:inline">Send</span>
                </>
              )}
            </Button>
          </div>
          <div className="flex items-center justify-between px-2 pt-1.5 text-[11px] text-slate-400">
            <span>
              Press <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">Enter</kbd> to send,{" "}
              <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">Shift + Enter</kbd> for new line
            </span>
            <span className="hidden sm:inline">Grounded on indexed documents</span>
          </div>
        </form>
      </div>
    </div>
  );
}
