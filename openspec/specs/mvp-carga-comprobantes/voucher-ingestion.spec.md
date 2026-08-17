# Voucher Ingestion Specification

**Change**: mvp-carga-comprobantes
**Link**: openspec/proposal/mvp-carga-comprobantes.md
**Author**: SDD Executor
**Date**: 2026-08-17
**Status**: Draft — Phase A (Spec)

## Purpose

Enable accountants to upload an ARCA "Mis Comprobantes" received-voucher export and their accounting-system export. The ingestion layer streams both files from the Next.js frontend to NestJS without whole-file buffering, validates format/encoding, and stages rows into PostgreSQL via `COPY FROM STDIN` inside a BullMQ background job.

## Requirements

### RF-01: Two-file multipart upload streamed to NestJS

The system SHALL accept a multipart upload of exactly two files (ARCA received-voucher export + contabilidad export) via a single `POST /api/reconciliations` request.

#### Scenario: Happy-path dual upload

- GIVEN an authenticated accountant user on the upload form
- WHEN they select one ARCA CSV/XLSX and one contabilidad CSV/XLSX and submit
- THEN the browser initiates a streaming `POST /api/reconciliations` with both files as multipart form data
- AND the API responds HTTP 202 with a `job_id`

#### Scenario: Missing one file

- GIVEN the upload form is open
- WHEN the user submits with only one file attached
- THEN the API responds HTTP 400 with `{ "error": "Both ARCA and contabilidad files are required" }`
- AND no staging or background job is created

### RF-02: File size limits and type whitelist

The system MUST enforce a maximum file size of 50 MB per file and a type whitelist of `.csv`, `.xlsx`, `.xls`.

#### Scenario: File exceeds size limit

- GIVEN a file larger than 50 MB
- WHEN the upload request is received
- THEN the API responds HTTP 413 Payload Too Large
- AND the connection is terminated without staging

#### Scenario: Disallowed file extension

- GIVEN a file named `export.pdf`
- WHEN the upload request is received
- THEN the API responds HTTP 415 Unsupported Media Type with `{ "error": "Accepted types: csv, xlsx, xls" }`

### RF-03: Streaming upload to staging table via COPY FROM STDIN

The system MUST stream each parsed row into a staging table (`staging_import`) using `COPY FROM STDIN` inside a BullMQ background job, dropping indexes before load and rebuilding them after.

#### Scenario: Staging 1,000 ARCA rows

- GIVEN a valid ARCA CSV with 1,000 rows
- WHEN the background job processes it
- THEN all 1,000 rows are inserted into `staging_import` via `COPY FROM STDIN`
- AND the `file_source` column is set to `'arca'` for each row
- AND no whole-file buffer is held in memory

#### Scenario: Corrupt XLS parsing mid-stream

- GIVEN a partially corrupt XLSX file
- WHEN the streaming parser encounters an unparseable sheet
- THEN the job records the error in `audit_log` with `action = 'staging_error'`
- AND the partially staged rows are rolled back via `COPY` abort
- AND the HTTP poll endpoint returns `{ "status": "error", "detail": "..." }`

### RF-04: Job status polling endpoint

The system SHALL return a `job_id` on upload and expose `GET /api/reconciliations/:jobId/status` returning `{ status: 'pending' | 'processing' | 'completed' | 'error', counts?: {...} }`.

#### Scenario: Poll pending job

- GIVEN a job id `abc123` exists with status `pending`
- WHEN `GET /api/reconciliations/abc123/status` is called
- THEN the response is HTTP 200 with `{ "status": "pending" }`

#### Scenario: Poll completed job

- GIVEN a job id `abc123` has finished processing
- WHEN `GET /api/reconciliations/abc123/status` is called
- THEN the response is HTTP 200 with `{ "status": "completed", "counts": { "arca_rows": 1000, "contabilidad_rows": 950 } }`

## Acceptance Criteria

1. POST `/api/reconciliations` with two valid files returns 202 + job_id
2. POST with missing file returns 400
3. POST with >50 MB file returns 413
4. POST with non-whitelisted extension returns 415
5. Staging uses `COPY FROM STDIN`, no whole-file buffering
6. `GET /api/reconciliations/:jobId/status` returns correct status object
7. Corrupt file causes job error, not API crash

## Data Schema

```json
// Request (multipart form-data)
{
  "arca_file": "<file stream>",
  "contabilidad_file": "<file stream>"
}

// Response 202
{
  "job_id": "abc123",
  "status_url": "/api/reconciliations/abc123/status"
}

// Response 200 (poll)
{
  "status": "completed",
  "counts": {
    "arca_rows": 1000,
    "contabilidad_rows": 950
  }
}
```

### staging_import table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK | |
| file_source | text | `'arca' \| 'contabilidad'` |
| row_data | jsonb | raw parsed row, unindexed |
| created_at | timestamptz | |

## TDD Markers

- RED: POST returns 202 with job_id before endpoint exists
- RED: Status poll returns `pending` before job processing is wired
- GREEN: Streaming pipeline stages rows via COPY
- GREEN: Corrupt file → job error, not crash
- REFACTOR: Extract streaming parser strategy per file type

## Non-Goals / Out of Scope

- Fuzzy matching (Levenshtein, tolerance-based) — deferred to stretch
- Automated ARCA web-service fetch — upload only
- Client-facing portal or mobile app — accountant desktop UX
- Excel/XLS parsing in the Vercel serverless function — must stream to NestJS
