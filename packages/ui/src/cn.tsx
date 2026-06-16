/**
 * Tiny class-merging helper used across the design system.
 * Re-exports `clsx` so consumers don't need a direct dependency.
 */
import { clsx, type ClassValue } from 'clsx'
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
