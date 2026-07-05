#!/usr/bin/env node

/**
 * 律师助手安装脚本
 * 跨平台（macOS / Windows / Linux），纯 Node.js，无 bash 依赖
 *
 * 用法: node setup.mjs
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;
const SERVER_DIR = join(PROJECT_DIR, 'mcp', 'knowledge-server');
const CONFIG_FILE = join(PROJECT_DIR, '.codex', 'config.toml');
const GLOBAL_CONFIG = join(homedir(), '.codex', 'config.toml');
const IS_MAC = platform() === 'darwin';
const IS_WIN = platform() === 'win32';

function log(msg) { console.log(msg); }
function run(cmd, opts = {}) {
  const defaultOpts = { stdio: 'pipe', timeout: 120000, ...opts };
  if (!defaultOpts.cwd && cmd.includes('npm') && !cmd.includes('--prefix')) {
    defaultOpts.cwd = SERVER_DIR;
  }
  try {
    const out = execSync(cmd, defaultOpts).toString().trim();
    return out;
  } catch (e) {
    if (!defaultOpts.ignoreError) {
      throw e;
    }
    return '';
  }
}

// ===== 主流程 =====

async function main() {
  log('🔧 正在安装律师助手...');

  // 检查 Node.js 版本
  const nodeVer = process.version.match(/^v(\d+)\./)?.[1];
  if (!nodeVer || parseInt(nodeVer) < 18) {
    log('❌ 请先安装 Node.js (>=18)：https://nodejs.org');
    process.exit(1);
  }

  // ===== 1. 安装依赖并编译 MCP Server =====
  log('📦 安装 MCP Server 依赖...');
  run('npm install --silent', { cwd: SERVER_DIR, ignoreError: true });

  // npm >= 10 安全策略：允许 better-sqlite3 运行安装脚本
  try {
    run('npm approve-scripts better-sqlite3', { cwd: SERVER_DIR });
  } catch { /* 旧版 npm 无此命令 */ }

  // 重新编译 better-sqlite3（解决 macOS 签名 / 架构兼容问题）
  log('🛠️  重新编译 better-sqlite3...');
  try {
    run('npm rebuild better-sqlite3', { cwd: SERVER_DIR });
    
    // macOS 上签名，防止 Team ID 不匹配被拦截
    if (IS_MAC) {
      const nativeModule = join(SERVER_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
      if (existsSync(nativeModule)) {
        try {
          execSync(`codesign --sign - --force "${nativeModule}"`, { timeout: 10000 });
          log('✅ better-sqlite3 签名完成');
        } catch { /* 没有 codesign 工具时跳过 */ }
      }
    }
  } catch (e) {
    log('⚠️  better-sqlite3 编译失败: ' + e.message);
    log('   首次使用时 MCP Server 可能无法启动');
  }

  // 编译 TypeScript
  log('🔨 编译 MCP Server...');
  run('npm run build', { cwd: SERVER_DIR });

  // ===== 2. 注册 MCP Server 到项目配置 =====
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, [
      '[mcp_servers.knowledge-server]',
      'command = "node"',
      'args = ["mcp/knowledge-server/dist/server.js"]',
      'startup_timeout_sec = 120',
      '',
    ].join('\n'), 'utf-8');
    log('✅ MCP Server 已注册到项目配置');
  } else {
    log('⏭️  .codex/config.toml 已存在，跳过覆盖');
  }

  // ===== 3. 清理全局配置旧条目 =====
  if (existsSync(GLOBAL_CONFIG)) {
    let globalContent = readFileSync(GLOBAL_CONFIG, 'utf-8');
    const original = globalContent;
    // 移除旧版安装写入的 knowledge-server 配置行
    globalContent = globalContent.replace(/.*lawyer-knowledge-server.*\n?/g, '');
    globalContent = globalContent.replace(/.*knowledge-server.*dist\/server.*\n?/g, '');
    if (globalContent !== original) {
      writeFileSync(GLOBAL_CONFIG, globalContent, 'utf-8');
      log('✅ 已清理全局配置中的旧条目');
    }
  }

  // ===== 4. 预下载嵌入模型 =====
  log('☁️  预下载嵌入模型（首次约 100MB）...');
  try {
    // 先设置好 NODE_PATH 确保能找到 @xenova/transformers
    const nodeModulesDir = join(SERVER_DIR, 'node_modules');
    const env = { ...process.env, NODE_PATH: nodeModulesDir };
    execSync(
      `node -e "
        import('@xenova/transformers').then(async (mod) => {
          const { pipeline, env } = mod;
          const cacheDir = process.platform === 'win32'
            ? (process.env.USERPROFILE + '/.cache/huggingface')
            : (process.env.HOME + '/.cache/huggingface');
          env.localModelPath = env.localModelPath || cacheDir;
          try {
            await pipeline('feature-extraction', 'Xenova/bge-base-zh-v1.5', { quantized: true });
            console.error('下载完成');
          } catch(e) {
            console.error('下载失败: ' + e.message);
          }
        });
      "`,
      { cwd: SERVER_DIR, env, timeout: 300000, stdio: 'pipe', shell: true }
    );
    log('✅ 嵌入模型下载完成');
  } catch (e) {
    const msg = e.stderr?.toString()?.split('\n')?.slice(-1)[0]?.trim() || e.message;
    log('⚠️  模型缓存失败 (' + msg + ')，首次使用时自动下载');
  }

  // ===== 完成 =====
  log('');
  log('🎉 律师助手安装完成！');
  log('');
  log('下一步：');
  log('1. 关闭当前 Thread');
  log('2. 新建一个 Thread 开始使用');
  log('3. 例如：「民间借贷的利率上限是多少？」');
  log('4. 输入「你能做什么」查看全部功能');
}

main().catch(e => {
  log('❌ 安装失败: ' + e.message);
  process.exit(1);
});
