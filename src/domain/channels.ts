// Channel-related utilities

export function getChannelMetric(
  channels: Array<{ channel: string; sessions: number }>,
  channelName: string
): number {
  return channels.find((row) => row.channel === channelName)?.sessions ?? 0;
}
