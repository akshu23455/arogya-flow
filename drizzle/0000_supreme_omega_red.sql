CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`doctor_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`hold_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`patient_calendar_event_id` text,
	`doctor_calendar_event_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hold_id`) REFERENCES `slot_holds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_hold_id_unique` ON `appointments` (`hold_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `doctor_appointment_slot_unique` ON `appointments` (`doctor_id`,`starts_at`) WHERE "appointments"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX `patient_appointment_idx` ON `appointments` (`patient_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `calendar_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`calendar_id` text DEFAULT 'primary' NOT NULL,
	`scopes` text NOT NULL,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `doctor_leaves` (
	`id` text PRIMARY KEY NOT NULL,
	`doctor_id` text NOT NULL,
	`leave_date` text NOT NULL,
	`reason` text DEFAULT 'Unavailable' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctor_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctor_leave_date_unique` ON `doctor_leaves` (`doctor_id`,`leave_date`);--> statement-breakpoint
CREATE TABLE `doctor_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`specialisation` text NOT NULL,
	`slot_duration_minutes` integer DEFAULT 30 NOT NULL,
	`working_hours_json` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctor_profiles_user_id_unique` ON `doctor_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `medication_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`medicine_name` text NOT NULL,
	`dosage` text NOT NULL,
	`frequency` text NOT NULL,
	`times_json` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `medication_active_date_idx` ON `medication_schedules` (`active`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `notification_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`appointment_id` text,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_error` text,
	`delivered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_jobs_idempotency_key_unique` ON `notification_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notification_due_idx` ON `notification_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `slot_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`doctor_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`local_date` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_doctor_slot_hold_unique` ON `slot_holds` (`doctor_id`,`starts_at`) WHERE "slot_holds"."status" = 'active';--> statement-breakpoint
CREATE INDEX `slot_hold_expiry_idx` ON `slot_holds` (`expires_at`);--> statement-breakpoint
CREATE TABLE `symptom_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`raw_symptoms` text NOT NULL,
	`urgency` text DEFAULT 'Unknown' NOT NULL,
	`chief_complaint` text,
	`suggested_questions_json` text,
	`ai_status` text DEFAULT 'fallback' NOT NULL,
	`prompt_version` text DEFAULT 'previsit-v1' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `symptom_intakes_appointment_id_unique` ON `symptom_intakes` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `visit_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`clinical_notes` text NOT NULL,
	`prescription_json` text DEFAULT '[]' NOT NULL,
	`patient_summary` text,
	`ai_status` text DEFAULT 'fallback' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_notes_appointment_id_unique` ON `visit_notes` (`appointment_id`);