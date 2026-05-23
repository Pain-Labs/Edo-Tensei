import { ActivityBar, SideBarView, VSBrowser } from 'vscode-extension-tester'
import { By } from 'selenium-webdriver'
import { expect } from 'chai'

const KNOWN_IDES = ['Claude', 'Copilot', 'Cursor', 'Antigravity', 'Kiro', 'Codex']

describe('Edo Tensei sidebar', function () {
  this.timeout(60_000)

  before(async function () {
    await VSBrowser.instance.waitForWorkbench()
    const control = await new ActivityBar().getViewControl('Edo Tensei')
    await control?.openView()
    // Wait until at least one IDE row is visible in the tree
    const driver = VSBrowser.instance.driver
    await driver.wait(async () => {
      const rows = await driver.findElements(By.css('.monaco-list-row'))
      return rows.length > 0
    }, 30_000, 'Edo Tensei tree rows did not appear within 30s')
  })

  it('shows the Edo Tensei button in the activity bar', async function () {
    const control = await new ActivityBar().getViewControl('Edo Tensei')
    expect(control).to.not.be.undefined
  })

  it('opens a sidebar section named "Edo Tensei"', async function () {
    const sections = await new SideBarView().getContent().getSections()
    const names = await Promise.all(sections.map(s => s.getTitle()))
    expect(names.some(n => n.toLowerCase().includes('edo tensei'))).to.be.true
  })

  it('shows at least one IDE parent item before any scan', async function () {
    const driver = VSBrowser.instance.driver
    const rows = await driver.findElements(By.css('.monaco-list-row'))
    expect(rows.length).to.be.greaterThan(0)
  })

  it('lists all expected IDEs as tree items', async function () {
    const driver = VSBrowser.instance.driver

    const labels = await driver.wait(async () => {
      const rows = await driver.findElements(By.css('.monaco-list-row'))
      const texts: string[] = []
      for (const row of rows) {
        try {
          texts.push((await row.getText()).trim())
        } catch {
          // Row may be stale during re-render
        }
      }
      return texts.length > 0 ? texts : false
    }, 10_000, 'Tree rows did not render')

    for (const ide of KNOWN_IDES) {
      expect((labels as string[]).some(l => l.includes(ide)), `Expected IDE "${ide}" to appear in the sidebar`).to.be.true
    }
  })
})
