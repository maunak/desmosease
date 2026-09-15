/**
 * Lets Node run the app's TypeScript directly. Vite resolves extensionless
 * relative imports like "./math"; plain Node does not, so fill that in.
 */
import { existsSync } from 'node:fs'

const CANDIDATES = ['.ts', '.tsx', '/index.ts']

export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of CANDIDATES) {
      const candidate = new URL(base.href + ext)
      if (existsSync(candidate)) return next(base.href + ext, context)
    }
  }
  return next(specifier, context)
}
