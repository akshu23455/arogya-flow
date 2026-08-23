import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: text("role", { enum: ["patient", "doctor", "admin"] }).notNull(),
  passwordHash: text("password_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const doctorProfiles = sqliteTable("doctor_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  specialisation: text("specialisation").notNull(),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
  workingHoursJson: text("working_hours_json").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const doctorLeaves = sqliteTable("doctor_leaves", {
  id: text("id").primaryKey(),
  doctorId: text("doctor_id").notNull().references(() => doctorProfiles.id),
  leaveDate: text("leave_date").notNull(),
  reason: text("reason").notNull().default("Unavailable"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("doctor_leave_date_unique").on(table.doctorId, table.leaveDate)]);

export const slotHolds = sqliteTable("slot_holds", {
  id: text("id").primaryKey(),
  doctorId: text("doctor_id").notNull().references(() => doctorProfiles.id),
  patientId: text("patient_id").notNull().references(() => users.id),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  localDate: text("local_date").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status", { enum: ["active", "consumed", "expired"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("active_doctor_slot_hold_unique")
    .on(table.doctorId, table.startsAt)
    .where(sql`${table.status} = 'active'`),
  index("slot_hold_expiry_idx").on(table.expiresAt),
]);

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  doctorId: text("doctor_id").notNull().references(() => doctorProfiles.id),
  patientId: text("patient_id").notNull().references(() => users.id),
  holdId: text("hold_id").notNull().unique().references(() => slotHolds.id),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  localDate: text("local_date").notNull(),
  status: text("status", { enum: ["scheduled", "completed", "cancelled", "leave_conflict"] }).notNull().default("scheduled"),
  patientCalendarEventId: text("patient_calendar_event_id"),
  doctorCalendarEventId: text("doctor_calendar_event_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("doctor_appointment_slot_unique")
    .on(table.doctorId, table.startsAt)
    .where(sql`${table.status} = 'scheduled'`),
  index("patient_appointment_idx").on(table.patientId, table.startsAt),
]);

export const symptomIntakes = sqliteTable("symptom_intakes", {
  id: text("id").primaryKey(),
  appointmentId: text("appointment_id").notNull().unique().references(() => appointments.id),
  rawSymptoms: text("raw_symptoms").notNull(),
  urgency: text("urgency", { enum: ["Low", "Medium", "High", "Unknown"] }).notNull().default("Unknown"),
  chiefComplaint: text("chief_complaint"),
  suggestedQuestionsJson: text("suggested_questions_json"),
  aiStatus: text("ai_status", { enum: ["ready", "fallback", "failed"] }).notNull().default("fallback"),
  promptVersion: text("prompt_version").notNull().default("previsit-v1"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const calendarConnections = sqliteTable("calendar_connections", {
  userId: text("user_id").primaryKey().references(() => users.id),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  calendarId: text("calendar_id").notNull().default("primary"),
  scopes: text("scopes").notNull(),
  connectedAt: text("connected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const visitNotes = sqliteTable("visit_notes", {
  id: text("id").primaryKey(),
  appointmentId: text("appointment_id").notNull().unique().references(() => appointments.id),
  clinicalNotes: text("clinical_notes").notNull(),
  prescriptionJson: text("prescription_json").notNull().default("[]"),
  patientSummary: text("patient_summary"),
  aiStatus: text("ai_status", { enum: ["ready", "fallback", "failed"] }).notNull().default("fallback"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const medicationSchedules = sqliteTable("medication_schedules", {
  id: text("id").primaryKey(),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  patientId: text("patient_id").notNull().references(() => users.id),
  medicineName: text("medicine_name").notNull(),
  dosage: text("dosage").notNull(),
  frequency: text("frequency").notNull(),
  timesJson: text("times_json").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("medication_active_date_idx").on(table.active, table.startDate, table.endDate)]);

export const notificationJobs = sqliteTable("notification_jobs", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  appointmentId: text("appointment_id").references(() => appointments.id),
  kind: text("kind", { enum: ["booking", "reminder", "cancellation", "medication", "calendar"] }).notNull(),
  channel: text("channel", { enum: ["email", "calendar"] }).notNull(),
  recipient: text("recipient").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status", { enum: ["pending", "processing", "delivered", "retrying", "dead_letter"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastError: text("last_error"),
  deliveredAt: text("delivered_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("notification_due_idx").on(table.status, table.nextAttemptAt)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_entity_idx").on(table.entityType, table.entityId)]);
