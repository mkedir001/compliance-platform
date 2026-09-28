# AWS private service gateway

This package implements the existing `RATE_LIMIT_URL` and `EVIDENCE_STORAGE_URL`
HTTPS contracts as one Node.js 22 Lambda function behind an API Gateway private
REST API. The Lambda does not need VPC attachment. The application reaches the
private API through an `execute-api` interface VPC endpoint, so the ECS private
subnets do not need NAT access.

Build and test:

```sh
pnpm --dir gateway install --frozen-lockfile
pnpm --dir gateway test
pnpm --dir gateway run package
pnpm --dir gateway run test:package
```

Deploy `gateway/dist/gateway.zip` with handler exactly `index.handler`, Node.js
22, and x86_64 architecture. The ZIP contains a CommonJS `index.js` at its root;
AWS SDK v3 dependencies are bundled while Node built-ins remain runtime-native.
Create proxy integrations for `POST /rate-limit` and `POST /evidence`. If the
private REST API ID is `api-id`, its associated endpoint ID is `vpce-id`, and
the stage is `prod`, configure the application with:

```text
RATE_LIMIT_URL=https://api-id-vpce-id.execute-api.us-east-2.amazonaws.com/prod/rate-limit
EVIDENCE_STORAGE_URL=https://api-id-vpce-id.execute-api.us-east-2.amazonaws.com/prod/evidence
```

## Required resources and configuration

- One DynamoDB on-demand table with string partition key `id` and TTL attribute
  `expiresAt`.
- One private, encrypted, versioned S3 bucket with public access blocked. Store
  evidence at `organizations/{organizationId}/evidence/{objectId}` with object
  metadata `organization-id={organizationId}`. Add a non-empty sentinel object.
- One private REST API, a resource policy restricted to the ECS VPC endpoint,
  and an `execute-api` interface endpoint whose security group accepts HTTPS
  from the ECS task security group. Associate the endpoint with the API.
- Lambda environment: `RATE_LIMIT_TABLE_NAME`, `EVIDENCE_BUCKET_NAME`,
  `EVIDENCE_HEALTH_KEY`, and the secret values `RATE_LIMIT_TOKEN` and
  `EVIDENCE_STORAGE_TOKEN` (each at least 20 characters). Optional settings are
  `EVIDENCE_MAX_BYTES` and comma-separated `EVIDENCE_ALLOWED_CONTENT_TYPES`.
  Inject secrets from Secrets Manager or SSM; do not commit them.

The Lambda execution role needs CloudWatch Logs permissions,
`dynamodb:UpdateItem` on the rate-limit table, and `s3:GetObject` on the exact
sentinel and `organizations/*/evidence/*` object ARNs. API Gateway also needs
permission to invoke the function. The ECS task role needs no DynamoDB or S3
access for these contracts; network access and the two bearer-token secrets are
sufficient.
