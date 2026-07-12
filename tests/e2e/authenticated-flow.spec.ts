import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const testEmail = process.env.E2E_TEST_EMAIL;
const skipLoginEmailSend = process.env.E2E_SKIP_LOGIN_EMAIL_SEND === "true";
const hasAuthEnvironment = Boolean(supabaseUrl && serviceRoleKey && testEmail);

test.skip(
  !hasAuthEnvironment,
  "A dedicated Supabase test environment is required.",
);

test("login, persist two analyses, inspect evidence, share, refresh, and revoke", async ({
  page,
  request,
}) => {
  const appBaseUrl = String(test.info().project.use.baseURL);
  const projectTitle = `E2E 맥락 프로젝트 ${Date.now()}`;

  try {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(testEmail!);
    if (skipLoginEmailSend) {
      await expect(page.getByTestId("login-submit")).toBeEnabled();
    } else {
      await page.getByTestId("login-submit").click();
      await expect(
        page.getByRole("heading", { name: "로그인 링크를 보냈습니다" }),
      ).toBeVisible();
    }

    const generated = await generateMagicLink(request, {
      redirectTo: `${appBaseUrl}/projects`,
      email: testEmail!,
    });

    await page.goto(generated.actionLink);
    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByRole("heading", { name: "내 프로젝트" }),
    ).toBeVisible();
    const authCookies = (await page.context().cookies(appBaseUrl)).filter((cookie) =>
      /modu_brain_(?:access|refresh|expires)$/.test(cookie.name),
    );
    expect(authCookies).toHaveLength(3);
    for (const cookie of authCookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Strict");
      expect(cookie.path).toBe("/");
      expect(cookie.secure).toBe(new URL(appBaseUrl).protocol === "https:");
    }
    const browserStorage = await page.evaluate(() => ({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    }));
    expect(JSON.stringify(browserStorage)).not.toMatch(/access[_-]?token|refresh[_-]?token|eyJ[a-zA-Z0-9_-]+\./i);

    await page.getByTestId("project-create-title").fill(projectTitle);
    await page.getByTestId("project-create-submit").click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i);
    await expect(
      page.getByRole("heading", { name: projectTitle }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "기록", exact: true }).click();
    await importPastedContext(page, {
      title: "첫 기획 회의",
      content:
        "민지는 저장된 기록을 새로고침 뒤에도 확인할 수 있어야 한다고 말했다. 서준은 분석 결과에서 결정 배경과 참여자 관점을 원문 근거와 함께 보여줘야 한다고 제안했다. 팀은 공개 데모에서 로컬 분석을 기본으로 사용하기로 결정했다. 다음 회의에서는 공유 링크의 만료 기간을 어떻게 안내할지 확인해야 한다. 모든 참여자는 실패한 실행이 최근 성공 결과를 덮어쓰면 안 된다는 데 동의했다.",
    });

    await page.getByRole("tab", { name: "개요", exact: true }).click();
    await expect(page.locator('[data-testid^="analysis-source-"]')).toHaveCount(
      1,
    );
    await expect(
      page.locator('[data-testid^="analysis-source-"]').first(),
    ).toBeChecked();
    await page.getByTestId("analysis-mode-local").check();
    await page.getByTestId("analysis-submit").click();
    await expect(
      page.getByRole("heading", { name: "분석 이력", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("비교할 이전 성공 분석이 없습니다."),
    ).toBeVisible();

    const evidenceButton = page
      .getByRole("button", { name: /근거 \d+개/ })
      .first();
    await expect(evidenceButton).toBeVisible();
    await evidenceButton.click();
    await expect(page.getByRole("dialog", { name: "분석 근거" })).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("첫 기획 회의").first(),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기" })
      .click();

    await page.getByRole("tab", { name: "기록", exact: true }).click();
    await createSource(page, {
      kind: "feedback",
      title: "멘토 후속 피드백",
      content:
        "유나는 멘토가 분석 이력의 변화가 한눈에 보이지 않는다고 피드백했다고 말했다. 현우는 최근 성공 결과와 바로 이전 결과만 비교하면 데모가 단순해진다고 제안했다. 팀은 새 질문과 해결된 질문을 변화 목록에 표시하기로 결정했다. 모바일에서 긴 변화 문장을 어떻게 접을지는 아직 검토해야 한다. 공유 화면에는 계정 이메일과 원문 전체를 포함하지 않기로 했다.",
    });

    await page.getByRole("tab", { name: "개요", exact: true }).click();
    const selectedSources = page.locator('[data-testid^="analysis-source-"]');
    await expect(selectedSources).toHaveCount(2);
    for (const checkbox of await selectedSources.all())
      await expect(checkbox).toBeChecked();
    await page.getByTestId("analysis-submit").click();

    await expect(
      page.getByRole("heading", { name: "최근 분석의 변화 서사" }),
    ).toBeVisible();
    await expect(
      page.getByText("비교할 이전 성공 분석이 없습니다."),
    ).toHaveCount(0);

    const projectAccessibility = await new AxeBuilder({ page })
      .include("#main-content")
      .analyze();
    expect(
      projectAccessibility.violations,
      projectAccessibility.violations
        .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
        .join("\n"),
    ).toEqual([]);

    await page.getByRole("tab", { name: "지식맵", exact: true }).click();
    const brainCanvas = page.getByTestId("brain-canvas");
    await expect(brainCanvas).toBeVisible();
    await expect(page.getByRole("img", { name: /프로젝트 맥락 지도/ })).toBeVisible();
    await brainCanvas.getByRole("button", { name: /결정 생각:/ }).first().click();
    await expect(brainCanvas.getByRole("complementary", { name: "선택한 생각 상세" })).toBeVisible();

    const brainAccessibility = await new AxeBuilder({ page })
      .include('[data-testid="brain-canvas"]')
      .analyze();
    expect(
      brainAccessibility.violations,
      brainAccessibility.violations
        .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
        .join("\n"),
    ).toEqual([]);

    await page.getByRole("tab", { name: "온보딩 요약", exact: true }).click();
    await page.getByTestId("share-create").click();
    const shareUrlInput = page.getByLabel("새 공유 링크");
    await expect(shareUrlInput).toBeVisible();
    const shareUrl = await shareUrlInput.inputValue();
    expect(shareUrl).toMatch(/\/share#token=.+/);

    const sharedPage = await page.context().newPage();
    await sharedPage.goto(shareUrl);
    await expect(
      sharedPage.getByRole("heading", { name: projectTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      sharedPage.getByRole("note", { name: "공유 개인정보 주의" }),
    ).toContainText("원문 전체와 계정 이메일은 표시하지 않습니다.");
    await expect(
      sharedPage.getByText(testEmail!, { exact: false }),
    ).toHaveCount(0);
    await sharedPage.reload();
    await expect(
      sharedPage.getByRole("heading", { name: projectTitle, level: 1 }),
    ).toBeVisible();

    const revokeButton = page.locator('[data-testid^="share-revoke-"]').first();
    await revokeButton.click();
    const revokeDialog = page.getByRole("alertdialog", {
      name: "이 공유 링크를 폐기할까요?",
    });
    await expect(revokeDialog).toBeVisible();
    await revokeDialog.getByRole("button", { name: "폐기 확인" }).click();
    await expect(page.getByText("폐기됨", { exact: true })).toBeVisible();
    await sharedPage.reload();
    await expect(
      sharedPage.getByRole("heading", { name: "공유 내용을 열 수 없습니다" }),
    ).toBeVisible();
  } finally {
    await deleteTestUsersByEmail(request, testEmail!);
  }
});

async function createSource(
  page: Page,
  source: {
    kind: "meeting" | "research" | "feedback" | "note";
    title: string;
    content: string;
  },
) {
  await page.getByTestId("source-create-kind").selectOption(source.kind);
  await page.getByTestId("source-create-title").fill(source.title);
  await page.getByTestId("source-create-content").fill(source.content);
  await page.getByTestId("source-create-submit").click();
  await expect(page.getByRole("heading", { name: source.title })).toBeVisible();
}

async function importPastedContext(
  page: Page,
  source: { title: string; content: string },
) {
  await page.getByRole("radio", { name: /바로 붙여넣기/ }).click();
  await page.getByLabel(/기록 제목/).first().fill(source.title);
  await page.getByLabel("회의 맥락 붙여넣기").fill(source.content);
  await page.getByRole("button", { name: "파싱하고 가져오기" }).click();
  await expect(page.getByText("맥락을 가져왔습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: source.title })).toBeVisible();
}

async function generateMagicLink(
  request: APIRequestContext,
  options: { email: string; redirectTo: string },
) {
  const response = await request.post(
    `${supabaseUrl}/auth/v1/admin/generate_link`,
    {
      headers: {
        apikey: serviceRoleKey!,
        Authorization: `Bearer ${serviceRoleKey}`,
        "User-Agent": "modu-brain-e2e/1.0",
      },
      data: {
        type: "magiclink",
        email: options.email,
        redirect_to: options.redirectTo,
      },
    },
  );
  expect(
    response.ok(),
    "Supabase should generate the test Magic Link",
  ).toBeTruthy();

  const body = (await response.json()) as {
    action_link?: string;
    properties?: { action_link?: string; actionLink?: string };
    user?: { id?: string };
  };
  const actionLink =
    body.action_link ??
    body.properties?.action_link ??
    body.properties?.actionLink;
  expect(
    actionLink,
    "Supabase generate_link response should contain an action link",
  ).toBeTruthy();
  return { actionLink: actionLink! };
}

async function deleteTestUsersByEmail(
  request: APIRequestContext,
  email: string,
) {
  const headers = {
    apikey: serviceRoleKey!,
    Authorization: `Bearer ${serviceRoleKey}`,
    "User-Agent": "modu-brain-e2e/1.0",
  };
  const listResponse = await request.get(
    `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`,
    { headers },
  );
  expect(
    listResponse.ok(),
    "Supabase should list disposable E2E users",
  ).toBeTruthy();

  const body = (await listResponse.json()) as
    | Array<{ id?: string; email?: string }>
    | { users?: Array<{ id?: string; email?: string }> };
  const users = Array.isArray(body) ? body : (body.users ?? []);
  const userIds = users
    .filter((user) => user.email === email && user.id)
    .map((user) => user.id!);

  for (const userId of userIds) {
    const response = await request.delete(
      `${supabaseUrl}/auth/v1/admin/users/${userId}`,
      { headers },
    );
    expect(
      response.ok(),
      "Supabase should delete the disposable E2E user",
    ).toBeTruthy();
  }
}
