// Checks which listener the hub starts on each system (overlay/listener.cjs).
//   node tests/listener.check.cjs
'use strict'

const assert = require('assert')
const path = require('path')
const { listenerCommand } = require(path.join(__dirname, '..', 'overlay', 'listener.cjs'))

const DIR = path.join(__dirname, '..', 'overlay')
const checks = []
const check = (name, run) => checks.push({ name, run })

check('on Windows the hub starts listen.ps1 with a hidden PowerShell', () => {
  const { command, args } = listenerCommand('win32', DIR)
  assert.equal(command, 'powershell.exe')
  assert.ok(args.includes('-WindowStyle') && args.includes('Hidden'))
  assert.equal(args.at(-1), path.join(DIR, 'listen.ps1'))
})

check('on macOS the hub starts listen-mac.sh, which builds and runs the Swift listener', () => {
  const { command, args } = listenerCommand('darwin', DIR)
  assert.equal(command, '/bin/sh')
  assert.deepEqual(args, [path.join(DIR, 'listen-mac.sh')])
})

check('elsewhere there is no listener', () => {
  assert.equal(listenerCommand('linux', DIR), null)
})

check('both listeners and the launcher ship with the hub', () => {
  for (const file of ['listen.ps1', 'listen-mac.sh', 'listen-mac.swift', 'listen-mac.plist']) {
    assert.ok(require('fs').existsSync(path.join(DIR, file)), file)
  }
})

let failed = 0
for (const { name, run } of checks) {
  try {
    run()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL ${name}\n     ${error.message}`)
  }
}
console.log(failed ? `${failed} of ${checks.length} failed` : `${checks.length} passed`)
process.exitCode = failed ? 1 : 0
