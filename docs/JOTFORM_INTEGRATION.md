# Jotform Integration Plan

## The live form

Created in the org's Jotform account on 2026-06-11:

- **Title:** Receipt Submission — AMEX Business Card
- **Form ID:** `261617924502052`
- **URL:** https://form.jotform.com/261617924502052
- **Fields:** Full Name, Email, Transaction Date, Transaction Amount (USD),
  Vendor / Merchant Name, Purchase Category (dropdown), Wine Items (multi-select),
  Class / Program Items (multi-select), Notes / Description, Receipt Image
  (file upload, multiple, images/PDF), Related AMEX Charge ID (helper field for
  deep links).

The form remains fully editable inside Jotform. The admin can also point the app
at a *different* form at any time via Admin Settings → Jotform Form ID.

## Chosen approach: Option B (API-driven) with a webview-link fallback

| Option | Verdict |
|---|---|
| A. Embed form in a webview | Rejected as the primary path: no native camera UX, can't prefill the charge link reliably, no offline photo retention, and the in-app experience is just a worse browser. |
| **B. Jotform API, dynamic fields** | **Chosen.** Native camera + form UX in the app; submissions posted to the Jotform API so finance still sees everything in Jotform; field discovery is dynamic so form edits don't break the app. |
| C. Hybrid | Partially adopted: reminder **emails** link to the hosted Jotform URL (with the charge ID prefilled via URL parameter), so a staff member can submit from any device without the app installed. |

## How form changes don't break the app

1. On a schedule (and on demand from Admin Settings), the backend calls
   `GET https://api.jotform.com/form/{formId}/questions?apiKey=…`.
2. It builds a **field map** by matching question *names/types* with fuzzy rules
   (e.g. a `control_datetime` whose label contains "date" → `transaction_date`;
   a number/currency field whose label contains "amount" → `amount`;
   `control_fileupload` → `image`). The map is stored in `app_settings` and is
   admin-reviewable.
3. Submissions are written/read using the map's question IDs, never hardcoded IDs.
4. The **entire raw submission payload** is stored on the receipt row
   (`raw_payload` JSON), so even unmapped/new questions are never lost — they can
   be remapped retroactively.
5. If a *required* mapping (amount, date, image) can no longer be resolved after
   a form edit, the sync flags it in the admin dashboard instead of failing
   silently.

## Data flow

**In-app submission:**
1. User photographs/picks receipt → fills native fields → submits.
2. Backend stores the receipt row + image locally **first** (so a Jotform outage
   never loses a receipt), then forwards to
   `POST https://api.jotform.com/form/{formId}/submissions` with the mapped
   question IDs and the image file.
3. The returned `submissionID` is saved as `jotform_submission_id`. If the
   forward fails, the receipt row is marked `jotform_status='pending'` and a
   retry job re-forwards it — resolving the "local record exists but Jotform
   submission failed" edge case. The reverse case (Jotform has it, we don't) is
   covered by the poller below.

**Direct Jotform submission (email link / no app):**
1. Reminder emails link to `https://form.jotform.com/261617924502052?relatedAmex={chargeToken}`
   so the helper field arrives prefilled.
2. The backend polls `GET /form/{formId}/submissions` (filtered by
   `created_at > last_sync`), creates receipt rows for unseen `submissionID`s
   (dedup key), downloads images, attributes the submitter by email match against
   `users`, and runs the matcher. A prefilled charge ID becomes a direct match
   candidate at high confidence.

## Credentials

- `JOTFORM_API_KEY` env var (created at jotform.com → Settings → API; "Full
  access" so the backend can read submissions and post new ones).
- Never shipped in the mobile app — the app only talks to our backend.
