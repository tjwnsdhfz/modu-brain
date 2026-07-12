import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "og.png");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  await page.setContent(`<!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <style>
          @font-face {
            font-family: "KoPub World Dotum";
            src: local("KoPubWorldDotum_Pro Medium"), local("KoPubWorld Dotum_Pro Medium");
            font-weight: 500;
          }
          @font-face {
            font-family: "KoPub World Dotum";
            src: local("KoPubWorldDotum_Pro Bold"), local("KoPubWorld Dotum_Pro Bold");
            font-weight: 700;
          }
          * { box-sizing: border-box; }
          html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
          body {
            display: grid;
            place-items: center;
            padding: 42px;
            background: #f6f5f4;
            color: #000;
            font-family: "KoPub World Dotum", "Malgun Gothic", sans-serif;
          }
          main {
            position: relative;
            display: grid;
            width: 1116px;
            height: 546px;
            grid-template-columns: 1.16fr .84fr;
            overflow: hidden;
            border: 1px solid #e6e6e6;
            border-radius: 24px;
            background: #fff;
            box-shadow: 0 18px 60px rgba(33, 49, 131, .10);
          }
          .copy { display: flex; flex-direction: column; justify-content: center; padding: 66px 56px; }
          .brand { display: flex; align-items: center; gap: 13px; margin: 0 0 34px; font-size: 18px; font-weight: 700; }
          .mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 7px; background: #000; color: #fff; font-size: 18px; }
          h1 { max-width: 610px; margin: 0; font-size: 54px; line-height: 1.12; letter-spacing: -.045em; }
          .lead { max-width: 580px; margin: 28px 0 0; color: #615d59; font-size: 21px; line-height: 1.52; }
          .visual { position: relative; display: grid; place-items: center; overflow: hidden; background: #213183; }
          .card { z-index: 2; width: 350px; border: 1px solid rgba(255,255,255,.65); border-radius: 16px; padding: 28px; background: #fff; box-shadow: 0 24px 52px rgba(0,0,0,.18); transform: rotate(-2deg); }
          .eyebrow { margin: 0 0 16px; color: #005bab; font-size: 14px; font-weight: 700; }
          .line { display: grid; grid-template-columns: 32px 1fr; gap: 13px; padding: 14px 0; border-top: 1px solid #e6e6e6; }
          .line:first-of-type { border-top: 0; }
          .line span { color: #a39e98; font-size: 13px; font-weight: 700; }
          .line strong { display: block; margin-bottom: 4px; font-size: 16px; }
          .line p { margin: 0; color: #615d59; font-size: 13px; line-height: 1.45; }
          .sticker { position: absolute; z-index: 1; display: block; box-shadow: 0 12px 30px rgba(0,0,0,.15); }
          .sky { top: 42px; right: 42px; width: 46px; height: 46px; border-radius: 10px; background: #62aef0; transform: rotate(12deg); }
          .pink { left: 36px; bottom: 78px; width: 22px; height: 72px; border-radius: 999px; background: #ff64c8; transform: rotate(-14deg); }
          .purple { right: 34px; bottom: 38px; width: 96px; height: 28px; border-radius: 7px; background: #d6b6f6; transform: rotate(8deg); }
          .orange { left: 42px; top: 60px; width: 28px; height: 28px; border-radius: 50%; background: #dd5b00; }
        </style>
      </head>
      <body>
        <main>
          <section class="copy">
            <p class="brand"><span class="mark">M</span>MODU BRAIN</p>
            <h1>결론보다 오래 남아야 할 이유를 연결합니다.</h1>
            <p class="lead">카카오톡 · Teams · Notion 기록을 계정 연결 없이 근거가 남는 팀 맥락으로.</p>
          </section>
          <section class="visual" aria-hidden="true">
            <span class="sticker sky"></span><span class="sticker pink"></span>
            <span class="sticker purple"></span><span class="sticker orange"></span>
            <article class="card">
              <p class="eyebrow">CONNECTED CONTEXT</p>
              <div class="line"><span>01</span><div><strong>관점 차이</strong><p>사람마다 다른 판단 기준을 연결합니다.</p></div></div>
              <div class="line"><span>02</span><div><strong>미결 질문</strong><p>다음 대화가 시작될 지점을 남깁니다.</p></div></div>
              <div class="line"><span>03</span><div><strong>결정 근거</strong><p>원문으로 돌아가는 이유를 보존합니다.</p></div></div>
            </article>
          </section>
        </main>
      </body>
    </html>`);

  await page.screenshot({ path: output, type: "png" });
} finally {
  await browser.close();
}
