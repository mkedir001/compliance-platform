# RDS credential rotation controller

This Node.js 22 Lambda handles only the production RDS-managed secret's successful `AWSCURRENT` promotion event. EventBridge filters the CloudTrail `UpdateSecretVersionStage` event to the exact secret, and the handler validates the event again before forcing a new deployment of only `compliance-platform-prod-service`.

The controller never reads database credentials. A DynamoDB conditional write keyed by the promoted secret version makes duplicate EventBridge delivery harmless. Claims expire after 30 days; a failed ECS request releases its claim so EventBridge retry can recover.

Build and verify the deployable `index.handler` package with:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm package
pnpm test:package
```
