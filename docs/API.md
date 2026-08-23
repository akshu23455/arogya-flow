# API reference

All JSON endpoints use a signed HttpOnly `arogyaflow_session` cookie unless a worker-secret route is noted. Role checks happen server-side.

## Authentication

### `POST /api/auth/register`

Creates a patient account. Body: `{ "fullName", "email", "password" }`. Passwords use PBKDF2-SHA256 with a unique salt and 210,000 iterations.

### `POST /api/auth/login`

Authenticates any provisioned role and returns an eight-hour signed session cookie. Body: `{ "email", "password" }`.

### `POST /api/auth/logout`

Clears the session cookie.

## Booking

### `POST /api/slots/hold` — patient

Body:

```json
{
  "doctorId": "doctor-uuid",
  "startsAt": "2026-08-24T05:00:00.000Z",
  "endsAt": "2026-08-24T05:30:00.000Z",
  "localDate": "2026-08-24"
}
```

Returns a two-minute hold. `409` means another active hold, appointment, or doctor leave won the race.

### `POST /api/appointments` — patient

Body: `{ "holdId", "symptoms" }`. Consumes a valid hold, creates the appointment and intake, and queues patient email, doctor email, and two Calendar jobs. A unique scheduled-doctor-slot index is the final collision guard.

### `GET /api/appointments` — patient / doctor / admin

Returns only appointments visible to the signed-in role: own patient appointments, own doctor schedule, or the admin view.

### `POST /api/appointments/:id/visit` — doctor

Completes a visit, stores original notes, generates a friendly draft, and creates medication schedules.

```json
{
  "clinicalNotes": "Viral fever suspected...",
  "approveSummary": true,
  "medications": [
    {
      "name": "Paracetamol",
      "dosage": "500 mg after food",
      "frequency": "twice daily",
      "times": ["08:30", "20:30"],
      "startDate": "2026-08-24",
      "endDate": "2026-08-27"
    }
  ]
}
```

## AI

### `POST /api/ai/summarize` — role scoped

Body: `{ "kind": "previsit|postvisit", "appointmentId", "text" }`. Patients may update their pre-visit intake; only the assigned doctor (or admin) may generate post-visit content. Every response reports `aiStatus` as `ready` or `fallback`.

## Admin

### `POST /api/doctors/leave` — admin

Body: `{ "doctorId", "leaveDate", "reason" }`. Inserts leave, flags existing bookings, and queues cancellation and Calendar deletion jobs. Returns affected counts.

## Google Calendar OAuth 2.0

### `GET /api/integrations/google/start` — patient / doctor

Starts Google consent with an HttpOnly, short-lived state cookie.

### `GET /api/integrations/google/callback`

Validates state, exchanges the authorization code, encrypts the offline refresh token with AES-GCM, and upserts the connection.

## Background jobs

The following routes accept either an admin session or `Authorization: Bearer $WORKER_SECRET` and are intended for a scheduler.

### `POST /api/jobs/schedule-medications`

Creates one idempotent email job per schedule/date/time. Body may provide `{ "localDate": "YYYY-MM-DD" }` for deterministic scheduler runs.

### `POST /api/jobs/process`

Claims up to 20 due jobs and dispatches email or Calendar operations. Failures use exponential backoff; attempt five moves the job to `dead_letter`.

## Error shape

```json
{ "error": "Human-readable explanation" }
```

Expected status codes: `400` validation, `401` unauthenticated, `403` role violation, `404` invisible/missing resource, `409` scheduling conflict, `502` provider failure, and `503` temporary service failure.
