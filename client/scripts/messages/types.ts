export interface MessageFetchWorkerConfig {
  databaseUrl: string;
  bearerToken: string;
  workerIndex: number;
  workerTotal: number;
  shardKey?: string;
  apiKeyAlias?: string;
  requestsPer15Minutes?: number;
  maxPagesPerUser?: number;
  maxUsersPerRun?: number;
  maxTweetsPerUser?: number;
}

export interface MessageWorkerDefinition {
  name: string;
  apiKeyEnv: string;
  workerIndex: number;
  workerTotal: number;
  requestsPer15Minutes?: number;
  maxPagesPerUser?: number;
  maxUsersPerRun?: number;
  maxTweetsPerUser?: number;
}

export interface TweetPageMeta {
  next_token?: string;
  result_count?: number;
  newest_id?: string;
  oldest_id?: string;
}

export interface TweetRecord {
  id: string;
  text: string;
  lang?: string;
  created_at: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
  };
}

export interface TweetsResponse {
  data?: TweetRecord[];
  meta?: TweetPageMeta;
  errors?: Array<{ message?: string }>;
}
