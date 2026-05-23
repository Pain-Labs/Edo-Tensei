const fs = require('fs')
const path = require('path')

const root = process.cwd()
const outDir = path.join(root, 'test-results')
fs.mkdirSync(outDir, { recursive: true })

const settings = {
  'window.zoomLevel': 4,
  'workbench.startupEditor': 'none',
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'workbench.tips.enabled': false,
  'edoTensei.customScanPaths': {
    claude: [path.join(root, 'src', 'test', 'ui', 'fixtures', 'claude-projects')],
  },
}

fs.writeFileSync(path.join(outDir, 'demo-code-settings.generated.json'), JSON.stringify(settings, null, 2))
