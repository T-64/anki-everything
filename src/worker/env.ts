/** 识别队列里的消息 */
export interface AnalyzeMessage {
  id: string;
}

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ANALYZE: Queue<AnalyzeMessage>;
  ASSETS: Fetcher;
  APP_KEY: string;
  LLM_ENDPOINT: string;
  LLM_MODEL: string;
  /** 可选：没有时只能“不用 AI” */
  LLM_API_KEY?: string;
  /** enabled | disabled：模型先推理再回答 */
  LLM_THINKING: string;
  APP_TIME_ZONE: string;
  DAILY_CAPTURE_LIMIT: string;
}
