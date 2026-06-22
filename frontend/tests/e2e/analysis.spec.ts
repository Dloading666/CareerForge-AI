import { expect, test } from '@playwright/test'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })

const MOCK_EMPTY_ANALYSIS = {
  status: 'empty',
  radar: null,
  knowledge: [],
  weaknesses: ['\u6682\u65e0\u9762\u8bd5\u6570\u636e\uff0c\u5b8c\u6210\u9996\u573a\u9762\u8bd5\u540e\u4f1a\u81ea\u52a8\u751f\u6210'],
  summary: { avg_score: 0, pass_count: 0, total_interviews: 0, question_count: 0, skill_count: 0 },
  report_count: 0,
  trigger_type: null,
  created_at: null,
  updated_at: null,
  error_message: null,
}

const MOCK_READY_ANALYSIS = {
  status: 'ready',
  radar: {
    algorithm: 72,
    fundamentals: 78,
    ai_specialty: 65,
    ai_awareness: 70,
    coding: 75,
    communication: 80,
    engineering: 68,
    infrastructure: 60,
  },
  knowledge: [
    { name: 'Redis \u7f13\u5b58', mastery: 85, asked_count: 5, avg_score: 80 },
    { name: '\u5206\u5e03\u5f0f\u9501', mastery: 60, asked_count: 3, avg_score: 60 },
    { name: 'MySQL \u7d22\u5f15', mastery: 70, asked_count: 4, avg_score: 70 },
    { name: 'Kafka \u6d88\u8d39', mastery: 45, asked_count: 2, avg_score: 45 },
  ],
  weaknesses: ['\u57fa\u7840\u67b6\u6784 \u504f\u5f31\uff0860 \u5206\uff09', 'Kafka \u6d88\u8d39 \u638c\u63e1\u4e0d\u8db3'],
  summary: { avg_score: 75.5, pass_count: 2, total_interviews: 4, question_count: 36, skill_count: 18 },
  report_count: 4,
  trigger_type: 'auto',
  created_at: '2026-06-15T10:00:00Z',
  updated_at: '2026-06-16T08:30:00Z',
  error_message: null,
}

async function login(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('zhipei-auth-session', JSON.stringify({
      access: 'test-access',
      refresh: 'test-refresh',
      role: 'student',
      profile: { id: 100, nickname: 'E2E Student' },
    }))
  })
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(ok({ role: 'student', profile: { id: 100, nickname: 'E2E Student' } })),
    })
  })
}

test.describe('\u80fd\u529b\u5206\u6790\u9875\u9762', () => {
  test('\u7a7a\u72b6\u6001\uff1a\u663e\u793a\u7a7a\u62a5\u544a\u6309\u94ae + \u7a7a\u62a5\u8868\u63d0\u793a', async ({ page }) => {
    await login(page)
    await page.route('**/api/v1/student/interviews/analysis/latest', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok(MOCK_EMPTY_ANALYSIS)) })
    })

    await page.goto('/student/analysis')
    await expect(page.getByText('\u80fd\u529b\u5206\u6790').first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('\u8fd8\u6ca1\u6709\u9762\u8bd5\u6570\u636e')).toBeVisible()
    await expect(page.getByRole('button', { name: /\u751f\u6210\u4e00\u4efd\u7a7a\u62a5\u544a/ })).toBeVisible()
  })

  test('\u6709\u6570\u636e\uff1a\u5c55\u793a\u96f7\u8fbe + \u77e5\u8bc6\u5206\u5e03 + \u5f31\u70b9', async ({ page }) => {
    await login(page)
    await page.route('**/api/v1/student/interviews/analysis/latest', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok(MOCK_READY_ANALYSIS)) })
    })

    await page.goto('/student/analysis')
    await expect(page.getByText('\u80fd\u529b\u96f7\u8fbe')).toBeVisible()
    await expect(page.getByText('\u77e5\u8bc6\u70b9\u638c\u63e1\u5206\u5e03')).toBeVisible()
    await expect(page.getByText('\u5f31\u70b9\u63d0\u793a')).toBeVisible()
    await expect(page.getByText('\u8bc4\u4ef7\u5206\u7387')).toBeVisible()
    await expect(page.getByText('\u9762\u8bd5\u901a\u8fc7\u6b21\u6570')).toBeVisible()
    await expect(page.getByText('\u9762\u8bd5\u63d0\u95ee\u6b21\u6570')).toBeVisible()
    await expect(page.getByText('\u638c\u63e1\u6280\u80fd\u6570')).toBeVisible()
    const radarSvg = page.locator('.radar-wrap svg')
    await expect(radarSvg).toBeVisible()
    const knRows = page.locator('.kn-row')
    await expect(knRows).toHaveCount(4)
  })

  test('\u91cd\u65b0\u751f\u6210\u6309\u94ae\u8c03\u7528\u540e\u7aef\u63a5\u53e3', async ({ page }) => {
    await login(page)
    let latestCalls = 0
    let regenerateCalls = 0
    await page.route('**/api/v1/student/interviews/analysis/latest', async (route) => {
      latestCalls++
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok(MOCK_READY_ANALYSIS)) })
    })
    await page.route('**/api/v1/student/interviews/analysis/regenerate', async (route) => {
      regenerateCalls++
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({
        ...MOCK_READY_ANALYSIS,
        trigger_type: 'manual',
        updated_at: new Date().toISOString(),
      })) })
    })

    await page.goto('/student/analysis')
    await expect(page.getByText('\u80fd\u529b\u96f7\u8fbe')).toBeVisible()
    await page.getByRole('button', { name: /\u91cd\u65b0\u751f\u6210/ }).click()
    await expect.poll(() => regenerateCalls).toBeGreaterThanOrEqual(1)
    await expect.poll(() => latestCalls).toBeGreaterThanOrEqual(1)
  })

  test('\u4fa7\u8fb9\u680f\u80fd\u529b\u5206\u6790\u83dc\u5355\u53ef\u70b9\u51fb', async ({ page }) => {
    await login(page)
    await page.route('**/api/v1/student/interviews/analysis/latest', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok(MOCK_READY_ANALYSIS)) })
    })
    await page.goto('/student')
    const navItem = page.getByText('\u80fd\u529b\u5206\u6790')
    await expect(navItem).toBeVisible()
    await navItem.first().click()
    await page.waitForURL(/\/student\/analysis/)
    await expect(page.getByText('\u80fd\u529b\u96f7\u8fbe')).toBeVisible()
  })
})
