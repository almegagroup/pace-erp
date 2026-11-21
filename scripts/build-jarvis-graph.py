#!/usr/bin/env python3
"""Build graphify-out/jarvis.html - the ERP code graph as a Jarvis / Ultron style holographic HUD.

Reads graphify-out/graph.json (the real code graph), lays the files out on concentric rings
(DB tables -> core pipeline -> backend domains -> frontend), and writes ONE self-contained HTML file (no external libraries).
Run through scripts/update-codemap.sh, which refreshes the graph first.
"""
import collections
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
GRAPH = ROOT / "graphify-out" / "graph.json"
OUT = ROOT / "graphify-out" / "jarvis.html"
SKIP = ("scripts/vendor", "node_modules", "tmp/", "output/", "outputs/", "graphify-out", ".worktrees")
DEP = {"calls", "imports", "imports_from", "indirect_call", "references"}
DBREL = {"reads_from", "writes_to"}
TABLE_RE = re.compile(r"^erp_\w+\.\w+$")


def classify(path: str):
    """-> (ring, domain) or None"""
    p = path.split("/")
    if any(s in path for s in SKIP) or not path:
        return None
    if path.startswith("supabase/functions/api/_core/") and len(p) > 5:
        return (2, "api/" + p[4])
    if path.startswith("supabase/functions/api/") and len(p) > 4 and p[3] in ("_shared", "_pipeline", "_acl", "_routes", "_lib"):
        return (1, "core/" + p[3].lstrip("_"))
    if path.startswith("frontend/src/pages/dashboard/") and len(p) > 5:
        return (3, "ui/" + p[4])
    if path.startswith("frontend/src/admin/sa"):
        return (3, "ui/SA-admin")
    if path.startswith("frontend/src/") and len(p) > 3 and p[2] in ("components", "hooks", "layout", "shared", "store", "navigation", "context"):
        return (3, "ui/kit")
    return None


def main() -> int:
    if not GRAPH.exists():
        print("graph.json missing - run graphify update .", file=sys.stderr)
        return 1
    g = json.loads(GRAPH.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in g["nodes"]}
    links = g.get("links") or g.get("edges") or []
    file_of = {i: (n.get("source_file") or "") for i, n in nodes.items()}

    items = {}  # key -> dict(label, ring, dom, kind, path)
    for f in sorted({v for v in file_of.values() if v}):
        c = classify(f)
        if c:
            items[f] = {"l": Path(f).name, "ring": c[0], "dom": c[1], "k": "f", "p": f}
    table_ids = {}
    for i, n in nodes.items():
        if TABLE_RE.match(n["label"]) and (n.get("source_file") or "").endswith(".sql"):
            key = "db:" + n["label"]
            table_ids[i] = key
            items.setdefault(key, {"l": n["label"], "ring": 0, "dom": "db/" + n["label"].split(".")[0], "k": "t", "p": n.get("source_file", "")})

    edges = collections.Counter()
    for e in links:
        s, t, r = e.get("source"), e.get("target"), e.get("relation")
        if s not in nodes or t not in nodes:
            continue
        a = file_of[s]
        if r in DEP:
            b = file_of[t]
            if a != b and a in items and b in items:
                edges[(a, b)] += 1
        elif r in DBREL and t in table_ids and a in items:
            edges[(a, table_ids[t])] += 1

    # drop isolated items, keep the picture honest and light
    deg = collections.Counter()
    for (a, b) in edges:
        deg[a] += 1
        deg[b] += 1
    keys = [k for k in items if deg[k] > 0]
    idx = {k: i for i, k in enumerate(keys)}
    n = len(keys)

    # ---- layout: concentric rings, one sector per domain, then force relaxation ----
    ring_r = {0: 150.0, 1: 300.0, 2: 470.0, 3: 660.0}
    doms = collections.OrderedDict()
    for k in sorted(keys, key=lambda k: (items[k]["ring"], items[k]["dom"], k)):
        doms.setdefault((items[k]["ring"], items[k]["dom"]), []).append(k)
    anchor = {}
    for ring in range(4):
        ds = [d for d in doms if d[0] == ring]
        total = sum(len(doms[d]) for d in ds) or 1
        a0 = -math.pi / 2 + ring * 0.35
        for d in ds:
            span = 2 * math.pi * len(doms[d]) / total
            mid = a0 + span / 2
            anchor[d] = (ring_r[ring] * math.cos(mid), ring_r[ring] * math.sin(mid), span)
            a0 += span
    rng = np.random.default_rng(7)
    pos = np.zeros((n, 2))
    home = np.zeros((n, 2))
    for k in keys:
        d = (items[k]["ring"], items[k]["dom"])
        ax, ay, span = anchor[d]
        r = ring_r[items[k]["ring"]]
        ang = math.atan2(ay, ax) + (rng.random() - 0.5) * span * 0.9
        rr = r + (rng.random() - 0.5) * 70
        pos[idx[k]] = (rr * math.cos(ang), rr * math.sin(ang))
        home[idx[k]] = (ax, ay)
    E = np.array([(idx[a], idx[b]) for (a, b) in edges if a in idx and b in idx], dtype=np.int32)
    ring_arr = np.array([items[k]["ring"] for k in keys])
    target_r = np.array([ring_r[x] for x in ring_arr])
    for it in range(220):
        t = 1.0 - it / 220
        delta = pos[:, None, :] - pos[None, :, :]
        dist2 = (delta ** 2).sum(-1) + 40.0
        force = (delta / dist2[..., None]).sum(1) * 70.0
        if len(E):
            d = pos[E[:, 1]] - pos[E[:, 0]]
            dl = np.linalg.norm(d, axis=1, keepdims=True) + 1e-6
            f = d / dl * np.minimum(dl, 120.0) * 0.004
            np.add.at(force, E[:, 0], f)
            np.add.at(force, E[:, 1], -f)
        force += (home - pos) * 0.04
        rad = np.linalg.norm(pos, axis=1, keepdims=True) + 1e-6
        force += (target_r[:, None] - rad) * pos / rad * 0.30
        step = np.clip(force, -8, 8) * (0.4 + 0.6 * t)
        pos += step
    pos -= pos.mean(0) * 0.0

    palette = ["#00e5ff", "#ff8a00", "#7cff6b", "#ff3d8b", "#b388ff", "#ffe14d", "#4dffb8", "#ff6e6e", "#5ea3ff", "#f09bff"]
    dom_names = sorted({items[k]["dom"] for k in keys})
    color = {d: palette[i % len(palette)] for i, d in enumerate(dom_names)}
    node_json = [
        {"l": items[k]["l"], "d": items[k]["dom"], "t": items[k]["k"], "p": items[k]["p"], "x": round(float(pos[idx[k], 0]), 1),
         "y": round(float(pos[idx[k], 1]), 1), "g": deg[k], "c": color[items[k]["dom"]]}
        for k in keys
    ]
    edge_json = [[idx[a], idx[b], w] for (a, b), w in edges.items() if a in idx and b in idx]
    dom_json = [{"n": d, "c": color[d], "k": sum(1 for k in keys if items[k]["dom"] == d)} for d in dom_names]
    data = {"nodes": node_json, "edges": edge_json, "doms": dom_json, "commit": (g.get("built_at_commit") or "")[:8],
            "symbols": len(nodes), "links": len(links)}
    html = TEMPLATE.replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")))
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(html)/1024:.0f} KB): {n} nodes, {len(edge_json)} links, {len(dom_json)} sectors")
    return 0


TEMPLATE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>P.A.C.E. ERP - Neural Map</title>
<style>
:root{--c:#00e5ff;--o:#ff8a00;--bg:#02070d;--dim:#4a7a8a}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--c);font:12px/1.45 "Consolas","SF Mono",monospace;overflow:hidden}
canvas{position:fixed;inset:0;width:100%;height:100%}
.scan{position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,229,255,.035) 0 1px,transparent 1px 3px);mix-blend-mode:screen}
.vig{position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.75))}
.panel{position:fixed;border:1px solid rgba(0,229,255,.35);background:rgba(2,14,22,.72);backdrop-filter:blur(3px);padding:10px 12px;box-shadow:0 0 18px rgba(0,229,255,.15) inset,0 0 12px rgba(0,229,255,.12)}
.panel:before,.panel:after{content:"";position:absolute;width:10px;height:10px;border:2px solid var(--c)}
.panel:before{left:-2px;top:-2px;border-right:0;border-bottom:0}.panel:after{right:-2px;bottom:-2px;border-left:0;border-top:0}
#title{left:16px;top:14px;min-width:290px}#title h1{margin:0;font-size:17px;letter-spacing:.32em;color:#fff;text-shadow:0 0 10px var(--c)}
#title small{color:var(--dim);letter-spacing:.14em}.row{display:flex;justify-content:space-between;gap:18px}.row b{color:#fff}
#legend{left:16px;top:196px;width:290px;max-height:calc(100vh - 372px);overflow:auto}#legend h3,#info h3,#log h3{margin:0 0 6px;font-size:11px;letter-spacing:.25em;color:var(--o)}
.dom{display:flex;align-items:center;gap:8px;padding:2px 4px;cursor:pointer;border-left:2px solid transparent}.dom:hover,.dom.on{background:rgba(0,229,255,.1);border-left-color:var(--c)}
.dom i{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 8px currentColor}.dom span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dom em{color:var(--dim);font-style:normal}
#info{right:16px;top:14px;width:330px;max-height:calc(100vh - 140px);overflow:auto}#info .path{color:#fff;word-break:break-all}#info ul{margin:4px 0 8px;padding-left:16px;color:#9fe9f5}#info li{cursor:pointer}#info li:hover{color:var(--o)}
#log{left:16px;bottom:14px;width:290px;height:150px;overflow:hidden}#log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#search{position:fixed;left:50%;transform:translateX(-50%);top:14px;width:380px;background:rgba(2,14,22,.8);border:1px solid rgba(0,229,255,.5);color:#fff;padding:8px 12px;font:inherit;letter-spacing:.08em;outline:none;box-shadow:0 0 14px rgba(0,229,255,.25)}
#search::placeholder{color:var(--dim)}#hint{position:fixed;right:16px;bottom:14px;color:var(--dim);text-align:right}
#tip{position:fixed;pointer-events:none;display:none;background:rgba(2,14,22,.92);border:1px solid var(--o);color:#fff;padding:4px 8px;z-index:9}
.blink{animation:bl 1.1s steps(2) infinite}@keyframes bl{50%{opacity:.2}}
@media(max-width:900px){#legend,#log,#hint{display:none}#info{width:60%}#search{width:46%}}
</style></head><body>
<canvas id="bg"></canvas><canvas id="fg"></canvas><div class="scan"></div><div class="vig"></div>
<input id="search" placeholder="> SEARCH FILE / TABLE / DOMAIN ..." autocomplete="off">
<div id="title" class="panel"><h1>P.A.C.E. <span class="blink">▮</span></h1><small>ERP NEURAL CODE MAP</small>
 <div style="margin-top:8px"><div class="row"><span>SYSTEM</span><b id="st">ONLINE</b></div><div class="row"><span>NODES</span><b id="sn">0</b></div><div class="row"><span>LINKS</span><b id="se">0</b></div><div class="row"><span>SYMBOLS IN GRAPH</span><b id="ss">0</b></div><div class="row"><span>BUILD</span><b id="sc">-</b></div></div></div>
<div id="legend" class="panel"><h3>SECTORS</h3><div id="doms"></div></div>
<div id="info" class="panel"><h3>TARGET</h3><div id="ibody" style="color:var(--dim)">Click any node to lock on. Rings, centre to rim: DATABASE &rarr; CORE PIPELINE &rarr; BACKEND DOMAINS &rarr; FRONTEND.</div></div>
<div id="log" class="panel"><h3>SYSTEM LOG</h3><div id="logb"></div></div>
<div id="hint">DRAG = pan &nbsp; WHEEL = zoom &nbsp; CLICK = lock target &nbsp; DBL-CLICK = reset</div><div id="tip"></div>
<script>
const D=/*__DATA__*/null;
const bg=document.getElementById('bg'),fg=document.getElementById('fg'),bx=bg.getContext('2d'),fx=fg.getContext('2d');
let W,H,dpr=Math.min(2,devicePixelRatio||1),cam={x:0,y:0,k:.62},fitK=.62,sel=-1,hover=-1,domOn=null,query='';
const N=D.nodes,E=D.edges;const adj=N.map(()=>[]);E.forEach(([a,b])=>{adj[a].push(b);adj[b].push(a)});
const out=N.map(()=>[]),inn=N.map(()=>[]);E.forEach(([a,b])=>{out[a].push(b);inn[b].push(a)});
const sprites={};function sprite(c){if(sprites[c])return sprites[c];const s=document.createElement('canvas');s.width=s.height=64;const x=s.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'#fff');g.addColorStop(.18,c);g.addColorStop(.5,c+'55');g.addColorStop(1,c+'00');x.fillStyle=g;x.fillRect(0,0,64,64);return sprites[c]=s}
function resize(){W=innerWidth;H=innerHeight;const mr=Math.max(...N.map(n=>Math.hypot(n.x,n.y)),1);fitK=Math.min(W,H)/2/(mr*1.08);if(!resize.done){cam.k=fitK;resize.done=1}for(const c of[bg,fg]){c.width=W*dpr;c.height=H*dpr}draw()}
const sx=n=>(n.x-cam.x)*cam.k+W/2,sy=n=>(n.y-cam.y)*cam.k+H/2;
function visible(i){const n=N[i];if(domOn&&n.d!==domOn)return false;if(query&&!(n.l+' '+n.p+' '+n.d).toLowerCase().includes(query))return false;return true}
function draw(){bx.setTransform(dpr,0,0,dpr,0,0);bx.clearRect(0,0,W,H);
 const g=bx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.7);g.addColorStop(0,'#06222e');g.addColorStop(1,'#02070d');bx.fillStyle=g;bx.fillRect(0,0,W,H);
 const cx=(0-cam.x)*cam.k+W/2,cy=(0-cam.y)*cam.k+H/2;bx.strokeStyle='rgba(0,229,255,.16)';bx.lineWidth=1;
 for(const r of[150,300,470,660]){bx.beginPath();bx.arc(cx,cy,r*cam.k,0,7);bx.stroke()}
 bx.setLineDash([2,7]);for(let a=0;a<360;a+=15){const t=a*Math.PI/180;bx.beginPath();bx.moveTo(cx+Math.cos(t)*120*cam.k,cy+Math.sin(t)*120*cam.k);bx.lineTo(cx+Math.cos(t)*760*cam.k,cy+Math.sin(t)*760*cam.k);bx.stroke()}bx.setLineDash([]);
 const lock=sel>=0?new Set([sel,...adj[sel]]):null;
 bx.lineWidth=1;for(const[a,b,w]of E){if(!(visible(a)&&visible(b)))continue;const A=N[a],B=N[b];const hot=lock&&(a===sel||b===sel);if(lock&&!hot)continue;
  bx.strokeStyle=hot?'rgba(255,138,0,.85)':A.d===B.d?A.c+'30':'rgba(120,200,230,.07)';bx.lineWidth=hot?1.4:.6;bx.beginPath();bx.moveTo(sx(A),sy(A));bx.lineTo(sx(B),sy(B));bx.stroke()}
 if(lock){for(const[a,b]of E){if(a===sel||b===sel||!(lock.has(a)&&lock.has(b)))continue;bx.strokeStyle='rgba(0,229,255,.22)';bx.beginPath();bx.moveTo(sx(N[a]),sy(N[a]));bx.lineTo(sx(N[b]),sy(N[b]));bx.stroke()}}
 bx.globalCompositeOperation='lighter';
 N.forEach((n,i)=>{if(!visible(i))return;const dim=lock&&!lock.has(i);const s=(6+Math.min(26,Math.sqrt(n.g)*3.1))*Math.max(.55,cam.k)*(n.t==='t'?1.2:1);bx.globalAlpha=dim?.12:.95;const sp=sprite(n.c);bx.drawImage(sp,sx(n)-s,sy(n)-s,s*2,s*2)});
 bx.globalAlpha=1;bx.globalCompositeOperation='source-over';
 if(cam.k>fitK*2.2){bx.font='10px Consolas,monospace';bx.fillStyle='rgba(200,245,255,.85)';N.forEach((n,i)=>{if(n.g<6||!visible(i)||(lock&&!lock.has(i)))return;bx.fillText(n.l,sx(n)+8,sy(n)-6)})}
 if(sel>=0){const n=N[sel];bx.strokeStyle='#ff8a00';bx.lineWidth=1.6;bx.beginPath();bx.arc(sx(n),sy(n),16,0,7);bx.stroke()}}
let t0=0;function overlay(t){fx.setTransform(dpr,0,0,dpr,0,0);fx.clearRect(0,0,W,H);const cx=(0-cam.x)*cam.k+W/2,cy=(0-cam.y)*cam.k+H/2;
 const a=t/2600;const R=770*cam.k;const g=fx.createConicGradient?fx.createConicGradient(a,cx,cy):null;
 if(g){g.addColorStop(0,'rgba(0,229,255,0)');g.addColorStop(.93,'rgba(0,229,255,0)');g.addColorStop(1,'rgba(0,229,255,.22)');fx.fillStyle=g;fx.beginPath();fx.arc(cx,cy,R,0,7);fx.fill()}
 fx.strokeStyle='rgba(255,138,0,.5)';fx.lineWidth=2;for(let i=0;i<3;i++){fx.beginPath();fx.arc(cx,cy,(105+i*9)*cam.k,a*(i%2?-1:1)+i,a*(i%2?-1:1)+i+1.7);fx.stroke()}
 fx.fillStyle='rgba(0,229,255,.9)';fx.shadowColor='#00e5ff';fx.shadowBlur=18;fx.beginPath();fx.arc(cx,cy,5*Math.max(.7,cam.k),0,7);fx.fill();fx.shadowBlur=0;
 if(hover>=0&&hover!==sel){const n=N[hover];fx.strokeStyle='#fff';fx.lineWidth=1.2;fx.beginPath();fx.arc(sx(n),sy(n),13+Math.sin(t/160)*2,0,7);fx.stroke()}
 requestAnimationFrame(overlay)}
function pick(mx,my){let best=-1,bd=14*14;N.forEach((n,i)=>{if(!visible(i))return;const dx=sx(n)-mx,dy=sy(n)-my,d=dx*dx+dy*dy;if(d<bd){bd=d;best=i}});return best}
function log(m){const l=document.getElementById('logb');const d=document.createElement('div');d.textContent='> '+m;l.appendChild(d);while(l.children.length>8)l.removeChild(l.firstChild)}
function info(i){const n=N[i];const li=a=>'<ul>'+a.slice(0,14).map(j=>`<li data-i="${j}">${N[j].l}</li>`).join('')+(a.length>14?`<li style="color:var(--dim)">+${a.length-14} more</li>`:'')+'</ul>';
 document.getElementById('ibody').innerHTML=`<div style="color:${n.c}">${n.d}</div><div class="path">${n.p||n.l}</div><div class="row"><span>${n.t==='t'?'TABLE':'FILE'}</span><b>${n.l}</b></div><div class="row"><span>CONNECTIONS</span><b>${n.g}</b></div><h3 style="margin-top:8px">USED BY (${inn[i].length})</h3>${li(inn[i])}<h3>USES (${out[i].length})</h3>${li(out[i])}`;
 document.querySelectorAll('#ibody li[data-i]').forEach(e=>e.onclick=()=>{select(+e.dataset.i,true)})}
function select(i,fly){sel=i;if(i>=0){info(i);log('TARGET LOCKED: '+N[i].l);if(fly){cam.x=N[i].x;cam.y=N[i].y;cam.k=Math.max(cam.k,1.3)}}draw()}
let drag=null;fg.addEventListener('mousedown',e=>{drag={x:e.clientX,y:e.clientY,cx:cam.x,cy:cam.y,m:false}});
addEventListener('mouseup',e=>{if(drag&&!drag.m){select(pick(e.clientX,e.clientY))}drag=null});
addEventListener('mousemove',e=>{if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.m=true;if(drag.m){cam.x=drag.cx-dx/cam.k;cam.y=drag.cy-dy/cam.k;draw()}return}
 const h=pick(e.clientX,e.clientY);hover=h;const tip=document.getElementById('tip');if(h>=0){tip.style.display='block';tip.style.left=e.clientX+14+'px';tip.style.top=e.clientY+14+'px';tip.textContent=N[h].l+'  ['+N[h].d+']'}else tip.style.display='none'});
fg.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.15:1/1.15;const wx=(e.clientX-W/2)/cam.k+cam.x,wy=(e.clientY-H/2)/cam.k+cam.y;cam.k=Math.max(fitK*.5,Math.min(8,cam.k*f));cam.x=wx-(e.clientX-W/2)/cam.k;cam.y=wy-(e.clientY-H/2)/cam.k;draw()},{passive:false});
fg.addEventListener('dblclick',()=>{cam={x:0,y:0,k:fitK};sel=-1;domOn=null;query='';document.getElementById('search').value='';document.querySelectorAll('.dom').forEach(x=>x.classList.remove('on'));draw()});
document.getElementById('search').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();if(query){const m=N.findIndex((n,i)=>visible(i));if(m>=0)log('MATCH: '+N[m].l)}draw()});
const dl=document.getElementById('doms');D.doms.forEach(d=>{const e=document.createElement('div');e.className='dom';e.innerHTML=`<i style="background:${d.c};color:${d.c}"></i><span>${d.n}</span><em>${d.k}</em>`;e.onclick=()=>{domOn=domOn===d.n?null:d.n;document.querySelectorAll('.dom').forEach(x=>x.classList.remove('on'));if(domOn)e.classList.add('on');log('SECTOR '+(domOn||'ALL')+' '+(domOn?'ISOLATED':'RESTORED'));draw()};dl.appendChild(e)});
function count(id,v,ms=1100){const el=document.getElementById(id);const s=performance.now();(function f(){const p=Math.max(0,Math.min(1,(performance.now()-s)/ms));el.textContent=Math.round(v*p).toLocaleString();if(p<1)requestAnimationFrame(f)})(s)}
addEventListener('resize',resize);resize();count('sn',N.length);count('se',E.length);count('ss',D.symbols);document.getElementById('sc').textContent=D.commit||'-';
['INITIALISING NEURAL MAP','LOADING '+N.length.toLocaleString()+' NODES','LINKING '+E.length.toLocaleString()+' DEPENDENCIES','ALL SECTORS ONLINE'].forEach((m,i)=>setTimeout(()=>log(m),350*i));
requestAnimationFrame(overlay);
</script></body></html>
"""

if __name__ == "__main__":
    sys.exit(main())
