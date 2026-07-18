"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listEscalations, type Escalation } from "@/lib/api";
import styles from "./page.module.css";

const POLL_MS = 4000;

function urgencyClass(urgency: Escalation["urgency"], status: Escalation["status"]) {
  if (status === "resolved") return styles.badgeResolved;
  if (urgency === "emergency") return styles.badgeEmergency;
  if (urgency === "urgent") return styles.badgeUrgent;
  return styles.badge;
}

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function Inbox() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await listEscalations();
        if (!cancelled) {
          setEscalations(next);
          setError(null);
          setLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load inbox");
          setLoaded(true);
        }
      }
    }

    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const openCount = escalations.filter((e) => e.status !== "resolved").length;

  return (
    <div className={styles.shell}>
      <header className={styles.brandBar}>
        <h1 className={styles.brand}>
          Scout &amp; Sage
          <span>Clinician · WhatsApp handoffs</span>
        </h1>
        <p className={styles.live} aria-live="polite">
          <span className={styles.liveDot} aria-hidden />
          {loaded
            ? `${openCount} open · refreshing`
            : "Connecting to inbox…"}
        </p>
      </header>

      <main className={styles.main}>
        <h2 className={styles.heading}>Open cases</h2>
        <p className={styles.sub}>
          When Scout escalates, the thread lands here. Reply on WhatsApp, then
          return the patient to Scout when you&apos;re done.
        </p>

        {error ? <p className={styles.error}>{error}</p> : null}

        {!error && loaded && escalations.length === 0 ? (
          <p className={styles.empty}>
            No escalations yet. They appear when Scout calls escalate to
            clinician.
          </p>
        ) : null}

        <ul className={styles.list}>
          {escalations.map((item) => (
            <li key={item.id}>
              <Link href={`/escalations/${item.id}`} className={styles.row}>
                <span className={styles.name}>{item.patientName}</span>
                <span
                  className={`${styles.badge} ${urgencyClass(item.urgency, item.status)}`}
                >
                  {item.status === "resolved" ? "resolved" : item.urgency}
                </span>
                <span className={styles.meta}>
                  {item.summary}
                  <br />
                  {item.phoneNumber} · {formatWhen(item.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
