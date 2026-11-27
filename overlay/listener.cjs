// Which listener the hub (server.cjs) starts for the ear on this system:
// listen.ps1 on Windows, listen-mac.sh (which builds and runs the Swift
// listener, listen-mac.swift) on macOS, none elsewhere. Pure, for the checks.
'use strict'

const path = require('path')

function listenerCommand(platform, dir) {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(dir, 'listen.ps1')],
    }
  }
  if (platform === 'darwin') return { command: '/bin/sh', args: [path.join(dir, 'listen-mac.sh')] }
  return null
}

module.exports = { listenerCommand }
