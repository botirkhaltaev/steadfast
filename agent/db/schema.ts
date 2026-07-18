import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const escalations = pgTable(
  "escalations",
  {
    id: text("id").primaryKey(),
    phoneNumber: text("phone_number").notNull(),
    conversationId: text("conversation_id").notNull(),
    patientName: text("patient_name").notNull(),
    week: integer("week"),
    dose: text("dose"),
    risk: text("risk").notNull(),
    urgency: text("urgency").notNull(),
    summary: text("summary").notNull(),
    transcriptSnippet: text("transcript_snippet").notNull(),
    redFlag: text("red_flag").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("escalations_status_idx").on(t.status),
    index("escalations_phone_idx").on(t.phoneNumber),
    index("escalations_updated_at_idx").on(t.updatedAt),
  ],
);

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const deviceSupportLinks = pgTable(
  "device_support_links",
  {
    sid: text("sid").primaryKey(),
    phoneNumber: text("phone_number").notNull(),
    conversationId: text("conversation_id").notNull(),
    patientName: text("patient_name"),
    reason: text("reason"),
    exp: integer("exp").notNull(),
    status: text("status").notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("device_support_links_phone_idx").on(t.phoneNumber),
    index("device_support_links_exp_idx").on(t.exp),
  ],
);
