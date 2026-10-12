# Períodos Specification

**Change**: conciliacion-periodica
**Link**: openspec/proposal/conciliacion-periodica.md
**Author**: Claude
**Date**: 2026-08-22
**Status**: Draft — Phase A (Spec)

## Purpose

Introduce a per-tenant "período" (calendar month) as the unit a reconciliation run belongs to, replacing the current model where an upload is only ever scoped to an isolated `job_id`. A período can receive multiple uploads while `abierto`, and gets explicitly `cerrado` by the accountant to freeze its results — per the client's own scope decision (2026-08-22): "un período puede recibir varias cargas".

## Requirements

### RF-12: Create and query períodos, one per tenant per calendar month

The system MUST let a tenant create a período for a given calendar month, and MUST reject creating a second período for a month that already has one for that tenant.

#### Scenario: Create a período

- GIVEN tenant `T1` has no período for `2026-04`
- WHEN `POST /api/periodos` is called with `{ tenant_id: T1, mes: "2026-04-01" }`
- THEN a período is created with `estado = 'abierto'`
- AND the response includes the new período's `id`

#### Scenario: Reject a duplicate período for the same tenant + month

- GIVEN tenant `T1` already has a período for `2026-04`
- WHEN `POST /api/periodos` is called again with `{ tenant_id: T1, mes: "2026-04-01" }`
- THEN the request is rejected with `409 Conflict`
- AND no second row is created (enforced by the `UNIQUE (tenant_id, mes)` constraint, not just app-layer validation)

#### Scenario: Two tenants can each have their own período for the same month

- GIVEN tenant `T1` and tenant `T2` both want a período for `2026-04`
- WHEN each creates one independently
- THEN both succeed — the uniqueness constraint is per-tenant, not global

### RF-13: A período can receive multiple uploads while abierto; a cerrado período rejects new uploads

The system MUST let `POST /api/reconciliations` be called more than once against the same open período, and MUST reject an upload targeting a período that is `cerrado`.

#### Scenario: Second upload into the same open período is accepted

- GIVEN período `P1` is `abierto` and already received one upload (ARCA + Sistema files)
- WHEN a second pair of files is uploaded with `periodo_id = P1`
- THEN the upload is accepted (`202 Accepted`, same contract as today)
- AND both uploads' rows are considered together the next time `P1`'s matching runs (see `matching-periodico.spec.md`)

#### Scenario: Upload rejected against a closed período

- GIVEN período `P1` has `estado = 'cerrado'`
- WHEN a file pair is uploaded with `periodo_id = P1`
- THEN the request is rejected with `400 Bad Request` and an error indicating the período is closed
- AND no job is enqueued

#### Scenario: Upload without a `periodo_id` is rejected

- GIVEN a client calls `POST /api/reconciliations` without `periodo_id`
- WHEN the request is validated
- THEN it is rejected with `400 Bad Request` — `periodo_id` is now required, same precedence tier as the existing `tenant_id`/`contabilidad_source_system` checks

## Open Questions Carried Into This Spec

- Whether a closed período can ever be reopened (proposal.md's open question #1) — this spec assumes no reopen action exists; add one later if the client confirms it's needed.
