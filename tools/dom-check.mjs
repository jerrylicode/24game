/* =========================================================
   dom-check.mjs —— 用本机 Chrome 无头模式跑一遍页面，把渲染后的 DOM 抓回来
   用途：在没有浏览器自动化依赖的情况下做“真机”集成自检
        （JS 是否报错、卡牌/弹窗是否渲染、动画跑完后状态是否正确）
   CLI：  node tools/dom-check.mjs "index.html?deal=3,3,8,8&demo=popup" out.html [虚拟时间ms]
   模块： import { dumpDom } from './dom-check.mjs'
   ========================================================= */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(here, '..');

export const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * 跑一遍页面并返回渲染后的 HTML。
 * 说明：无头 Chrome 在虚拟时间下不会自行退出，因此到点就杀掉进程、取回已抓到的 DOM。
 */
export function dumpDom(target, opts = {}) {
  const {
    budget = 12000, timeout = 12000, profile = 'profile',
    windowSize = '1280,880', mobile = false, deviceScale = 1, userAgent,
  } = opts;
  const url = target.startsWith('file:') ? target : 'file://' + path.join(root, target);
  return new Promise((resolve) => {
    const args = [
      '--headless',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--no-first-run',
      '--hide-scrollbars',
      '--window-size=' + windowSize,
      '--user-data-dir=' + path.join(root, '.shots', profile),
      '--virtual-time-budget=' + budget,
    ];
    // 模拟手机：触摸事件 + 移动端 UA + DPR，才能验证 H5 分支
    if (mobile) {
      args.push(
        '--touch-events=enabled',
        '--force-device-scale-factor=' + deviceScale,
        '--user-agent=' + (userAgent
          || 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 '
            + '(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'),
      );
    }
    args.push('--dump-dom', url);
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = '';
    child.stdout.on('data', (d) => { buf += d; });
    const finish = () => {
      clearTimeout(hardStop);
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      resolve(buf);
    };
    const hardStop = setTimeout(finish, timeout);
    child.on('close', finish);
  });
}

export function writeDom(target, outPath, budget) {
  const out = path.isAbsolute(outPath) ? outPath : path.join(root, outPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return dumpDom(target, { budget }).then((html) => {
    fs.writeFileSync(out, html);
    return { out, size: html.length };
  });
}

/** 从抓回的 DOM 里读 ?debug=1 面板，拿到页面内真实状态 */
export function debugState(html) {
  const m = html.match(/<pre id="debugPanel"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return null;
  const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// CLI 入口
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , target = 'index.html', out = '.shots/dom.html', budget = '9000'] = process.argv;
  const { out: p, size } = await writeDom(target, out, Number(budget));
  console.log(`[dom-check] 输出 ${size} 字节 -> ${path.relative(root, p)}`);
}
