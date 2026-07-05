import json, sqlite3, os, sys, sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(PROJECT_DIR, 'mcp', 'knowledge-server', 'data')

COLORS = {'law':'#3498db','case':'#e67e22','term':'#27ae60','template':'#9b59b6','case_analysis':'#8e44ad','personal_note':'#e74c3c'}
LABELS = {'law':'法条','case':'判例','term':'术语','template':'模板','case_analysis':'案件分析','personal_note':'个人笔记'}
ICONS = {'law':'📖','case':'⚖️','term':'📝','template':'📋','case_analysis':'🔍','personal_note':'📓'}

# 来源标识映射
SOURCE_LABELS = {
    'seed': {'icon': '📚', 'label': '公共知识库'},
    'extract': {'icon': '🤖', 'label': 'AI 分析'},
    'manual': {'icon': '📝', 'label': '个人笔记'},
}
SOURCE_DEFAULT = {'icon': '📓', 'label': '个人知识'}

def load_db(path, label):
    if not os.path.exists(path): return []
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute('SELECT id,type,title,content,tags,reference,source,usage_count FROM knowledge').fetchall()
    except:
        return []
    conn.close()
    items = []
    for r in rows:
        try: tags = json.loads(r[4] or '[]')
        except: tags = []
        items.append(dict(id=r[0],type=r[1],title=r[2],content=r[3] or '',tags=tags,reference=r[5] or '',source=r[6] or '',usage=r[7] or 0,dbLabel=label))
    return items

def build_graph(items):
    nodes, edges, edge_set = [], [], set()
    for it in items:
        sl = SOURCE_LABELS.get(it['source'], SOURCE_DEFAULT)
        nodes.append(dict(
            id=it['id'], label=it['title'], type=it['type'],
            color=COLORS.get(it['type'], '#95a5a6'),
            ref=it['reference'], src=it['source'], usage=it['usage'],
            dbLabel=it['dbLabel'], content=it['content'],
            sourceIcon=sl['icon'], sourceLabel=sl['label'],
        ))
    tag_map = {}
    for it in items:
        for t in it['tags']:
            if t in ('法条引用','类案','模板'): continue
            tag_map.setdefault(t, []).append(it['id'])
    for tag,ids in tag_map.items():
        if len(ids) < 2 or len(ids) > 8: continue
        for i in range(len(ids)):
            for j in range(i+1, len(ids)):
                key = tuple(sorted([ids[i],ids[j]]))
                if key not in edge_set and len(edges) < 500:
                    edge_set.add(key)
                    edges.append(dict(src=ids[i],tgt=ids[j],label=tag,style='dashed'))
    for it in items:
        if not it['reference']: continue
        for other in items:
            if other['id'] == it['id']: continue
            if it['reference'] in other['title'] or other['reference'] in it['title']:
                key = tuple(sorted([it['id'],other['id']]))
                if key not in edge_set:
                    edge_set.add(key)
                    edges.append(dict(src=it['id'],tgt=other['id'],label='引用',style='solid'))
    return nodes, edges

use_seed = '--with-seed' in sys.argv
dbs = [('knowledge.db', '个人')]
if use_seed:
    dbs.insert(0, ('seed.db', '公共'))

items = []
for fn, lb in dbs:
    items.extend(load_db(os.path.join(DB_DIR, fn), lb))

nodes, edges = build_graph(items)
stats = {'total': len(items)}
for k in LABELS:
    stats[k] = sum(1 for n in nodes if n['type'] == k)

nj = json.dumps(nodes, ensure_ascii=False)
ej = json.dumps(edges, ensure_ascii=False)
sj = json.dumps(stats, ensure_ascii=False)
cj = json.dumps(COLORS, ensure_ascii=False)
lj = json.dumps(LABELS, ensure_ascii=False)
ij = json.dumps(ICONS, ensure_ascii=False)

JS = f"""
var NODES = {nj};
var EDGES = {ej};
var COLORS = {cj};
var LABELS = {lj};
var STATS = {sj};
var ICONS = {ij};

var nodeMap = {{}};
NODES.forEach(function(n) {{ nodeMap[n.id] = n; }});

document.getElementById('hdrInfo').textContent = NODES.length + '条知识';

var sg = document.getElementById('stats');
sg.innerHTML = Object.keys(STATS).map(function(k) {{
  if (k === 'total') return '<div class="sc"><div class="n">' + STATS[k] + '</div><div class="l">总计</div></div>';
  return '<div class="sc"><div class="n">' + STATS[k] + '</div><div class="l">' + (LABELS[k]||k) + '</div></div>';
}}).join('');

var activeFilters = {{}};
Object.keys(LABELS).forEach(function(k) {{ activeFilters[k] = true; }});

var ft = document.getElementById('filters');
var filterHtml = '<span class="on all" onclick="toggleFilter(\\'all\\')">全部</span>';
Object.keys(LABELS).forEach(function(k) {{
  filterHtml += '<span class="on ' + k + '" onclick="toggleFilter(\\'' + k + '\\')">' + (ICONS[k]||'') + ' ' + LABELS[k] + '</span>';
}});
ft.innerHTML = filterHtml;

function toggleFilter(t) {{
  if (t === 'all') {{
    var allOn = document.querySelectorAll('.ft span.on').length === Object.keys(LABELS).length + 1;
    var newVal = !allOn;
    document.querySelectorAll('.ft span').forEach(function(s) {{ s.classList.toggle('on', newVal); }});
    Object.keys(activeFilters).forEach(function(k) {{ activeFilters[k] = newVal; }});
  }} else {{
    activeFilters[t] = !activeFilters[t];
    document.querySelector('.ft span.all').classList.remove('on');
    document.querySelectorAll('.ft span').forEach(function(s) {{
      if (s.classList.contains(t)) s.classList.toggle('on');
    }});
  }}
  updateView();
}}

function getFiltered() {{
  var q = document.getElementById('search').value.toLowerCase();
  return NODES.filter(function(n) {{
    return activeFilters[n.type] && (!q || n.label.toLowerCase().indexOf(q) >= 0 || (n.ref||'').toLowerCase().indexOf(q) >= 0 || (n.content||'').toLowerCase().indexOf(q) >= 0);
  }});
}}

function rG(items, edges) {{
  var cy = document.getElementById('cy');
  var svg = document.querySelector('#cy svg');
  if (!svg) {{
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;top:0;left:0';
    cy.appendChild(svg);
  }}
  svg.innerHTML = '';
  var eg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(eg);
  var ng = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(ng);

  var ids = {{}};
  items.forEach(function(n) {{ ids[n.id] = true; }});
  var fEdges = edges.filter(function(e) {{ return ids[e.src] && ids[e.tgt]; }});

  var w = cy.clientWidth || 800;
  var h = cy.clientHeight || 500;
  var cx = w / 2;
  var cy_h = h / 2;

  var nodes = items.map(function(n) {{
    return {{ id: n.id, label: n.label, type: n.type, color: n.color, ref: n.ref, usage: n.usage || 0,
             content: n.content || '', sourceIcon: n.sourceIcon || '📓', sourceLabel: n.sourceLabel || '',
             x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0 }};
  }});
  var nm = {{}};
  nodes.forEach(function(n) {{ nm[n.id] = n; }});

  (function step() {{
    for (var i = 0; i < nodes.length; i++) {{
      var n = nodes[i];
      n.vx += (cx - n.x) * 0.001;
      n.vy += (cy_h - n.y) * 0.001;
      for (var j = 0; j < nodes.length; j++) {{
        if (i === j) continue;
        var o = nodes[j];
        var dx = n.x - o.x, dy = n.y - o.y;
        var dist = Math.sqrt(dx*dx + dy*dy) || 1;
        var f = 2000 / (dist * dist);
        n.vx += dx/dist * f;
        n.vy += dy/dist * f;
      }}
    }}
    for (var k = 0; k < fEdges.length; k++) {{
      var e = fEdges[k];
      var s = nm[e.src], t = nm[e.tgt];
      if (!s || !t) continue;
      var dx = t.x - s.x, dy = t.y - s.y;
      var dist = Math.sqrt(dx*dx + dy*dy) || 1;
      var f2 = (dist - 120) * 0.005;
      var fx = dx/dist * f2, fy = dy/dist * f2;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }}
    for (var i = 0; i < nodes.length; i++) {{
      var n = nodes[i];
      n.vx *= 0.85; n.vy *= 0.85;
      var sp = Math.sqrt(n.vx*n.vx + n.vy*n.vy);
      if (sp > 3) {{ n.vx *= 3/sp; n.vy *= 3/sp; }}
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(20, Math.min(w-20, n.x));
      n.y = Math.max(20, Math.min(h-20, n.y));
    }}
    var edgeHtml = '';
    for (var k = 0; k < fEdges.length; k++) {{
      var e = fEdges[k];
      var s = nm[e.src], t = nm[e.tgt];
      if (!s || !t) continue;
      var st = e.style === 'solid' ? 'stroke:#e74c3c;stroke-width:1.5' : 'stroke:#bdc3c7;stroke-width:1;stroke-dasharray:4,3';
      edgeHtml += '<line x1="' + s.x + '" y1="' + s.y + '" x2="' + t.x + '" y2="' + t.y + '" style="' + st + ';opacity:.5"/>';
    }}
    eg.innerHTML = edgeHtml;
    var nodeHtml = '';
    for (var i = 0; i < nodes.length; i++) {{
      var n = nodes[i];
      var r = Math.min(8 + (n.usage||0) * 0.5, 20);
      nodeHtml += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + n.color + '" stroke="#fff" stroke-width="1.5" style="cursor:pointer" onclick="showDetail(\\'' + n.id + '\\')" onmouseover="showTooltip(\\'' + (n.label||'').replace(/'/g, '') + '\\',event)" onmouseout="hideTooltip()"/>';
    }}
    ng.innerHTML = nodeHtml;
    var moving = false;
    for (var i = 0; i < nodes.length; i++) {{
      if (Math.abs(nodes[i].vx) > 0.1 || Math.abs(nodes[i].vy) > 0.1) {{ moving = true; break; }}
    }}
    if (moving) {{ requestAnimationFrame(step); }}
  }})();
}}

function updateView() {{
  var f = getFiltered();
  rG(f, EDGES);
  document.getElementById('nc').textContent = '(显示 ' + f.length + ' 条)';
  document.getElementById('nl').innerHTML = f.map(function(n) {{
    return '<div class="ni" onclick="showDetail(\\'' + n.id + '\\')"><span class="dot" style="background:' + n.color + '"></span><span class="nm">' + n.label + '</span><span class="nt">' + (LABELS[n.type]||n.type) + '</span></div>';
  }}).join('');
}}

function showDetail(id) {{
  var n = nodeMap[id];
  if (!n) return;
  document.getElementById('dt').textContent = n.label;
  var d = document.getElementById('dty');
  d.textContent = LABELS[n.type] || n.type;
  d.style.background = COLORS[n.type] || '#95a5a6';
  document.getElementById('dsrc').innerHTML = (n.sourceIcon || '📓') + ' ' + (n.sourceLabel || '个人知识');
  document.getElementById('dusage').textContent = '使用 ' + (n.usage||0) + ' 次';
  document.getElementById('dc').textContent = n.content || '(无详细内容)';
  document.getElementById('dp').classList.add('sh');
}}
function cD() {{ document.getElementById('dp').classList.remove('sh'); }}
function showTooltip(t, e) {{
  var tp = document.getElementById('tp');
  tp.textContent = t;
  tp.style.display = 'block';
  var r = document.querySelector('.ga').getBoundingClientRect();
  tp.style.left = (e.clientX - r.left + 10) + 'px';
  tp.style.top = (e.clientY - r.top - 20) + 'px';
}}
function hideTooltip() {{ document.getElementById('tp').style.display = 'none'; }}

document.getElementById('legend').innerHTML = Object.keys(COLORS).map(function(k) {{
  return '<div><span class="ld" style="background:' + COLORS[k] + '"></span> ' + LABELS[k] + '</div>';
}}).join('');

updateView();
"""

CSS = '*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6fa;color:#2c3e50;display:flex;flex-direction:column;height:100vh;overflow:hidden}.hdr{background:linear-gradient(135deg,#2c3e50,#3498db);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}.hdr h1{font-size:18px;font-weight:600}.hdr .info{font-size:12px;opacity:.8}.mn{display:flex;flex:1;overflow:hidden}.sb{width:280px;min-width:280px;background:#fff;border-right:1px solid #e1e4e8;display:flex;flex-direction:column;overflow-y:auto}.sb section{padding:14px 16px;border-bottom:1px solid #f0f0f0}.sb section:last-child{flex:1;border-bottom:none}.sb h3{font-size:12px;color:#7f8c8d;margin-bottom:8px}.sg{display:grid;grid-template-columns:1fr 1fr;gap:6px}.sc{background:#f8f9fa;border-radius:6px;padding:10px;text-align:center}.sc .n{font-size:22px;font-weight:700}.sc .l{font-size:11px;color:#7f8c8d;margin-top:1px}.sb input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none}.sb input:focus{border-color:#3498db}.ft{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}.ft span{padding:3px 9px;border-radius:10px;border:1px solid #ddd;font-size:11px;cursor:pointer;background:#fff;user-select:none;transition:all .15s}.ft span:hover{border-color:#3498db}.ft .on.law{background:#3498db;color:#fff;border-color:transparent}.ft .on.case{background:#e67e22;color:#fff;border-color:transparent}.ft .on.term{background:#27ae60;color:#fff;border-color:transparent}.ft .on.template{background:#9b59b6;color:#fff;border-color:transparent}.ft .on.personal_note{background:#e74c3c;color:#fff;border-color:transparent}.ft .on.all{background:#2c3e50;color:#fff;border-color:transparent}.nl{flex:1;overflow-y:auto;padding:4px 0}.ni{padding:5px 8px;display:flex;align-items:center;gap:6px;cursor:pointer;border-radius:4px;transition:background .1s;font-size:12px}.ni:hover{background:#f0f4ff}.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt{font-size:10px;color:#999;flex-shrink:0}.ga{flex:1;position:relative;overflow:hidden}#cy{width:100%;height:100%;position:relative}.leg{position:absolute;bottom:14px;right:14px;background:rgba(255,255,255,.92);border-radius:8px;padding:8px 12px;font-size:11px;box-shadow:0 1px 6px rgba(0,0,0,.1)}.leg div{display:flex;align-items:center;gap:5px;margin:2px 0}.ld{width:8px;height:8px;border-radius:50%;display:inline-block}.dp{position:absolute;top:0;right:0;width:340px;height:100%;background:#fff;box-shadow:-2px 0 12px rgba(0,0,0,.08);padding:16px;overflow-y:auto;display:none;z-index:10}.dp.sh{display:block}.dx{float:right;background:none;border:none;font-size:16px;cursor:pointer;color:#999}.dx:hover{color:#333}.dt{font-size:14px;font-weight:600;margin-bottom:8px;padding-right:24px}.dm{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.src-badge{padding:2px 8px;border-radius:4px;font-size:11px;background:#f0f4ff;color:#555}.dty{font-size:11px;padding:2px 8px;border-radius:8px;color:#fff}.dc{font-size:12px;color:#333;line-height:1.7;margin-bottom:10px;white-space:pre-wrap;word-break:break-all}.dtg{display:flex;flex-wrap:wrap;gap:4px}.dtg span{background:#f0f4ff;padding:2px 8px;border-radius:8px;font-size:10px;color:#555}.tp{position:absolute;background:rgba(0,0,0,.78);color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:20;white-space:nowrap;max-width:400px;overflow:hidden;text-overflow:ellipsis}'

HTML = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>律师助手 - 知识图谱</title>
<style>{CSS}</style>
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
<div class="dp" id="dp"><button class="dx" onclick="cD()">✕</button><div class="dt" id="dt"></div><div class="dm"><span class="dty" id="dty"></span><span class="src-badge" id="dsrc"></span><span id="dusage" style="font-size:11px;color:#999"></span></div><div class="dc" id="dc"></div></div>
<div class="tp" id="tp"></div>
</div>
</div>
<script>{JS}</script>
</body>
</html>'''

out_path = os.path.join(PROJECT_DIR, 'kb-viz.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(HTML)
print(f'Done: {out_path}')
print(f'Nodes: {len(nodes)}, Edges: {len(edges)}')
