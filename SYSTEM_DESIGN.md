# System design (683 words)

## Booking conflicts and simultaneous requests

The user-facing booking process starts with a two-minute slot hold. A hold records the doctor, patient, UTC start/end, clinic-local date, and expiry time. Before insertion, expired holds are marked inactive. The insert itself is conditional: it succeeds only when the doctor is active, is not on leave for that local date, and has no scheduled appointment at that instant.

Application checks improve the response message, but database constraints are the source of truth. A partial unique index permits only one `active` hold for a doctor/start pair. A second partial unique index permits only one `scheduled` appointment for the same pair. If two requests reach different server instances at the same time, D1 serializes writes and one insert wins; the other receives `409 Conflict`. No process-local lock is required.

Confirmation creates the appointment by selecting from a hold that belongs to the signed-in patient, remains active, has not expired, and still has no leave conflict. The operation also consumes the hold, creates the symptom intake, queues notifications, and writes an audit event in one database batch. The appointment has a unique `hold_id`, so even repeated confirmation requests cannot create multiple appointments. Cancelled appointments and expired holds do not permanently block a later booking because the unique indexes apply only to active states.

The model stores both UTC timestamps and `local_date`. This avoids comparing a UTC date substring with a doctor’s local leave day, a common boundary bug for evening or early-morning appointments.

## Doctor leave with existing bookings

Only an admin session can create leave. The operation inserts a unique doctor/date record, changes every scheduled appointment on that local date to `leave_conflict`, creates idempotent patient notification jobs, creates Calendar deletion jobs for both parties, and records an audit event. These statements run as one serialized batch.

This design also closes the leave-versus-booking race. If booking commits first, the leave batch sees and flags it. If leave commits first, the conditional hold/appointment insert refuses the date. The API returns affected appointment and queued-notification counts so the admin interface can show impact before moving patients to ranked alternatives. Reassignment should create a new hold rather than silently modifying the original slot.

## Slot hold lifecycle

Holds use an explicit status (`active`, `consumed`, or `expired`) plus `expires_at`. Expired rows are retained for audit but ignored by the partial unique index. The client countdown is informational; the server clock decides validity. A background cleanup may expire rows in bulk, while every hold request also performs opportunistic cleanup, so availability does not depend on a scheduler running perfectly.

## Notification and Calendar reliability

External calls are never made inside booking or leave database operations. Instead, those operations write durable `notification_jobs`. Each logical effect has a stable idempotency key such as `booking:<appointment>:patient` or `calendar:create:<appointment>:doctor`. If a client retries or a worker restarts, `INSERT OR IGNORE` and the unique key prevent duplicates.

A worker claims due jobs by conditionally changing `pending/retrying` to `processing`; only the winner sends. Success stores `delivered_at`. Failure stores a bounded error message, increments attempts, and schedules exponential backoff. Five failures move the job to `dead_letter` for admin review without losing the appointment. Medication schedules generate date/time-specific idempotent jobs, so repeated scheduler runs are safe.

Google OAuth refresh tokens are encrypted with AES-256-GCM before storage. The Calendar adapter refreshes an access token only when processing a job, stores the provider event ID on the appointment, uses create/update for booking or rescheduling, and treats provider `404/410` during deletion as already complete.

## LLM reliability and safety

Pre-visit and post-visit prompts require JSON with narrow fields. Output is validated before storage. Provider errors, timeouts, missing credentials, malformed JSON, or missing fields activate a deterministic fallback rather than failing the booking. The database stores `ai_status` and a prompt version, making degraded output visible and auditable.

AI never diagnoses or invents treatment. The pre-visit brief retains the patient’s raw symptoms and highlights red-flag phrases for doctor review. Post-visit generation uses only doctor-authored notes and remains a draft until approval. The original clinical note is always preserved separately from the patient-friendly rendering.
