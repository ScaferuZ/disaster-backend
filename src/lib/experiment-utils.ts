/**
 * Helper functions for WhatsApp message experiments
 */

/** Normalize experiment identifiers crossing external workflow boundaries. */
export function normalizeExperimentId(value: unknown): string | null {
  if (typeof value !== "string") return null

  const normalized = value.trim().replace(/^=+/, "").trim()
  if (!normalized || !/^[A-Z0-9_-]+$/i.test(normalized)) return null
  return normalized
}

/**
 * Format a WhatsApp message with experiment identifier
 * @param text - The message text
 * @param experimentId - The experiment identifier
 * @returns Formatted message with experiment tag
 */
export function formatWhatsAppMessage(text: string, experimentId: string): string {
  return `!lapor ${text} [${experimentId}]`
}

/**
 * Generate a zero-padded experiment ID
 * @param index - The experiment index (starting from 1)
 * @returns Formatted experiment ID (e.g., EXP-001)
 */
export function generateExperimentId(index: number): string {
  return `EXP-${index.toString().padStart(3, '0')}`
}

/**
 * Parse experiment ID from a WhatsApp message using regex
 * @param text - The message text
 * @returns Experiment ID if found, null otherwise
 */
export function parseExperimentIdFromMessage(text: string): string | null {
  const match = text.match(/\[([A-Z0-9-]+)\]/)
  return match?.[1] ?? null
}

/**
 * TypeScript interface for experiment trial data
 */
export interface ExperimentTrial {
  experimentId: string
  index: number
  pwaTriggeredAt: number
  messageText: string
}
