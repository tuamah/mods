export class ModsError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'ModsError'
    this.code = code
    this.details = details
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new ModsError(code, message, details)
}
