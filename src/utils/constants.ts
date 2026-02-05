export const CONSTANTS = {
  // Media limits
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  IMAGE_TIMEOUT_MS: 15_000,
  MAX_IMAGES_PER_MESSAGE: 3,
  MAX_IMAGE_DIMENSION: 2048,

  // Message handling
  MAX_FORWARD_NODES: 20,
  MAX_LOG_MESSAGE_LENGTH: 10_000,

  // Paths
  LOGS_DIR: "/root/.openclaw/extensions/qq/logs",
  TEMP_FILE_PREFIX: "/tmp/qq_",

  // Outbound
  MESSAGE_CHUNK_DELAY_MS: 500,
} as const;
