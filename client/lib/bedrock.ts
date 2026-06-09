import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const LOCAL_DEV_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
const LOCAL_DEV_AWS_PROFILE = "dev-admin";

type CachedCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAtMs: number;
};

let cachedCredentials: CachedCredentials | null = null;

function isLocalDevelopment() {
  return process.env.NODE_ENV === "development";
}

function resolveAwsProfile() {
  if (process.env.AWS_PROFILE) {
    return process.env.AWS_PROFILE;
  }

  if (isLocalDevelopment() && !process.env.AWS_ACCESS_KEY_ID) {
    return LOCAL_DEV_AWS_PROFILE;
  }

  return undefined;
}

async function getBaseCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey, sessionToken };
  }

  const profile = resolveAwsProfile();
  if (profile) {
    try {
      const credentials = await fromIni({ profile })();
      if (credentials.accessKeyId && credentials.secretAccessKey) {
        return credentials;
      }
    } catch {
      // Fall through to the default provider chain.
    }
  }

  const credentials = await fromNodeProviderChain()();
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    const profileHint = profile ? ` (AWS_PROFILE=${profile})` : "";
    throw new Error(
      `AWS credentials not found${profileHint}. Run aws sso login --profile ${LOCAL_DEV_AWS_PROFILE}, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.`
    );
  }

  return credentials;
}

function shouldSkipRoleAssume() {
  if (process.env.AWS_BEDROCK_SKIP_ROLE_ASSUME === "true") {
    return true;
  }
  if (process.env.AWS_BEDROCK_SKIP_ROLE_ASSUME === "false") {
    return false;
  }

  // Vercel uses IAM keys + sts:AssumeRole. Local SSO profiles call Bedrock directly.
  return isLocalDevelopment() && !process.env.AWS_ACCESS_KEY_ID;
}

async function assumeBedrockRole() {
  if (shouldSkipRoleAssume()) {
    const baseCredentials = await getBaseCredentials();
    return {
      accessKeyId: baseCredentials.accessKeyId,
      secretAccessKey: baseCredentials.secretAccessKey,
      sessionToken: baseCredentials.sessionToken ?? "",
      expiresAtMs: Date.now() + 3_600_000,
    };
  }

  const roleArn = process.env.AWS_BEDROCK_ROLE_ARN;

  if (!roleArn) {
    throw new Error("AWS_BEDROCK_ROLE_ARN environment variable is required.");
  }

  if (cachedCredentials && Date.now() < cachedCredentials.expiresAtMs - 60_000) {
    return cachedCredentials;
  }

  const baseCredentials = await getBaseCredentials();
  const sts = new STSClient({
    region: AWS_REGION,
    credentials: baseCredentials,
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
  if (shouldSkipRoleAssume()) {
    return process.env.BEDROCK_DEV_MODEL_ID ?? LOCAL_DEV_BEDROCK_MODEL_ID;
  }

  const modelId =
    process.env.BEDROCK_MODEL_ID ?? process.env.BEDROCK_INFERENCE_PROFILE_ARN;
  if (!modelId) {
    throw new Error(
      "BEDROCK_MODEL_ID (inference profile ARN) environment variable is required."
    );
  }
  return modelId;
}
