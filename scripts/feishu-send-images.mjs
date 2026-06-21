#!/usr/bin/env node
/**
 * feishu-send-images.mjs — 把本地图片（如诊断图卡 PNG）按顺序发到飞书群
 *
 * 依赖：已配置好的 lark-cli（bot 身份需 im:resource 上传 + im:message 发送）。
 *   配置：printf '%s' '<AppSecret>' | lark-cli config init --app-id <appId> --app-secret-stdin
 *   验证：lark-cli im +chat-list --as bot --json   → ok:true
 *
 * 用法：
 *   node scripts/feishu-send-images.mjs --chat <oc_xxx> [--text "说明"] <img1.png> [img2.png ...]
 *   node scripts/feishu-send-images.mjs --chat oc_07c2... --text "山西续保图卡" a.png b.png c.png
 *
 * 设计要点（踩坑沉淀）：
 *   · lark-cli 发图片前会向 stdout 打印 "uploading image: xxx.png" 进度行，混在 JSON 前面，
 *     直接 JSON.parse 会炸 —— 本脚本从首个 '{' 起切片再解析。
 *   · 图片路径必须是 cwd 相对路径（lark-cli 拒绝绝对路径与 ..）；脚本自动转为相对 cwd。
 *   · 顺序发送（非并发），保证群里卡片顺序稳定；任一张失败即停并报错（避免错位）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';

function parseArgs(argv) {
  const out = { chat: null, text: null, images: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chat') out.chat = argv[++i];
    else if (a === '--text') out.text = argv[++i];
    else out.images.push(a);
  }
  return out;
}

/** 运行 lark-cli，从输出中切出 JSON（跳过 "uploading image:" 等进度前缀行）后解析。 */
function larkJson(args) {
  let raw;
  try {
    raw = execFileSync('lark-cli', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    raw = (e.stdout || '') + (e.stderr || '');
  }
  const i = raw.indexOf('{');
  if (i < 0) throw new Error('lark-cli 无 JSON 输出：' + raw.slice(0, 200));
  return JSON.parse(raw.slice(i));
}

function sendText(chat, text) {
  const d = larkJson(['im', '+messages-send', '--as', 'bot', '--chat-id', chat, '--text', text, '--json']);
  if (!d.ok) throw new Error('文字发送失败：' + ((d.error || {}).message || JSON.stringify(d.error)));
  return d.data.message_id;
}

function sendImage(chat, imgRel) {
  const d = larkJson(['im', '+messages-send', '--as', 'bot', '--chat-id', chat, '--image', imgRel, '--json']);
  if (!d.ok) throw new Error(`图片 ${imgRel} 发送失败：` + ((d.error || {}).message || JSON.stringify(d.error)));
  return d.data.message_id;
}

function main() {
  const { chat, text, images } = parseArgs(process.argv.slice(2));
  if (!chat || !chat.startsWith('oc_')) {
    console.error('❌ 必须 --chat <oc_xxx> 指定群 chat_id');
    process.exit(1);
  }
  if (images.length === 0) {
    console.error('❌ 至少传一张图片路径');
    process.exit(1);
  }
  // 转 cwd 相对路径 + 存在性校验（lark-cli 拒绝绝对路径）
  const rels = images.map((p) => {
    const rel = isAbsolute(p) ? relative(process.cwd(), p) : p;
    if (rel.startsWith('..')) { console.error(`❌ 图片须在当前目录下（cwd 相对）：${p}`); process.exit(1); }
    if (!existsSync(rel)) { console.error(`❌ 图片不存在：${rel}`); process.exit(1); }
    return rel;
  });

  if (text) console.log('✅ 文字 →', sendText(chat, text));
  rels.forEach((rel, idx) => console.log(`✅ 图片 ${idx + 1}/${rels.length} (${rel}) →`, sendImage(chat, rel)));
  console.log(`\n🎉 已发送 ${rels.length} 张图片到群 ${chat}`);
}

main();
