import { createHash } from "node:crypto";
import { DeleteItemCommand, DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";

const EXPECTED_SOURCE = "aws.secretsmanager";
const EXPECTED_DETAIL_TYPE = "AWS API Call via CloudTrail";
const EXPECTED_EVENT_SOURCE = "secretsmanager.amazonaws.com";
const EXPECTED_EVENT_NAME = "UpdateSecretVersionStage";
const VERSION_ID = /^[A-Za-z0-9-]{1,128}$/;

function log(entry) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), operation: "rds-credential-rotation", ...entry }));
}

function configuration(environment) {
  const required = ["RDS_SECRET_ARN", "ECS_CLUSTER", "ECS_SERVICE", "IDEMPOTENCY_TABLE"];
  if (required.some(key => typeof environment[key] !== "string" || environment[key].length === 0)) throw new Error("CONTROLLER_CONFIGURATION_INVALID");
  return Object.fromEntries(required.map(key => [key, environment[key]]));
}

export function matchesRotationCompletion(event, environment) {
  const detail = event?.detail;
  return event?.source === EXPECTED_SOURCE
    && event?.["detail-type"] === EXPECTED_DETAIL_TYPE
    && detail?.eventSource === EXPECTED_EVENT_SOURCE
    && detail?.eventName === EXPECTED_EVENT_NAME
    && detail?.requestParameters?.secretId === environment.RDS_SECRET_ARN
    && detail?.requestParameters?.versionStage === "AWSCURRENT"
    && VERSION_ID.test(detail?.requestParameters?.moveToVersionId ?? "")
    && detail?.userIdentity?.invokedBy === "rds.amazonaws.com"
    && !detail?.errorCode
    && !detail?.errorMessage;
}

function rotationKey(event) {
  return createHash("sha256").update(`${event.detail.requestParameters.secretId}:${event.detail.requestParameters.moveToVersionId}`).digest("hex");
}

export function createHandler({ ecs = new ECSClient({}), dynamo = new DynamoDBClient({}), environment = process.env, logger = log, now = () => Date.now() } = {}) {
  return async function handler(event, context = {}) {
    let config;
    try {
      config = configuration(environment);
    } catch {
      logger({ level: "error", outcome: "configuration-invalid", requestId: context.awsRequestId ?? "unavailable" });
      throw new Error("CONTROLLER_CONFIGURATION_INVALID");
    }

    if (!matchesRotationCompletion(event, config)) {
      logger({ level: "info", outcome: "ignored", requestId: context.awsRequestId ?? "unavailable" });
      return { deploymentRequested: false, reason: "event-not-applicable" };
    }

    const key = rotationKey(event);
    try {
      await dynamo.send(new PutItemCommand({
        TableName: config.IDEMPOTENCY_TABLE,
        Item: { id: { S: key }, expiresAt: { N: String(Math.floor(now() / 1000) + 2_592_000) } },
        ConditionExpression: "attribute_not_exists(#id)",
        ExpressionAttributeNames: { "#id": "id" },
      }));
    } catch (error) {
      if (error?.name === "ConditionalCheckFailedException") {
        logger({ level: "info", outcome: "duplicate-ignored", requestId: context.awsRequestId ?? "unavailable" });
        return { deploymentRequested: false, reason: "duplicate-event" };
      }
      logger({ level: "error", outcome: "idempotency-unavailable", requestId: context.awsRequestId ?? "unavailable" });
      throw new Error("IDEMPOTENCY_UNAVAILABLE");
    }

    try {
      await ecs.send(new UpdateServiceCommand({ cluster: config.ECS_CLUSTER, service: config.ECS_SERVICE, forceNewDeployment: true }));
      logger({ level: "info", outcome: "deployment-requested", requestId: context.awsRequestId ?? "unavailable", service: config.ECS_SERVICE });
      return { deploymentRequested: true };
    } catch {
      try {
        await dynamo.send(new DeleteItemCommand({ TableName: config.IDEMPOTENCY_TABLE, Key: { id: { S: key } } }));
      } catch {
        logger({ level: "error", outcome: "claim-release-failed", requestId: context.awsRequestId ?? "unavailable" });
      }
      logger({ level: "error", outcome: "deployment-request-failed", requestId: context.awsRequestId ?? "unavailable", service: config.ECS_SERVICE });
      throw new Error("ECS_DEPLOYMENT_REQUEST_FAILED");
    }
  };
}

export const handler = createHandler();
