"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getEscalation,
  listEscalationMessages,
  resolveEscalation,
  sendEscalationMessage,
  type Escalation,
  type ThreadMessage,
} from "@/lib/api";
import styles from "./thread.module.css";

const POLL_MS = 3000;

function isOutbound(message: ThreadMessage): boolean {
  const direction = (message.direction ?? "").toLowerCase();
  const role = (message.role ?? "").toLowerCase();
  if (direction === "outbound" || direction === "out" || direction === "sent") {
    return true;
  }
  if (role === "assistant" || role === "agent" || role === "system") {
    return true;
  }
  const text = message.text ?? "";
  return text.startsWith("[Care team]");
}

function formatWhen(iso?: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ThreadView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [escalation, setEscalation] = useState<Escalation | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [card, thread] = await Promise.all([
          getEscalation(id),
          listEscalationMessages(id),
        ]);
        if (!cancelled) {
          setEscalation(card);
          setMessages(thread);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load thread");
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const resolved = escalation?.status === "resolved";

  const title = useMemo(
    () => escalation?.patientName ?? "Thread",
    [escalation?.patientName],
  );

  async function onSend(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending || resolved) return;
    setSending(true);
    setError(null);
    try {
      await sendEscalationMessage(id, trimmed);
      setText("");
      const thread = await listEscalationMessages(id);
      setMessages(thread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function onResolve() {
    if (resolving || resolved) return;
    setResolving(true);
    setError(null);
    try {
      const card = await resolveEscalation(id);
      setEscalation(card);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.back}>
          ← Inbox
        </Link>
        <h1 className={styles.brand}>{title}</h1>
        {escalation ? (
          <p className={styles.meta}>
            {escalation.phoneNumber}
            {escalation.dose ? ` · ${escalation.dose}` : ""}
            {escalation.week != null ? ` · week ${escalation.week}` : ""}
            <br />
            {escalation.summary}
          </p>
        ) : null}
        <div className={styles.actions}>
          {resolved ? (
            <span className={styles.resolvedNote}>
              Returned to Scout — AI coaching resumes on the next patient message.
            </span>
          ) : (
            <button
              type="button"
              className={styles.resolve}
              onClick={() => void onResolve()}
              disabled={resolving || !escalation}
            >
              {resolving ? "Returning…" : "Resolve / return to Scout"}
            </button>
          )}
        </div>
      </header>

      <section className={styles.thread} aria-live="polite">
        {messages.length === 0 ? (
          <p className={styles.empty}>
            {error ? error : "Loading WhatsApp thread…"}
          </p>
        ) : (
          messages.map((message, index) => {
            const outbound = isOutbound(message);
            return (
              <article
                key={message.id ?? `${index}-${message.createdAt ?? ""}`}
                className={`${styles.bubble} ${outbound ? styles.bubbleOut : styles.bubbleIn}`}
              >
                {message.text || "(no text)"}
                {message.createdAt ? (
                  <span className={styles.bubbleMeta}>
                    {outbound ? "Care team · " : "Patient · "}
                    {formatWhen(message.createdAt)}
                  </span>
                ) : null}
              </article>
            );
          })
        )}
        <div ref={bottomRef} />
      </section>

      <form className={styles.composer} onSubmit={(e) => void onSend(e)}>
        <label htmlFor="reply">Reply on WhatsApp</label>
        <textarea
          id="reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            resolved
              ? "Case resolved — Scout owns this thread again."
              : "Message the patient…"
          }
          disabled={resolved || sending}
        />
        <div className={styles.sendRow}>
          <span className={styles.hint}>Sent as [Care team]</span>
          <button
            type="submit"
            className={styles.send}
            disabled={resolved || sending || !text.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </form>
    </div>
  );
}
