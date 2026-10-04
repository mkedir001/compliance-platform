import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHandler } from "../src/handler.mjs";

const environment = {
  RDS_SECRET_ARN: "arn:aws:secretsmanager:us-east-2:111122223333:secret:rds!db-production",
  ECS_CLUSTER: "compliance-platform-prod",
  ECS_SERVICE: "compliance-platform-prod-service",
  IDEMPOTENCY_TABLE: "compliance-platform-prod-rds-rotation-events",
};
const event = {
  id: "event-1",
  source: "aws.secretsmanager",
  "detail-type": "AWS API Call via CloudTrail",
  detail: {
    eventSource: "secretsmanager.amazonaws.com",
    eventName: "UpdateSecretVersionStage",
    userIdentity: { invokedBy: "rds.amazonaws.com" },
    requestParameters: { secretId: environment.RDS_SECRET_ARN, versionStage: "AWSCURRENT", moveToVersionId: "11111111-2222-3333-4444-555555555555" },
  },
};

function harness({ duplicate = false, ecsFailure = false } = {}) {
  const ecsCalls = [], dynamoCalls = [], logs = [];
  const dynamo = { send: async command => { dynamoCalls.push(command.input); if (duplicate && "ConditionExpression" in command.input) { const error = new Error("duplicate"); error.name = "ConditionalCheckFailedException"; throw error; } return {}; } };
  const ecs = { send: async command => { ecsCalls.push(command.input); if (ecsFailure) throw new Error("sensitive-provider-detail"); return {}; } };
  const handler = createHandler({ ecs, dynamo, environment, logger: entry => logs.push(entry), now: () => Date.parse("2026-10-04T12:00:00Z") });
  return { handler, ecsCalls, dynamoCalls, logs };
}

describe("RDS rotation controller", () => {
  it("requests only the intended ECS service deployment for a successful authoritative-secret promotion", async () => {
    const { handler, ecsCalls, dynamoCalls } = harness();
    assert.deepEqual(await handler(event, { awsRequestId: "request-1" }), { deploymentRequested: true });
    assert.deepEqual(ecsCalls, [{ cluster: environment.ECS_CLUSTER, service: environment.ECS_SERVICE, forceNewDeployment: true }]);
    assert.equal(dynamoCalls.length, 1);
    assert.equal(dynamoCalls[0].TableName, environment.IDEMPOTENCY_TABLE);
    assert.match(dynamoCalls[0].Item.id.S, /^[a-f0-9]{64}$/);
  });

  it("ignores wrong secrets, stages, principals, event types, and failed API events", async () => {
    const variants = [
      { ...event, detail: { ...event.detail, requestParameters: { ...event.detail.requestParameters, secretId: "arn:aws:secretsmanager:us-east-2:111122223333:secret:other" } } },
      { ...event, detail: { ...event.detail, requestParameters: { ...event.detail.requestParameters, versionStage: "AWSPREVIOUS" } } },
      { ...event, detail: { ...event.detail, userIdentity: { invokedBy: "lambda.amazonaws.com" } } },
      { ...event, detail: { ...event.detail, eventName: "PutSecretValue" } },
      { ...event, detail: { ...event.detail, errorCode: "AccessDenied" } },
    ];
    for (const input of variants) {
      const { handler, ecsCalls, dynamoCalls } = harness();
      assert.deepEqual(await handler(input), { deploymentRequested: false, reason: "event-not-applicable" });
      assert.equal(ecsCalls.length, 0);
      assert.equal(dynamoCalls.length, 0);
    }
  });

  it("suppresses duplicate deliveries without requesting another deployment", async () => {
    const { handler, ecsCalls } = harness({ duplicate: true });
    assert.deepEqual(await handler(event), { deploymentRequested: false, reason: "duplicate-event" });
    assert.equal(ecsCalls.length, 0);
  });

  it("releases the idempotency claim after an ECS failure so EventBridge can retry", async () => {
    const { handler, dynamoCalls, logs } = harness({ ecsFailure: true });
    await assert.rejects(handler(event), /ECS_DEPLOYMENT_REQUEST_FAILED/);
    assert.equal(dynamoCalls.length, 2);
    assert.deepEqual(dynamoCalls[1], { TableName: environment.IDEMPOTENCY_TABLE, Key: { id: dynamoCalls[0].Item.id } });
    assert.doesNotMatch(JSON.stringify(logs), /sensitive-provider-detail|rds!db-production|11111111-2222/);
  });
});
