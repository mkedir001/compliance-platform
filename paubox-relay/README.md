# Paubox transactional-email relay

This Node.js 22 Lambda is the narrow production bridge between the private ECS
application and Paubox Email API. It accepts one validated transactional message,
enforces `signatures@email.waldah.com`, retrieves the raw API credential from
Secrets Manager, and calls `POST https://api.paubox.com/v1/email/messages` with
Bearer authentication. Attachments, bulk recipients, custom provider requests,
and arbitrary senders are rejected.

Build and verify:

```sh
pnpm --dir paubox-relay install --frozen-lockfile
pnpm --dir paubox-relay test
pnpm --dir paubox-relay run package
pnpm --dir paubox-relay run test:package
```

Deploy `paubox-relay/dist/paubox-relay.zip` with handler `index.handler`, runtime
`nodejs22.x`, architecture `x86_64`, and `PAUBOX_SECRET_ID` set to the non-secret
Secrets Manager identifier. Do not place the credential in Lambda or ECS
environment variables. The application invokes the function synchronously with
AWS IAM and receives only accepted/rejected state plus the Paubox
`sourceTrackingId` when accepted.

The contract follows the official Paubox [message API](https://docs.paubox.com/email-api/messages),
[authentication](https://docs.paubox.com/email-api/authentication), and
[error semantics](https://docs.paubox.com/email-api/errors).

Outbound delivery webhooks are intentionally not exposed in this phase. Paubox
documents a configured `x-webhook-signing-key` for outbound events, but production
still needs a dedicated callback signing-key secret and a narrowly unauthenticated
ALB route before a callback can be safely enabled. The provider message ID is
persisted now so later delivery, temporary-failure, and permanent-failure events
can be reconciled without affecting document or signature completion.
