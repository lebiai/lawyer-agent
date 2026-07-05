#!/usr/bin/env node
/**
 * 知识图谱可视化生成器 (Node.js)
 * 替换旧的 generate-viz.py，消除 Python 依赖
 *
 * 用法: node scripts/generate-viz.mjs [--with-seed]
 *   --with-seed: 同时加载公共知识库 (seed.db)
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..");
const DB_DIR = join(PROJECT_DIR, "mcp", "knowledge-server", "data");

// 通过 NODE_PATH 或 fallback 加载 better-sqlite3
let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  const req = createRequire(import.meta.url);
  const paths = [
    join(PROJECT_DIR, "mcp", "knowledge-server", "node_modules"),
  ];
  for (const p of paths) {
    try {
      Database = req(join(p, "better-sqlite3"));
      break;
    } catch {}
  }
}

const COLORS = { law: '#3498db', case: '#e67e22', term: '#27ae60', template: '#9b59b6', case_analysis: '#8e44ad', personal_note: '#e74c3c' };
const LABELS = { law: '法条', case: '判例', term: '术语', template: '模板', case_analysis: '案件分析', personal_note: '个人笔记' };
const ICONS = { law: '📖', case: '⚖️', term: '📝', template: '📋', case_analysis: '🔍', personal_note: '📓' };
const SOURCE_LABELS = {
  seed: { icon: '📚', label: '公共知识库' },
  extract: { icon: '🤖', label: 'AI 分析' },
  manual: { icon: '📝', label: '个人笔记' },
};
const SOURCE_DEFAULT = { icon: '📓', label: '个人知识' };

function loadDb(dbPath, label) {
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath);
  let rows;
  try {
    rows = db.prepare('SELECT id, type, title, content, tags, reference, source, usage_count FROM knowledge').all();
  } catch {
    db.close();
    return [];
  }
  db.close();
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    title: r.title,
    content: r.content || '',
    tags: (() => { try { return JSON.parse(r.tags || '[]'); } catch { return []; } })(),
    reference: r.reference || '',
    source: r.source || '',
    usage: r.usage_count || 0,
    dbLabel: label,
  }));
}

function buildGraph(items) {
  const nodes = [];
  const edges = [];
  const edgeSet = new Set();

  for (const it of items) {
    const sl = SOURCE_LABELS[it.source] || SOURCE_DEFAULT;
    nodes.push({
      id: it.id,
      label: it.title,
      type: it.type,
      color: COLORS[it.type] || '#95a5a6',
      ref: it.reference,
      src: it.source,
      usage: it.usage,
      dbLabel: it.dbLabel,
      content: it.content,
      sourceIcon: sl.icon,
      sourceLabel: sl.label,
    });
  }

  const tagMap = {};
  for (const it of items) {
    for (const t of it.tags) {
      if (['法条引用', '类案', '模板'].includes(t)) continue;
      if (!tagMap[t]) tagMap[t] = [];
      tagMap[t].push(it.id);
    }
  }
  for (const [tag, ids] of Object.entries(tagMap)) {
    if (ids.length < 2 || ids.length > 8) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        if (!edgeSet.has(key) && edges.length < 500) {
          edgeSet.add(key);
          edges.push({ src: ids[i], tgt: ids[j], label: tag, style: 'dashed' });
        }
      }
    }
  }
  for (const it of items) {
    if (!it.reference) continue;
    for (const other of items) {
      if (other.id === it.id) continue;
      if (it.reference && (other.title?.includes(it.reference) || other.reference?.includes(it.title))) {
        const key = it.id < other.id ? `${it.id}|${other.id}` : `${other.id}|${it.id}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ src: it.id, tgt: other.id, label: '引用', style: 'solid' });
        }
      }
    }
  }
  return { nodes, edges };
}

function generateHtml(nodes, edges) {
  const stats = { total: 0 };
  for (const k of Object.keys(LABELS)) stats[k] = 0;
  stats.total = nodes.length;
  for (const n of nodes) {
    if (stats[n.type] !== undefined) stats[n.type]++;
  }

  const nj = JSON.stringify(nodes, null, 1);
  const ej = JSON.stringify(edges, null, 1);
  const sj = JSON.stringify(stats);
  const cj = JSON.stringify(COLORS);
  const lj = JSON.stringify(LABELS);
  const ij = JSON.stringify(ICONS);

  const CSS = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;background:#f5f6fa;color:#2c3e50;display:flex;flex-direction:column;height:100vh;overflow:hidden}.hdr{background:linear-gradient(135deg,#2c3e50,#3498db);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}.hdr h1{font-size:18px;font-weight:600}.hdr .info{font-size:12px;opacity:.8}.mn{display:flex;flex:1;overflow:hidden}.sb{width:280px;min-width:280px;background:#fff;border-right:1px solid #e1e4e8;display:flex;flex-direction:column;overflow-y:auto}.sb section{padding:14px 16px;border-bottom:1px solid #f0f0f0}.sb section:last-child{flex:1;border-bottom:none}.sb h3{font-size:12px;color:#7f8c8d;margin-bottom:8px}.sg{display:grid;grid-template-columns:1fr 1fr;gap:6px}.sc{background:#f8f9fa;border-radius:6px;padding:10px;text-align:center}.sc .n{font-size:22px;font-weight:700}.sc .l{font-size:11px;color:#7f8c8d;margin-top:1px}.sb input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none}.sb input:focus{border-color:#3498db}.ft{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}.ft span{padding:3px 9px;border-radius:10px;border:1px solid #ddd;font-size:11px;cursor:pointer;background:#fff;user-select:none;transition:all .15s}.ft span:hover{border-color:#3498db}.ft .on.law{background:#3498db;color:#fff;border-color:transparent}.ft .on.case{background:#e67e22;color:#fff;border-color:transparent}.ft .on.term{background:#27ae60;color:#fff;border-color:transparent}.ft .on.template{background:#9b59b6;color:#fff;border-color:transparent}.ft .on.personal_note{background:#e74c3c;color:#fff;border-color:transparent}.ft .on.all{background:#2c3e50;color:#fff;border-color:transparent}.nl{flex:1;overflow-y:auto;padding:4px 0}.ni{padding:5px 8px;display:flex;align-items:center;gap:6px;cursor:pointer;border-radius:4px;transition:background .1s;font-size:12px}.ni:hover{background:#f0f4ff}.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt{font-size:10px;color:#999;flex-shrink:0}.ga{flex:1;position:relative;overflow:hidden}#cy{width:100%;height:100%;position:relative}.leg{position:absolute;bottom:14px;right:14px;background:rgba(255,255,255,.92);border-radius:8px;padding:8px 12px;font-size:11px;box-shadow:0 1px 6px rgba(0,0,0,.1)}.leg div{display:flex;align-items:center;gap:5px;margin:2px 0}.ld{width:8px;height:8px;border-radius:50%;display:inline-block}.dp{position:absolute;top:0;right:0;width:340px;height:100%;background:#fff;box-shadow:-2px 0 12px rgba(0,0,0,.08);padding:16px;overflow-y:auto;display:none;z-index:10}.dp.sh{display:block}.dx{float:right;background:none;border:none;font-size:16px;cursor:pointer;color:#999}.dx:hover{color:#333}.dt{font-size:14px;font-weight:600;margin-bottom:8px;padding-right:24px}.dm{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.src-badge{padding:2px 8px;border-radius:4px;font-size:11px;background:#f0f4ff;color:#555}.dty{font-size:11px;padding:2px 8px;border-radius:8px;color:#fff}.dc{font-size:12px;color:#333;line-height:1.7;margin-bottom:10px;white-space:pre-wrap;word-break:break-all}.dtg{display:flex;flex-wrap:wrap;gap:4px}.dtg span{background:#f0f4ff;padding:2px 8px;border-radius:8px;font-size:10px;color:#555}.tp{position:absolute;background:rgba(0,0,0,.78);color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:20;white-space:nowrap;max-width:400px;overflow:hidden;text-overflow:ellipsis}`;

  const JS = `
var NODES = ${nj};
var EDGES = ${ej};
var COLORS = ${cj};
var LABELS = ${lj};
var STATS = ${sj};
var ICONS = ${ij};

var nodeMap = {};
NODES.forEach(function(n) { nodeMap[n.id] = n; });

document.getElementById('hdrInfo').textContent = NODES.length + '条知识';

var sg = document.getElementById('stats');
sg.innerHTML = Object.keys(STATS).map(function(k) {
  if (k === 'total') return '<div class="sc"><div class="n">' + STATS[k] + '</div><div class="l">总计</div></div>';
  return '<div class="sc"><div class="n">' + STATS[k] + '</div><div class="l">' + (LABELS[k]||k) + '</div></div>';
}).join('');

var activeFilters = {};
Object.keys(LABELS).forEach(function(k) { activeFilters[k] = true; });

var ft = document.getElementById('filters');
var filterHtml = '<span class="on all" onclick="toggleFilter(\'all\')">全部</span>';
Object.keys(LABELS).forEach(function(k) {
  filterHtml += '<span class="on ' + k + '" onclick="toggleFilter(\'' + k + '\')">' + (ICONS[k]||'') + ' ' + LABELS[k] + '</span>';
});
ft.innerHTML = filterHtml;

function toggleFilter(t) {
  if (t === 'all') {
    var allOn = document.querySelectorAll('.ft span.on').length === Object.keys(LABELS).length + 1;
    var newVal = !allOn;
    document.querySelectorAll('.ft span').forEach(function(s) { s.classList.toggle('on', newVal); });
    Object.keys(activeFilters).forEach(function(k) { activeFilters[k] = newVal; });
  } else {
    activeFilters[t] = !activeFilters[t];
    document.querySelector('.ft .all').classList.toggle('on', Object.values(activeFilters).every(Boolean));
    document.querySelector('.ft .' + t).classList.toggle('on', activeFilters[t]);
  }
  updateList();
  updateGraph();
}

var searchTimeout = null;
document.getElementById('search').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(updateView, 200);
});

function updateView() { updateList(); updateGraph(); }

function updateList() {
  var q = document.getElementById('search').value.toLowerCase();
  var filtered = NODES.filter(function(n) {
    if (!activeFilters[n.type]) return false;
    if (q && !n.label.toLowerCase().includes(q) && !(n.content || '').toLowerCase().includes(q)) return false;
    return true;
  });
  document.getElementById('nc').textContent = '(' + filtered.length + ')';
  document.getElementById('nl').innerHTML = filtered.map(function(n) {
    return '<div class="ni" onclick="focusNode(\'' + n.id + '\')"><span class="dot" style="background:' + n.color + '"></span><span class="nm">' + n.label + '</span><span class="nt">' + (LABELS[n.type]||n.type) + '</span></div>';
  }).join('');
}

function updateGraph() {
  if (typeof cy === 'undefined') return;
  var q = document.getElementById('search').value.toLowerCase();
  var visible = {};
  NODES.forEach(function(n) {
    if (!activeFilters[n.type]) return;
    if (q && !n.label.toLowerCase().includes(q) && !(n.content || '').toLowerCase().includes(q)) return;
    visible[n.id] = true;
  });
  cy.nodes().forEach(function(n) {
    if (visible[n.id()]) { n.show(); } else { n.hide(); }
  });
  cy.edges().forEach(function(e) {
    var src = e.source().id(), tgt = e.target().id();
    if (visible[src] && visible[tgt]) { e.show(); } else { e.hide(); }
  });
  cy.layout({name:'cose',animate:false}).run();
}

function focusNode(id) {
  if (typeof cy === 'undefined') return;
  var n = cy.getElementById(id);
  if (n.length) {
    n.select();
    cy.fit(n, 50);
    cy.center(n);
    showDetail(id);
  }
}

function showDetail(id) {
  var n = nodeMap[id];
  if (!n) return;
  document.getElementById('dt').textContent = n.label;
  document.getElementById('dty').textContent = LABELS[n.type] || n.type;
  document.getElementById('dty').style.background = n.color;
  document.getElementById('dsrc').textContent = n.sourceIcon + ' ' + n.sourceLabel;
  document.getElementById('dusage').textContent = '引用 ' + n.usage + ' 次';
  document.getElementById('dc').textContent = n.content || '(无详细内容)';
  var tg = document.getElementById('dtg');
  tg.innerHTML = '';
  for (var _i = 0; _i < Math.min((n.tags||[]).length, 10); _i++) {
    var sp = document.createElement('span');
    sp.textContent = n.tags[_i];
    tg.appendChild(sp);
  }
  document.getElementById('dp').classList.add('sh');
}

function cD() { document.getElementById('dp').classList.remove('sh'); }

var tp = document.getElementById('tp');

// 数据初始化（不依赖任何外部库）
updateList();

var leg = document.getElementById('legend');
leg.innerHTML = Object.keys(LABELS).map(function(k) {
  return '<div><span class="ld" style="background:' + COLORS[k] + '"></span><span>' + (ICONS[k]||'') + ' ' + LABELS[k] + '</span></div>';
}).join('');

// Cytoscape 图谱渲染（CDN 加载失败不影响数据展示）
window.addEventListener('load', function() {
  if (typeof cytoscape === 'undefined') return;
  try {
    var cy_elem = document.getElementById('cy');
    var cy = cytoscape({
      container: cy_elem,
      elements: [
        ...NODES.map(function(n) { return { data: { id: n.id, label: n.label } }; }),
        ...EDGES.map(function(e) { return { data: { source: e.src, target: e.tgt, label: e.label } }; })
      ],
      style: [
        { selector: 'node', style: { 'background-color': function(ele) { return nodeMap[ele.id()] ? nodeMap[ele.id()].color : '#999'; }, label: 'data(label)', 'font-size': '12px', 'text-valign': 'center', 'text-halign': 'center', width: 'label', height: 'label', padding: '10px', 'border-width': 0, 'text-wrap': 'wrap', 'max-width': '120px' } },
        { selector: 'edge', style: { width: 1, 'line-color': '#ccc', 'target-arrow-color': '#ccc', 'curve-style': 'bezier', label: 'data(label)', 'font-size': '10px', 'text-background-opacity': 1, 'text-background-color': '#fff', 'text-background-padding': '2px', 'line-style': function(ele) { return ele.data().style === 'dashed' ? 'dashed' : 'solid'; } } },
        { selector: ':selected', style: { 'border-color': '#3498db', 'border-width': 2 } }
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: 8000, idealEdgeLength: 120, gravity: 0.25 },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    cy.on('tap', 'node', function(evt) {
      showDetail(evt.target.id());
      cy.fit(evt.target, 50);
      cy.center(evt.target);
    });

    cy.on('mouseover', 'node', function(evt) {
      var n = nodeMap[evt.target.id()];
      if (n) {
        tp.textContent = n.label;
        tp.style.display = 'block';
      }
    });
    cy.on('mouseout', 'node', function() { tp.style.display = 'none'; });
  } catch(e) {}
});
`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>律师助手 - 知识图谱</title>
<script src="https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
<style>${CSS}</style>
</head>
<body>
<div class="hdr"><h1>📚 律师助手 - 知识图谱</h1><div class="info" id="hdrInfo"></div></div>
<div class="mn">
<div class="sb">
<section><h3>📊 知识统计</h3><div class="sg" id="stats"></div></section>
<section><h3>🔍 搜索</h3><input id="search" placeholder="输入关键词..." oninput="updateView()"></section>
<section><h3>🏷️ 筛选类型</h3><div class="ft" id="filters"></div></section>
<section style="flex:1"><h3>📋 节点列表 <span id="nc" style="font-weight:400;color:#999;font-size:11px"></span></h3><div class="nl" id="nl"></div></section>
</div>
<div class="ga">
<div id="cy"></div>
<div class="leg" id="legend"></div>
<div class="dp" id="dp"><button class="dx" onclick="cD()">✕</button><div class="dt" id="dt"></div><div class="dm"><span class="dty" id="dty"></span><span class="src-badge" id="dsrc"></span><span id="dusage" style="font-size:11px;color:#999"></span></div><div class="dc" id="dc"></div><div class="dtg" id="dtg"></div></div>
<div class="tp" id="tp"></div>
</div>
</div>
<script>${JS}</script>
</body>
</html>`;
}

// ===== Main =====

const useSeed = process.argv.includes('--with-seed');
const dbs = [['knowledge.db', '个人']];
if (useSeed) dbs.unshift(['seed.db', '公共']);

let allItems = [];
for (const [fn, lb] of dbs) {
  allItems = allItems.concat(loadDb(join(DB_DIR, fn), lb));
  console.error('  ' + fn + ': ' + allItems.length + ' items (' + lb + ')');
}

const { nodes, edges } = buildGraph(allItems);
const html = generateHtml(nodes, edges);

const outPath = join(PROJECT_DIR, 'kb-viz.html');
writeFileSync(outPath, html, 'utf-8');
console.error('Done: ' + outPath);
console.error('Nodes: ' + nodes.length + ', Edges: ' + edges.length);
