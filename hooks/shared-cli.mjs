export function sharedCliUrl(importerUrl = import.meta.url) {
  return new URL('../packages/cli/src/main.mjs', importerUrl).href
}

export const SHARED_CLI = "Promise.all([import('node:fs'),import('node:url')]).then(([fs,url])=>{fs.accessSync(url.fileURLToPath(process.argv[1]));return import(process.argv[1])}).then(m=>m.main(process.argv.slice(2)))"
