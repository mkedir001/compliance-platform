# AxisCare integration

Read-only, tenant-scoped synchronization of AxisCare client, caregiver, visit, EVV, and rate data into Waldah. Waldah never writes to AxisCare and does not submit claims, invoices, payments, authorizations, or billing runs.

## Verified API contract

Implementation was checked against AxisCare's public OpenAPI `v2025-06-25` at <https://static.axiscare.com/api/documentation.html>.

- Account base URL: `https://{siteNumber}.axiscare.com`
- Authentication: bearer token
- Required API header: `X-AxisCare-Api-Version: 2023-10-01`
- Used documented GET endpoints: `/api/clients`, `/api/caregivers`, `/api/visits`
- Pagination follows the documented `results.nextPage` URL, constrained to the configured AxisCare origin.
- Incremental visit synchronization uses documented `updatedSinceDate` after the bounded initial history window.
- HTTP 429, 5xx, and transient network errors use bounded retries. Other 4xx responses do not retry.

No undocumented billing or claims endpoint is used or assumed.

## Tenant configuration and credentials

Organization administrators configure AxisCare under **Billing → AxisCare integration settings**. Each organization has a separate `AxisCareConnection` row and token ciphertext. Tokens are encrypted with AES-256-GCM, bound to the organization ID as authenticated associated data, and are never returned to the browser, logs, or audit metadata.

The application requires `AXISCARE_CREDENTIAL_ENCRYPTION_KEY`, a base64-encoded 32-byte value supplied through the existing production secret-injection process. No token or key belongs in Git or ordinary environment files. A saved connection begins as `CONFIGURATION_INCOMPLETE`; Waldah reports `CONNECTED` only after an authenticated API request succeeds. Other explicit states are `AUTHENTICATION_FAILED` and `CONNECTION_UNAVAILABLE`.

`organization.manage` is required to configure, test, synchronize, or manage caregiver/service mappings. Billing data additionally uses `billing.run` and `billing.view_billed`.

## Synchronization and data minimization

- Client and caregiver identity records are fetched by default; visits are synchronized separately.
- Initial visits are bounded by the configured history window (default 12 months); subsequent runs overlap the last successful cursor by five minutes and upsert by tenant/external ID.
- Client payloads retain only identity and matching fields. SSNs, addresses, contact data, and free-text notes are not stored.
- Caregiver payloads retain only identity/mapping fields. Sensitive fields are not requested or stored.
- Visit payloads retain the source fields needed for EVV, rate provenance, and troubleshooting; nested addresses are discarded.
- Contacts, applicants, ADLs, organizations, tagging categories, call logs, and notes are off by default. The UI does not enable them.
- No scheduled production job is activated by this change. Administrators may request a bounded read-only sync after a connection is verified; the authenticated job endpoint remains available for a separately approved deployment phase.

## Mappings

- **Clients:** synchronization creates review suggestions but never links clients automatically. Even a unique exact first name + last name + date-of-birth candidate requires one-time administrator confirmation. Serializable, tenant-scoped conditional updates and a database uniqueness constraint prevent duplicate or overwritten links.
- **Caregivers/employees:** always mapped explicitly by an organization administrator. Names alone never link records.
- **Services:** AxisCare service codes are explicitly mapped to a Waldah service type. The original AxisCare code remains visible as provenance.
- Mappings are tenant-scoped, unique, audited, and never overwrite canonical Waldah profile data.

## Webhooks

AxisCare documents `x-webhook-id` as a unique subscriber identifier, but the public specification does not document a signature, shared secret, mTLS, or another verifiable request-authentication mechanism. Therefore `/api/webhooks/axiscare` is intentionally fail-closed with HTTP 503. Parsing, deduplication, replay-state, retry, and refetch code is preserved but cannot be activated until AxisCare supplies a verified authentication contract. Production webhook registration is not part of this phase.

## Billing workspace

- Connection and synchronization status are accurate and tenant-specific.
- Linked-client visits show clock times, service-code provenance, explicit service mappings, rates returned by AxisCare, calculated hours, and Waldah's EVV classification.
- Non-EVV-compliant visits can be selected locally for review and remain visibly flagged.
- Approved service hours come from Waldah client-service records.
- A billing ledger does not exist, so billed totals remain `Not connected`.
- Billing actions remain disabled. No selection is persisted and no financial transaction occurs.

## External activation dependencies

Implementation and mocked/integration verification do not require live credentials. Live connection verification still requires:

1. an AxisCare bearer token authorized for the applicable account and required GET endpoints;
2. the account-specific AxisCare site URL;
3. `AXISCARE_CREDENTIAL_ENCRYPTION_KEY` supplied securely to the application;
4. an explicit later decision to deploy migrations and activate production synchronization;
5. AxisCare documentation/support for cryptographically verifiable webhook authentication before webhook intake can be enabled.
