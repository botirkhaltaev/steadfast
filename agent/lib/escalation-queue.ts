import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "#db/client";
import { escalations } from "#db/schema";
import { normalizePhone } from "#lib/phone";
import type { DropoutRisk } from "#lib/store";

export type QueuedEscalation = {
  id: string;
  phoneNumber: string;
  conversationId: string;
  patientName: string;
  week: number | null;
  dose: string | null;
  risk: DropoutRisk;
  urgency: "routine" | "urgent" | "emergency";
  summary: string;
  transcriptSnippet: string;
  redFlag: string;
  status: "open" | "notified" | "resolved";
  createdAt: string;
  updatedAt: string;
};

function now() {
  return new Date().toISOString();
}

function rowToCard(row: typeof escalations.$inferSelect): QueuedEscalation {
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    conversationId: row.conversationId,
    patientName: row.patientName,
    week: row.week,
    dose: row.dose,
    risk: row.risk as DropoutRisk,
    urgency: row.urgency as QueuedEscalation["urgency"],
    summary: row.summary,
    transcriptSnippet: row.transcriptSnippet,
    redFlag: row.redFlag,
    status: row.status as QueuedEscalation["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertEscalation(
  input: Omit<QueuedEscalation, "createdAt" | "updatedAt" | "status"> & {
    status?: QueuedEscalation["status"];
  },
): Promise<QueuedEscalation> {
  const db = getDb();
  const ts = now();
  const phoneNumber = normalizePhone(input.phoneNumber);
  const status = input.status ?? "open";

  const existing = await db
    .select()
    .from(escalations)
    .where(eq(escalations.id, input.id))
    .limit(1);

  const createdAt = existing[0]?.createdAt ?? ts;

  await db
    .insert(escalations)
    .values({
      id: input.id,
      phoneNumber,
      conversationId: input.conversationId,
      patientName: input.patientName,
      week: input.week,
      dose: input.dose,
      risk: input.risk,
      urgency: input.urgency,
      summary: input.summary,
      transcriptSnippet: input.transcriptSnippet,
      redFlag: input.redFlag,
      status,
      createdAt,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: escalations.id,
      set: {
        phoneNumber,
        conversationId: input.conversationId,
        patientName: input.patientName,
        week: input.week,
        dose: input.dose,
        risk: input.risk,
        urgency: input.urgency,
        summary: input.summary,
        transcriptSnippet: input.transcriptSnippet,
        redFlag: input.redFlag,
        status,
        updatedAt: ts,
      },
    });

  // Cap history for demo store.
  const overflow = await db
    .select({ id: escalations.id })
    .from(escalations)
    .orderBy(desc(escalations.updatedAt))
    .offset(200);

  if (overflow.length > 0) {
    await db.delete(escalations).where(
      inArray(
        escalations.id,
        overflow.map((r) => r.id),
      ),
    );
  }

  return {
    id: input.id,
    phoneNumber,
    conversationId: input.conversationId,
    patientName: input.patientName,
    week: input.week,
    dose: input.dose,
    risk: input.risk,
    urgency: input.urgency,
    summary: input.summary,
    transcriptSnippet: input.transcriptSnippet,
    redFlag: input.redFlag,
    status,
    createdAt,
    updatedAt: ts,
  };
}

export async function listEscalations(): Promise<QueuedEscalation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(escalations)
    .orderBy(
      sql`case when ${escalations.status} = 'resolved' then 1 else 0 end`,
      desc(escalations.updatedAt),
    );

  return rows.map(rowToCard);
}

export async function getEscalation(
  id: string,
): Promise<QueuedEscalation | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(escalations)
    .where(eq(escalations.id, id))
    .limit(1);
  return rows[0] ? rowToCard(rows[0]) : null;
}

export async function openHandoffForPhone(
  phoneNumber: string,
): Promise<QueuedEscalation | null> {
  const db = getDb();
  const phone = normalizePhone(phoneNumber);
  const rows = await db
    .select()
    .from(escalations)
    .where(
      and(
        eq(escalations.phoneNumber, phone),
        ne(escalations.status, "resolved"),
      ),
    )
    .orderBy(desc(escalations.updatedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.status !== "open" && row.status !== "notified") return null;
  return rowToCard(row);
}

export async function phoneHasHumanHandoff(
  phoneNumber: string,
): Promise<boolean> {
  return Boolean(await openHandoffForPhone(phoneNumber));
}

export async function markQueuedNotified(
  id: string,
): Promise<QueuedEscalation | null> {
  const card = await getEscalation(id);
  if (!card || card.status === "resolved") return card;
  return upsertEscalation({ ...card, status: "notified" });
}

export async function resolveEscalation(
  id: string,
): Promise<QueuedEscalation | null> {
  const card = await getEscalation(id);
  if (!card) return null;
  return upsertEscalation({ ...card, status: "resolved" });
}
