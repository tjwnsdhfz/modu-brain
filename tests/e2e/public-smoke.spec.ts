import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("public landing keeps the sample explicit and deterministic", async ({
  page,
  request,
}) => {
  await page.goto("/");

  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://modu-brain-demo.onrender.com/og.png",
  );
  const socialPreview = await request.get("/og.png");
  expect(socialPreview.status()).toBe(200);
  expect(socialPreview.headers()["content-type"]).toContain("image/png");

  await expect(
    page.getByRole("heading", { name: "길어진 대화에서, 결정과 남은 질문을 찾으세요." }),
  ).toBeVisible();
  await expect(page.getByText("분석 대기", { exact: true })).toBeVisible();
  await expect(page.getByText("샘플 데이터", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "샘플 직접 체험" }).click();

  await expect(page.getByText("샘플 데이터", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/기록 제목/)).toHaveValue(
    "캠퍼스 공모전 서비스 기획",
  );
  await expect(
    page.getByRole("heading", { name: "참여자별 관점 차이" }),
  ).toBeVisible();
});

test("exported context can be normalized and analyzed without an account", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "가져오기 샘플 채우기" }).click();
  await page.getByRole("button", { name: "가져와 바로 분석" }).click();

  await expect(page.getByText(/맥락을 정리해 분석했습니다/)).toBeVisible();
  await expect(page.getByText("local-heuristic 분석 결과", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "붙여넣은 후속 회의" })).toBeVisible();
});

test("public demo is one click away and requires no account", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "샘플 직접 체험" }).click();

  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.getByRole("heading", { name: "로그인 없이 확인하는 근거 기반 맥락 분석" }),
  ).toBeVisible();
  await expect(page.getByText("샘플 데이터", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/기록 제목/)).toHaveValue(
    "캠퍼스 공모전 서비스 기획",
  );
});

test("SPA routes and process health are available without a database", async ({
  page,
  request,
}) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  const livePayload = await live.json();
  expect(livePayload).toMatchObject({ data: { status: "ok" } });
  if (process.env.E2E_EXPECTED_COMMIT) {
    expect(livePayload.data.commit).toBe(process.env.E2E_EXPECTED_COMMIT.toLowerCase());
  }

  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "이메일로 안전하게 시작하세요" }),
  ).toBeVisible();
  await expect(page.getByTestId("login-email")).toBeVisible();
});

test("login can be skipped when the user only needs the public demo", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 공개 데모 계속" }).click();

  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.getByRole("heading", { name: "로그인 없이 확인하는 근거 기반 맥락 분석" }),
  ).toBeVisible();
});


test("review document and full backup can be edited, exported and reopened", async ({page})=>{
 await page.goto("/");
 await page.getByRole("button",{name:"가져오기 샘플 채우기"}).click();
 await page.getByRole("button",{name:"가져와 바로 분석"}).click();
 await expect(page.getByText("local-heuristic 분석 결과",{exact:true})).toBeVisible();
 const report=page.getByLabel("검토 문서 · Markdown");
 await report.fill("# 검토 완료\n\n담당자가 원문을 확인한 후 남긴 메모입니다.");
 const download=page.waitForEvent("download");await page.getByRole("button",{name:"입력과 결과 백업",exact:true}).click();
 const path=await (await download).path();expect(path).toBeTruthy();
 const archive=JSON.parse(await readFile(path!,"utf8"));expect(archive.report).toContain("담당자가 원문");expect(archive.sample).toBe(false);
 await page.reload();await page.getByLabel("검토 백업 열기").setInputFiles(path!);
 await expect(report).toHaveValue(archive.report);
 await expect(page.getByText("백업에서 연 결과 · 출처 미검증",{exact:true})).toBeVisible();
 await page.getByLabel("검토 백업 열기").setInputFiles({name:"invalid.json",mimeType:"application/json",buffer:Buffer.from("{}")});
 await expect(page.getByRole("alert")).toContainText("기존 입력과 결과는 유지됩니다");await expect(report).toHaveValue(archive.report);
 const md=page.waitForEvent("download");await page.getByRole("button",{name:"검토 문서 다운로드",exact:true}).click();
 expect(await readFile((await (await md).path())!,"utf8")).toBe(archive.report);
 for(const width of [375,768,1024,1440]) {await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
});
