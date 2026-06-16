import { expect, test } from '@playwright/test'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })

async function mockStudentApi(page: import('@playwright/test').Page) {
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
  await page.route('**/api/v1/student/interviews/knowledge/status', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({ document_count: 1, chunk_count: 4, retriever: 'mock', vector_ready: true })) })
  })
  await page.route('**/api/v1/student/master/models', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok([{ id: 1, display_name: 'Mock Interviewer', provider: 'mock', model_identifier: 'mock-v1' }])) })
  })
  await page.route('**/api/v1/student/resumes', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok([
      { id: 9, title: '梁伟业简历_java开发.pdf', updated_at: '2026-06-15T00:00:00Z' },
      { id: 10, title: 'Agent开发实习生简历', updated_at: '2026-06-14T00:00:00Z' },
    ])) })
  })
  await page.route('**/api/v1/student/interviews', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok([])) })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({
      session: { id: 1, target_role: '后端工程师', interview_type: 'first_round', interview_style: 'strict', difficulty: 'normal', round_limit: 8, status: 'active' },
      first_turn: { id: 11, turn_index: 1, question: '请介绍你最熟悉的一个后端项目。', answer: null },
      knowledge_status: { document_count: 1, chunk_count: 4, retriever: 'mock', vector_ready: true },
    })) })
  })
  await page.route('**/api/v1/student/interviews/runs/start', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({ run_id: 'run-1', request_id: 'req-1' })) })
  })
  await page.route('**/api/v1/student/interviews/runs/run-1/events?**', async (route) => {
    const body = [
      'event: interview.stage.started',
      'data: {"seq":1,"stage":"resume","title":"读取在线简历"}',
      '',
      'event: done',
      'data: {"seq":2}',
      '',
      '',
    ].join('\n')
    await route.fulfill({ contentType: 'text/event-stream', body })
  })
}

test('AI interviewer shows a progress bar while preparing interview', async ({ page }) => {
  await mockStudentApi(page)
  await page.goto('/student/interviewer')

  await expect(page.locator('.interview-page')).toBeVisible()
  await page.getByPlaceholder(/Java/).fill('后端工程师')
  await page.getByPlaceholder(/JD/).fill('负责 Java、Redis、MySQL、系统设计和线上稳定性。')
  await page.locator('.interview-config-panel button.arco-btn-primary').last().click()

  await expect(page.locator('.interview-progress-bar')).toBeVisible()
  await expect(page.locator('.interview-progress-bar-fill')).toHaveAttribute('style', /width:/)
})

test('audio mime picker falls back to a supported recording type', async ({ page }) => {
  await page.goto('/student/interviewer')
  const selected = await page.evaluate(async () => {
    const original = window.MediaRecorder
    class MockMediaRecorder {
      static isTypeSupported(type: string) {
        return type === 'audio/mp4'
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: MockMediaRecorder, configurable: true })
    const mod = await import('/src/student/interview/voice.ts')
    const result = mod.pickSupportedAudioMimeType()
    Object.defineProperty(window, 'MediaRecorder', { value: original, configurable: true })
    return result
  })

  expect(selected).toBe('audio/mp4')
})

test('answer submission shows staged progress bar while follow-up is running', async ({ page }) => {
  await mockStudentApi(page)
  await page.route('**/api/v1/student/interviews/runs/start', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 1, msg: 'stream disabled', data: null }) })
  })
  await page.route('**/api/v1/student/interviews/1/turns/runs/submit', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({ run_id: 'answer-run-1' })) })
  })
  await page.route('**/api/v1/student/interviews/runs/answer-run-1/events?**', async (route) => {
    const body = [
      'event: runtime.status',
      'data: {"seq":1,"phase":"retrieval","label":"正在检索题库和岗位知识"}',
      '',
      'event: done',
      'data: {"seq":2}',
      '',
      '',
    ].join('\n')
    await route.fulfill({ contentType: 'text/event-stream', body })
  })

  await page.goto('/student/interviewer')
  await page.getByPlaceholder(/Java/).fill('后端工程师')
  await page.getByPlaceholder(/JD/).fill('负责 Java、Redis、MySQL、系统设计和线上稳定性。')
  await page.locator('.interview-config-panel button.arco-btn-primary').last().click()
  await expect(page.locator('.interview-answer-box')).toBeVisible()

  await page.locator('.interview-answer-box textarea').fill('我负责后端接口和 Redis 缓存优化。')
  await page.locator('.interview-answer-box button.arco-btn-primary').click()

  await expect(page.locator('.interview-answer-progress')).toBeVisible()
  await expect(page.locator('.interview-answer-progress-step--active')).toContainText(/读取回答|检索题库/)
})

test('resume source picker loads online resumes and closes after selection', async ({ page }) => {
  await mockStudentApi(page)
  await page.goto('/student/interviewer')

  await page.locator('.interview-resume-select').click()
  await expect(page.locator('.interview-resume-menu')).toBeVisible()
  await expect(page.getByText('梁伟业简历_java开发.pdf')).toBeVisible()
  await expect(page.getByText('Agent开发实习生简历')).toBeVisible()

  await page.getByText('Agent开发实习生简历').click()
  await expect(page.locator('.interview-resume-menu')).toHaveCount(0)
  await expect(page.locator('.interview-resume-select')).toContainText('Agent开发实习生简历')
})
