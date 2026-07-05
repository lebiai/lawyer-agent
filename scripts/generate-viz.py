#!/usr/bin/env python3
"""生成知识图谱静态 HTML（所有数据内嵌，零外部依赖）"""
import json, sqlite3, os, sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(PROJECT_DIR, 'mcp', 'knowledge-server', 'data')

COLORS = {'law': '#3498db', 'case': '#e67e22', 'term': '#27ae60',
          'template': '#9b59b6', 'personal_note': '#e74c3c'}
LABELS = {'law': '法条', 'case': '判例', 'term': '术语',
          'template': '模板', 'personal_note': '个人笔记'}

def load_db(path, label):
    if not os.path.exists(path): return []
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute("SELECT id, type, title, content, tags, reference, source, usage_count FROM knowledge").fetchall()
    except:
        return []
    conn.close()
    items = []
    for r in rows:
        try: tags = json.loads(r[4] or '[]')
        except: tags = []
        items.append({'id': r[0], 'type': r[1], 'title': r[2], 'content': r[3],
                      'tags': tags, 'reference': r[5] or '', 'source': r[6] or '',
                      'usage': r[7] or 0, 'dbLabel': label})
    return items

def build_graph(items):
    nodes = []
    edges = []
    edge_set = set()

    for it in items:
        nodes.append({'id': it['id'], 'label': it['title'], 'type': it['type'],
                      'color': COLORS.get(it['type'], '#95a5a6'),
                      'ref': it['reference'], 'src': it['source'],
                      'usage': it['usage'], 'dbLabel': it['dbLabel']})

    # Tag-based edges
    tag_map = {}
    for it in items:
        for t in it['tags']:
            if t in ('法条引用', '类案', '模板'): continue
            tag_map.setdefault(t, []).append(it['id'])
    for tag, ids in tag_map.items():
        if len(ids) < 2 or len(ids) > 8: continue
        for i in range(len(ids)):
            for j in range(i+1, len(ids)):
                key = tuple(sorted([ids[i], ids[j]]))
                if key not in edge_set and len(edges) < 500:
                    edge_set.add(key)
                    edges.append({'src': ids[i], 'tgt': ids[j], 'label': tag, 'style': 'dashed'})

    # Reference edges
    for it in items:
        if not it['reference']: continue
        for other in items:
            if other['id'] == it['id']: continue
            if it['reference'] in other['title'] or other['reference'] in it['title']:
                key = tuple(sorted([it['id'], other['id']]))
                if key not in edge_set:
                    edge_set.add(key)
                    edges.append({'src': it['id'], 'tgt': other['id'], 'label': '引用', 'style': 'solid'})

    return nodes, edges

def main():
    use_seed = '--no-seed' not in sys.argv
    use_kb = '--no-kb' not in sys.argv

    items = []
    dbs = []
    if use_seed:
        i = load_db(os.path.join(DB_DIR, 'seed.db'), '公共')
        items.extend(i)
        dbs.append('公共知识库')
    if use_kb:
        i = load_db(os.path.join(DB_DIR, 'knowledge.db'), '个人')
        items.extend(i)
        dbs.append('个人知识库')

    if not items:
        print('❌ 未找到数据')
        sys.exit(1)

    nodes, edges = build_graph(items)
    stats = {'total': len(items)}
    for k in LABELS:
        stats[k] = sum(1 for n in nodes if n['type'] == k)

    html = gen_html(nodes, edges, stats, dbs)
    out_path = os.path.join(PROJECT_DIR, 'kb-viz.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'✅ 生成完成: {out_path}')
    print(f'   共 {len(nodes)} 条知识, {len(edges)} 条关联')
    print(f'   分布: {json.dumps(stats, ensure_ascii=False)}')

def gen_html(nodes, edges, stats, db_names):
    nj = json.dumps(nodes, ensure_ascii=False)
    ej = json.dumps(edges, ensure_ascii=False)
    sj = json.dumps(stats, ensure_ascii=False)
    dj = json.dumps(db_names, ensure_ascii=False)

    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>律师助手 - 知识图谱</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#f5f6fa;color:#2c3e50;display:flex;flex-direction:column;height:100vh;overflow:hidden}}
.hdr{{background:linear-gradient(135deg,#2c3e50,#3498db);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}}
.hdr h1{{font-size:18px;font-weight:600}}
.hdr .info{{font-size:12px;opacity:.8}}
.mn{{display:flex;flex:1;overflow:hidden}}
.sb{{width:280px;min-width:280px;background:#fff;border-right:1px solid #e1e4e8;display:flex;flex-direction:column;overflow-y:auto}}
.sb section{{padding:14px 16px;border-bottom:1px solid #f0f0f0}}
.sb section:last-child{{flex:1;border-bottom:none}}
.sb h3{{font-size:12px;color:#7f8c8d;margin-bottom:8px}}
.sg{{display:grid;grid-template-columns:1fr 1fr;gap:6px}}
.sc{{background:#f8f9fa;border-radius:6px;padding:10px;text-align:center}}
.sc .n{{font-size:22px;font-weight:700}}
.sc .l{{font-size:11px;color:#7f8c8d;margin-top:1px}}
.sb input{{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none}}
.sb input:focus{{border-color:#3498db}}
.ft{{display:flex;flex-wrap:wrap;gap:5px}}
.ft span{{padding:3px 9px;border-radius:10px;border:1px solid #ddd;font-size:11px;cursor:pointer;background:#fff;user-select:none;transition:all .15s}}
.ft span:hover{{border-color:#3498db}}
.ft .on{{color:#fff;border-color:transparent}}
.ft .on.law{{background:#3498db}}
.ft .on.case{{background:#e67e22}}
.ft .on.term{{background:#27ae60}}
.ft .on.template{{background:#9b59b6}}
.ft .on.personal_note{{background:#e74c3c}}
.nl{{max-height:280px;overflow-y:auto}}
.ni{{padding:5px 8px;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;transition:background .15s}}
.ni:hover{{background:#f0f4ff}}
.ni .dot{{width:8px;height:8px;border-radius:50%;flex-shrink:0}}
.ni .nm{{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.ni .nt{{font-size:10px;color:#999;flex-shrink:0}}
.ga{{flex:1;position:relative;background:#fff;overflow:hidden}}
#cy{{width:100%;height:100%}}
.leg{{position:absolute;top:10px;right:10px;background:rgba(255,255,255,.95);border:1px solid #e1e4e8;border-radius:6px;padding:10px;font-size:11px;z-index:5;box-shadow:0 2px 6px rgba(0,0,0,.08)}}
.leg div{{display:flex;align-items:center;gap:5px;margin:2px 0}}
.ld{{width:9px;height:9px;border-radius:50%}}
.dp{{position:absolute;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e1e4e8;padding:14px 18px;transform:translateY(100%);transition:transform .3s;max-height:180px;overflow-y:auto;z-index:10}}
.dp.sh{{transform:translateY(0)}}
.dp .dx{{float:right;background:none;border:none;font-size:16px;cursor:pointer;color:#7f8c8d;padding:0 4px}}
.dp .dt{{font-size:14px;font-weight:600;margin-bottom:3px}}
.dp .dm{{font-size:11px;color:#7f8c8d;margin-bottom:6px;display:flex;gap:10px}}
.dp .dty{{display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;color:#fff}}
.dp .dc{{font-size:12px;line-height:1.5;color:#555;max-height:60px;overflow-y:auto}}
.dp .dtg{{margin-top:4px;display:flex;gap:3px;flex-wrap:wrap}}
.dp .dtg span{{padding:1px 6px;border-radius:6px;background:#f0f0f0;font-size:10px;color:#666}}
.tp{{position:absolute;background:rgba(44,62,80,.92);color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;pointer-events:none;z-index:30;white-space:nowrap;display:none}}
</style>
</head>
<body>
<div class="hdr"><h1>📚 律师助手 <span style="font-weight:400;font-size:13px;opacity:.8">知识图谱</span></h1><div class="info" id="hdrInfo"></div></div>
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
<div class="dp" id="dp"><button class="dx" onclick="cD()">✕</button><div class="dt" id="dt"></div><div class="dm"><span class="dty" id="dty"></span><span id="dsrc"></span><span id="dusage"></span></div><div class="dc" id="dc"></div><div class="dtg" id="dtg"></div></div>
<div class="tp" id="tp"></div>
</div>
</div>
<script>
const NODES = {nj};
const EDGES = {ej};
const STATS = {sj};
const DB_NAMES = {dj};
const COLORS = {{law:"#3498db",case:"#e67e22",term:"#27ae60",template:"#9b59b6",personal_note:"#e74c3c"}};
const LABELS = {{law:"法条",case:"判例",term:"术语",template:"模板",personal_note:"个人笔记"}};
document.getElementById('hdrInfo').textContent = DB_NAMES.join(' + ');
const sg = document.getElementById('stats');
sg.innerHTML = Object.entries(STATS).map(([k,v])=>'<div class="sc"><div class="n">'+v+'</div><div class="l">'+(LABELS[k]||k)+'</div></div>').join('');
let af = {{}}; Object.keys(LABELS).forEach(k=>af[k]=true);
const ft = document.getElementById('filters');
ft.innerHTML = '<span class="on" onclick="tf(\\'all\\')">全部</span>'+Object.entries(LABELS).map(([k,v],i)=>'<span class="on" onclick="tf(\\''+k+'\\')">'+['📖','⚖️','📝','📋','📓'][i]+' '+v+'</span>').join('');
const nodeMap = {{}}; NODES.forEach(n=>nodeMap[n.id]=n);
let timer = null;
function tf(t){{if(t==='all'){{const a=!document.querySelector('.ft span').classList.contains('on');document.querySelectorAll('.ft span').forEach(s=>s.classList.toggle('on',a));Object.keys(af).forEach(k=>af[k]=a)}}else{{af[t]=!af[t];document.querySelector('.ft span').classList.remove('on');event.target.classList.toggle('on')}}updateView()}}
function gf(){{const q=document.getElementById('search').value.toLowerCase();return NODES.filter(n=>af[n.type]&&(!q||n.label.toLowerCase().includes(q)||(n.ref||'').includes(q)))}}
function rG(items,edges){{const svg=document.querySelector('#cy svg')||function(){{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('width','100%');s.setAttribute('height','100%');s.style.cssText='position:absolute;top:0;left:0';document.getElementById('cy').appendChild(s);return s}}();const eg=svg.querySelector('g')||function(){{const g=document.createElementNS('http://www.w3.org/2000/svg','g');svg.appendChild(g);return g}}();const ng=svg.querySelector('g:last-child')||function(){{const g=document.createElementNS('http://www.w3.org/2000/svg','g');svg.appendChild(g);return g}}();const ids=new Set(items.map(n=>n.id));const fEdges=edges.filter(e=>ids.has(e.src)&&ids.has(e.tgt));let nodes=items.map(n=>({{...n,x:Math.random()*800,y:Math.random()*500,vx:0,vy:0}}));let nm={{}};nodes.forEach(n=>nm[n.id]=n)}});
let anim=null;
function step(){{const w=document.getElementById('cy').clientWidth||800,h=document.getElementById('cy').clientHeight||500,cx=w/2,cy=h/2;for(const n of nodes){{n.vx+=(cx-n.x)*.001;n.vy+=(cy-n.y)*.001;for(const o of nodes){{if(o.id===n.id)continue;const dx=n.x-o.x,dy=n.y-o.y,dist=Math.sqrt(dx*dx+dy*dy)||1,f=2000/(dist*dist);n.vx+=dx/dist*f;n.vy+=dy/dist*f}}}}for(const e of fEdges){{const s=nm[e.src],t=nm[e.tgt];if(!s||!t)continue;const dx=t.x-s.x,dy=t.y-s.y,dist=Math.sqrt(dx*dx+dy*dy)||1,f=(dist-120)*.005;const fx=dx/dist*f,fy=dy/dist*f;s.vx+=fx;s.vy+=fy;t.vx-=fx;t.vy-=fy}}for(const n of nodes){{n.vx*=.85;n.vy*=.85;const sp=Math.sqrt(n.vx*n.vx+n.vy*n.vy);if(sp>3){{n.vx*=3/sp;n.vy*=3/sp}}n.x+=n.vx;n.y+=n.vy;n.x=Math.max(20,Math.min(w-20,n.x));n.y=Math.max(20,Math.min(h-20,n.y))}}eg.innerHTML=fEdges.map(e=>{{const s=nm[e.src],t=nm[e.tgt];if(!s||!t)return'';const st=e.style==='solid'?'stroke:#e74c3c;stroke-width:1.5':'stroke:#bdc3c7;stroke-width:1;stroke-dasharray:4,3';return'<line x1="'+s.x+'" y1="'+s.y+'" x2="'+t.x+'" y2="'+t.y+'" style="'+st+';opacity:.5"/>'}}).join('');ng.innerHTML=nodes.map(n=>'<circle cx="'+n.x+'" cy="'+n.y+'" r="'+Math.min(8+n.usage*.5,20)+'" fill="'+n.color+'" stroke="#fff" stroke-width="1.5" style="cursor:pointer" onclick="sD(\\''+n.id+'\\')" onmouseover="shT(\\''+n.label+'\\',event)" onmouseout="hT()"/>').join('');if(nodes.some(n=>Math.abs(n.vx)>.1||Math.abs(n.vy)>.1))anim=requestAnimationFrame(step)}}
step();
}}
function updateView(){{const f=gf();rG(f,EDGES);document.getElementById('nc').textContent='(显示 '+f.length+' 条)';document.getElementById('nl').innerHTML=f.map(n=>'<div class="ni" onclick="sD(\\''+n.id+'\\')"><span class="dot" style="background:'+n.color+'"></span><span class="nm">'+n.label+'</span><span class="nt">'+(LABELS[n.type]||n.type)+'</span></div>').join('')}}
function sD(id){{const n=NODES.find(x=>x.id===id);if(!n)return;document.getElementById('dt').textContent=n.label;const d=document.getElementById('dty');d.textContent=LABELS[n.type]||n.type;d.style.background=COLORS[n.type]||'#95a5a6';document.getElementById('dsrc').textContent=n.src==='seed'?'📚 公共知识库':'📓 个人知识库';document.getElementById('dusage').textContent='使用 '+n.usage+' 次';document.getElementById('dc').textContent=n.content||'(无详细内容)';document.getElementById('dtg').innerHTML=(n.tags||[]).map(t=>'<span>'+t+'</span>').join('');document.getElementById('dp').classList.add('sh')}}
function cD(){{document.getElementById('dp').classList.remove('sh')}}
function shT(t,e){{const tp=document.getElementById('tp');tp.textContent=t;tp.style.display='block';const r=document.querySelector('.ga').getBoundingClientRect();tp.style.left=(e.clientX-r.left+10)+'px';tp.style.top=(e.clientY-r.top-20)+'px'}}
function hT(){{document.getElementById('tp').style.display='none'}}
document.getElementById('legend').innerHTML=Object.entries(COLORS).map(([k,v]) => '<div><span class="ld" style="background:'+v+'"></span> '+(LABELS[k]||k)+'</div>').join('');
updateView();
</script>
</body>
</html>'''

if __name__ == '__main__':
    main()
