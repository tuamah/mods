#!/usr/bin/env node
import { main } from '../src/main.mjs'

main(process.argv.slice(2)).catch(error => {
  const payload = { error: { code: error.code || 'INTERNAL_ERROR', message: error.message, details: error.details } }
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = 1
})
