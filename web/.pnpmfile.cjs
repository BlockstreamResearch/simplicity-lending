const fs = require('node:fs')
const path = require('node:path')

const LWK_PKG = path.join(__dirname, '../lwk/lwk_wasm/pkg/package.json')

module.exports = {
  hooks: {
    preResolution() {
      if (fs.existsSync(LWK_PKG)) return
      console.error(
        [
          '',
          'ERROR: LWK is not built yet.',
          '',
          'Fix (run from the repo root):',
          '  git submodule update --init lwk',
          '  cd web && pnpm lwk:build',
          '',
        ].join('\n'),
      )
      process.exit(1)
    },
  },
}
