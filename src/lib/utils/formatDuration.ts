/**
 * Format duration in milliseconds to human-readable string
 * Examples:
 *   - 45000ms → "45s"
 *   - 125000ms → "2m 5s"
 *   - 3725000ms → "1h 2m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    if (remainingMinutes > 0 && remainingSeconds > 0) {
      return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    } else if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    } else if (remainingSeconds > 0) {
      return `${hours}h ${remainingSeconds}s`;
    }
    return `${hours}h`;
  }

  if (minutes > 0) {
    if (remainingSeconds > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${minutes}m`;
  }

  return `${seconds}s`;
}
