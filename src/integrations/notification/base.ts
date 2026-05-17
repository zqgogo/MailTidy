/** 通知通道接口占位（Phase 2）。 */
export interface NotificationChannel {
  send(message: string, options?: Record<string, unknown>): Promise<void>;
}
