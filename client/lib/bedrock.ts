import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

type CachedCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAtMs: number;
};

let cachedCredentials: CachedCredentials | null = null;

async function assumeBedrockRole() {
  const roleArn = process.env.AWS_BEDROCK_ROLE_ARN;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!roleArn) {
    throw new Error("AWS_BEDROCK_ROLE_ARN environment variable is required.");
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables are required."
    );
  }

  if (cachedCredentials && Date.now() < cachedCredentials.expiresAtMs - 60_000) {
    return cachedCredentials;
  }

  const sts = new STSClient({
    region: AWS_REGION,
    credentials: { accessKeyId, secretAccessKey },
  });

  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: "indexai-vercel",
    })
  );

  const credentials = assumed.Credentials;
  if (
    !credentials?.AccessKeyId ||
    !credentials.SecretAccessKey ||
    !credentials.SessionToken ||
    !credentials.Expiration
  ) {
    throw new Error("Failed to assume Bedrock runtime role.");
  }

  cachedCredentials = {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
    expiresAtMs: credentials.Expiration.getTime(),
  };

  return cachedCredentials;
}

export const bedrock = createAmazonBedrock({
  region: AWS_REGION,
  credentialProvider: async () => {
    const credentials = await assumeBedrockRole();
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };
  },
});

export function getBedrockModelId() {
  const modelId =
    process.env.BEDROCK_MODEL_ID ?? process.env.BEDROCK_INFERENCE_PROFILE_ARN;
  if (!modelId) {
    throw new Error(
      "BEDROCK_MODEL_ID (inference profile ARN) environment variable is required."
    );
  }
  return modelId;
}
