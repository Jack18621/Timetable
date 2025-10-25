/* index.js — Full UI rebuild (no AI)
 * - Clean layout, tabbed sidebar, top bar, floating tools
 * - PDF.js renderer (expects window.pdfjsLib already loaded)
 * - Question detect, overlays, rule-based marking, manual override
 *
 * Keyboard:
 *   ←/→ : Prev/Next question
 *   Z/X : Zoom out/in
 *   1   : Select/Move
 *   2   : Text box
 *   3   : MCQ (A/B/C/D)
 *   4   : Match anchors
 */

(function () {
  // ---------- Style injection (so you don't need to touch CSS) ----------
  const css = `
  :root{
    --bg:#081e43;--panel:#0b2553;--edge:#103a7a;--ink:#eef3fb;--brand:#0f3a7f;--brand-hi:#1e59a5;--accent:#ffd166;--ok:#00d884;--bad:#ff5b6b;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;overflow:hidden}
  .appbar{height:56px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#092a5e;border-bottom:1px solid var(--edge)}
  .logo{font-weight:800;letter-spacing:.2px}
  .spacer{flex:1}
  .btn{height:34px;padding:0 12px;border:1px solid var(--brand-hi);background:var(--brand);color:#fff;border-radius:8px;cursor:pointer}
  .btn.ghost{background:transparent}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .icon{opacity:.9;margin-right:6px}
  .wrap{display:grid;grid-template-columns:320px 1fr;grid-template-rows:1fr 48px;height:calc(100% - 56px)}
  .sidebar{grid-row:1/3;background:#0e2f66;border-right:1px solid var(--edge);display:flex;flex-direction:column;min-width:300px}
  .tabs{display:flex}
  .tab{flex:1;text-align:center;padding:10px;cursor:pointer;border-bottom:2px solid transparent;font-weight:700}
  .tab.active{border-bottom-color:var(--accent);background:#0c2b5e}
  .sidebody{flex:1;overflow:auto;padding:10px}
  .card{background:var(--panel);border:1px solid var(--edge);border-radius:10px;padding:10px;margin-bottom:10px}
  .qbtn{width:100%;text-align:left;padding:8px;border-radius:8px;border:1px solid var(--brand-hi);background:var(--brand);color:#fff;margin-bottom:6px;cursor:pointer}
  .qbtn.active{outline:2px solid var(--accent)}
  .viewer{position:relative;overflow:hidden}
  .toolbar{position:sticky;top:0;z-index:3;display:flex;gap:8px;align-items:center;background:#0e2f66;border-bottom:1px solid var(--edge);padding:8px}
  .pages{position:absolute;inset:48px 0 0 0; /* below toolbar */ overflow:auto;padding:16px}
  .page{position:relative;display:block;margin:0 auto 16px auto;background:#fff;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.25)}
  .overlay{position:absolute;inset:0;pointer-events:none}
  .widget{position:absolute;border:1px dashed var(--brand-hi);background:rgba(30,89,165,.06);border-radius:6px;pointer-events:auto}
  .widget textarea{width:300px;height:90px;border:1px solid #c9c9c9;border-radius:6px;padding:6px;color:#111}
  .widget .mcq{display:flex;gap:10px;background:#fff;color:#111;padding:6px;border-radius:6px}
  .anchor{position:absolute;width:12px;height:12px;background:var(--accent);border:2px solid #a36a00;border-radius:999px;transform:translate(-50%,-50%);cursor:crosshair;pointer-events:auto}
  .tools{position:absolute;top:64px;right:16px;z-index:4;display:flex;flex-direction:column;gap:8px}
  .tool{min-width:48px;padding:10px;border-radius:10px;background:#0f3a7f;border:1px solid var(--brand-hi);cursor:pointer}
  .tool.active{outline:2px solid var(--accent)}
  .status{grid-column:2/3;display:flex;align-items:center;gap:12px;padding:8px;border-top:1px solid var(--edge);background:#0e2f66}
  .pill{padding:4px 8px;border-radius:999px;background:#0f3a7f;border:1px solid var(--brand-hi);font-size:12px}
  .ms-bullet{font-size:13px;opacity:.9;margin:3px 0}
  .drawer{position:sticky;bottom:0;background:#041532;border:1px solid var(--edge);border-radius:10px;padding:10px}
  .mark-line{display:flex;align-items:center;gap:6px;margin-top:6px}
  .input{height:34px;border-radius:8px;border:1px solid var(--edge);background:#00153a;color:#fff;padding:0 10px}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM scaffold ----------
  document.body.innerHTML = `
    <div class="appbar">
      <div class="logo">GCSE Question Player</div>
      <input type="file" id="pdfFile" accept="application/pdf" class="input">
      <button class="btn" id="loadPdf"><span class="icon">📄</span>Load PDF</button>
      <div class="spacer"></div>
      <button class="btn ghost" id="prevQ">← Prev</button>
      <div id="qLabel" class="pill">Q–</div>
      <button class="btn ghost" id="nextQ">Next →</button>
      <div class="spacer"></div>
      <button class="btn" id="zoomOut">–</button>
      <div id="zoomLabel" class="pill">100%</div>
      <button class="btn" id="zoomIn">+</button>
      <button class="btn ghost" id="fitWidth">Fit width</button>
    </div>
    <div class="wrap">
      <div class="sidebar">
        <div class="tabs">
          <div class="tab active" data-tab="questions">Questions</div>
          <div class="tab" data-tab="marks">Mark Scheme</div>
        </div>
        <div class="sidebody">
          <div class="card" id="questionsCard"><div id="qList"><em>Load a PDF to parse…</em></div></div>
          <div class="card" id="marksCard" style="display:none;">
            <div id="msList"><em>Load a PDF to parse…</em></div>
            <div class="drawer">
              <div style="font-weight:700;margin-bottom:6px;">Manual override</div>
              <div class="mark-line">
                <span>Final mark:</span>
                <input class="input" id="ovMark" type="number" min="0" value="0" style="width:80px">
                <span>/</span>
                <input class="input" id="ovTotal" type="number" min="0" value="0" style="width:80px">
                <button class="btn" id="applyOverride">Apply</button>
              </div>
              <div id="markLog" style="margin-top:8px;font-size:13px;opacity:.9;"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="viewer">
        <div class="toolbar">
          <div class="pill">Tools</div>
          <button class="tool" id="toolSelect" title="1 — Select/Move">🖱️</button>
          <button class="tool" id="toolText" title="2 — Text">✍️</button>
          <button class="tool" id="toolMCQ" title="3 — MCQ">🔘</button>
          <button class="tool" id="toolMatch" title="4 — Match anchors">🧷</button>
          <button class="btn ghost" id="clearOverlays">Clear overlays</button>
          <div class="spacer"></div>
          <button class="btn" id="markBtn">Mark this question</button>
        </div>
        <div class="pages" id="pages"></div>
      </div>

      <div class="status">
        <div class="pill" id="statusInfo">Ready</div>
      </div>
    </div>
  `;

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const isQ = t.dataset.tab === 'questions';
    document.getElementById('questionsCard').style.display = isQ ? '' : 'none';
    document.getElementById('marksCard').style.display = isQ ? 'none' : '';
  }));

  // ---------- State ----------
  const state = {
    doc: null,
    pageCount: 0,
    zoom: 1.25,
    msStart: null,
    questions: [],             // [{q, pages:[...], start:{page,y}, end:{page,y}}]
    currentIdx: 0,
    overlays: new Map(),       // q -> [{type,page,x,y,w,h,value/selected/id/links}]
    markScheme: new Map(),     // q -> { bullets:[], correctOption:null }
    tool: 'select',
    pendingAnchor: null,
  };

  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);
  const make = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };

  function setStatus(msg){ $('#statusInfo').textContent = msg; }
  function setTool(name){
    state.tool = name;
    ['toolSelect','toolText','toolMCQ','toolMatch'].forEach(id => $('#'+id).classList.toggle('active', id.toLowerCase().includes(name)));
    setStatus(`Tool: ${name}`);
  }
  setTool('select');

  // ---------- PDF loading ----------
  $('#loadPdf').addEventListener('click', async () => {
    const f = $('#pdfFile').files?.[0];
    if(!f){ alert('Choose a PDF'); return; }
    const ab = await f.arrayBuffer();
    const loading = window.pdfjsLib.getDocument({ data: ab });
    state.doc = await loading.promise;
    state.pageCount = state.doc.numPages;

    setStatus(`PDF loaded (${state.pageCount} pages)`);
    await detectMarkScheme();
    await detectQuestions();
    buildQuestionList();
    buildMarkSchemeList();
    state.currentIdx = 0;
    renderCurrentQ();
  });

  async function pageText(pageNo){
    const page = await state.doc.getPage(pageNo);
    const text = await page.getTextContent();
    return {page, content: text.items.map(it => it.str), raw: text.items};
  }

  async function detectMarkScheme(){
    state.msStart = null;
    for(let p=1;p<=state.pageCount;p++){
      const {content} = await pageText(p);
      const joined = content.join(' ').toLowerCase();
      if(joined.includes('mark scheme')){
        state.msStart = p; break;
      }
    }
  }

  async function detectQuestions(){
    const endQPage = state.msStart ? state.msStart - 1 : state.pageCount;
    const hits = [];
    for(let p=1; p<=endQPage; p++){
      const {raw} = await pageText(p);
      for(const it of raw){
        const s = (it.str || '').trim();
        const m = s.match(/^Q(\d+)\.\s*$/i) || s.match(/^Q\s*(\d+)\./i);
        if(m){
          hits.push({ q: parseInt(m[1],10), page: p, y: it.transform[5] });
        }
      }
    }
    // sort by page then y (pdf y increases upward)
    hits.sort((a,b)=> a.page===b.page ? b.y - a.y : a.page - b.page);

    const questions = [];
    for(let i=0;i<hits.length;i++){
      const curr = hits[i];
      const next = hits[i+1];
      const lastPage = next ? next.page : endQPage;
      const pages = [];
      for(let p=curr.page; p<=lastPage; p++) pages.push(p);
      // de-duplicate if repeated
      if(!questions.find(x=>x.q===curr.q)){
        questions.push({ q: curr.q, start:{page:curr.page,y:curr.y}, end: next? {page:next.page,y:next.y}: {page:lastPage,y:-Infinity}, pages });
      }
    }
    state.questions = questions;
  }

  // ---------- Sidebar population ----------
  function buildQuestionList(){
    const list = $('#qList');
    list.innerHTML = '';
    if(!state.questions.length){ list.innerHTML = '<em>No questions detected.</em>'; return; }
    state.questions.forEach((q, idx) => {
      const b = make('button','qbtn');
      b.textContent = `Q${q.q} — ${q.pages.length} page${q.pages.length>1?'s':''}`;
      b.addEventListener('click', () => { state.currentIdx = idx; renderCurrentQ(); });
      list.appendChild(b);
    });
  }

  function buildMarkSchemeList(){
    const ms = $('#msList');
    ms.innerHTML = '';
    if(!state.msStart){ ms.innerHTML = '<em>No Mark Scheme section detected.</em>'; return; }

    // simple parse: split text by Qn headings
    const map = new Map();
    // gather mark scheme text
    (async () => {
      let buf = '';
      for(let p=state.msStart; p<=state.pageCount; p++){
        const {content} = await pageText(p);
        buf += '\n' + content.join('\n');
      }
      const blocks = buf.split(/\n(?=Q\d+\.\s)/i);
      for(const blk of blocks){
        const m = blk.match(/Q(\d+)\./i);
        if(!m) continue;
        const qn = parseInt(m[1],10);
        const bullets = (blk.match(/^[\-\u2022•]\s+.+$/gm) || []).map(x=>x.replace(/^[\-\u2022•]\s+/,'').trim());
        let correctOption = null;
        const opt = blk.match(/Correct\s*answer\s*[:\-]\s*([ABCD])/i) || blk.match(/\b([ABCD])\b\s*(?:is|are)\s*correct/i);
        if(opt) correctOption = opt[1].toUpperCase();
        map.set(qn, { bullets, correctOption });
      }
      state.markScheme = map;
      // render sidebar
      for(const [q, obj] of map.entries()){
        const div = make('div','card');
        div.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">Q${q}</div>` +
          (obj.bullets?.length ? obj.bullets.map(b=>`<div class="ms-bullet">• ${escapeHtml(b)}</div>`).join('') : '<em>No bullets parsed.</em>') +
          (obj.correctOption ? `<div style="margin-top:6px" class="pill">MCQ: ${obj.correctOption}</div>` : '');
        ms.appendChild(div);
      }
    })();
  }

  // ---------- Render current question ----------
  $('#prevQ').addEventListener('click', ()=>{ if(state.currentIdx>0){ state.currentIdx--; renderCurrentQ(); }});
  $('#nextQ').addEventListener('click', ()=>{ if(state.currentIdx < state.questions.length-1){ state.currentIdx++; renderCurrentQ(); }});

  $('#zoomIn').addEventListener('click', ()=>{ state.zoom = Math.min(2.0, state.zoom+0.1); renderCurrentQ(); });
  $('#zoomOut').addEventListener('click', ()=>{ state.zoom = Math.max(0.6, state.zoom-0.1); renderCurrentQ(); });
  $('#fitWidth').addEventListener('click', ()=>{ fitWidth(); });

  function fitWidth(){
    const host = $('#pages');
    const pad = 32;
    const w = host.clientWidth - pad;
    // approximate scale to fit A4-ish 595pt width
    state.zoom = Math.max(0.6, Math.min(2.0, w/600));
    renderCurrentQ();
  }

  async function renderCurrentQ(){
    const q = state.questions[state.currentIdx];
    if(!q){ $('#pages').innerHTML = '<div style="padding:16px">No question.</div>'; return; }
    $('#qLabel').textContent = `Q${q.q}`;
    $('#zoomLabel').textContent = Math.round(state.zoom*100)+'%';

    const container = $('#pages');
    container.innerHTML = '';
    const ov = state.overlays.get(q.q) || [];
    state.overlays.set(q.q, ov);

    for(const p of q.pages){
      const page = await state.doc.getPage(p);
      const viewport = page.getViewport({ scale: state.zoom });
      const wrap = make('div','page'); wrap.style.width = viewport.width+'px'; wrap.style.height = viewport.height+'px';
      const canvas = make('canvas'); canvas.width = viewport.width; canvas.height = viewport.height; canvas.style.width='100%'; canvas.style.height='100%';
      wrap.appendChild(canvas);
      const overlay = make('div','overlay'); wrap.appendChild(overlay);
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('class','overlay');
      svg.style.pointerEvents = 'none';
      wrap.appendChild(svg);

      container.appendChild(wrap);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      // place overlays for this page
      ov.filter(w=>w.page===p).forEach(w => mountWidget(overlay, svg, w));

      // pointer to add
      overlay.addEventListener('pointerdown', ev => {
        if(state.tool==='select') return;
        const rect = overlay.getBoundingClientRect();
        const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        const w = createWidget(state.tool, p, x, y);
        ov.push(w); mountWidget(overlay, svg, w);
      });
    }
    setStatus(`Showing Q${q.q} (${q.pages.length} page${q.pages.length>1?'s':''})`);
  }

  // ---------- Widgets ----------
  $('#toolSelect').addEventListener('click', ()=> setTool('select'));
  $('#toolText').addEventListener('click', ()=> setTool('text'));
  $('#toolMCQ').addEventListener('click',  ()=> setTool('mcq'));
  $('#toolMatch').addEventListener('click', ()=> setTool('match'));
  $('#clearOverlays').addEventListener('click', ()=>{
    const qn = state.questions[state.currentIdx]?.q;
    if(!qn) return;
    state.overlays.set(qn, []);
    renderCurrentQ();
  });

  function createWidget(kind, page, x, y){
    if(kind==='text') return { type:'text', page, x, y, w:320, h:96, value:'' };
    if(kind==='mcq')  return { type:'mcq', page, x, y, options:['A','B','C','D'], selected:null, group:'g'+Math.random().toString(36).slice(2) };
    if(kind==='match')return { type:'anchor', page, x, y, id:crypto.randomUUID(), links:[] };
    return { type:'unknown', page, x, y };
  }

  function mountWidget(overlay, svg, w){
    if(w.type==='text'){
      const d = make('div','widget');
      d.style.left = (w.x - (w.w/2))+'px'; d.style.top = (w.y - 14)+'px'; d.style.width = w.w+'px'; d.style.height = w.h+'px';
      const ta = make('textarea'); ta.value = w.value||''; ta.addEventListener('input', ()=> w.value = ta.value);
      d.appendChild(ta);
      enableDrag(d, w);
      overlay.appendChild(d);
    } else if(w.type==='mcq'){
      const d = make('div','widget'); d.style.left = (w.x - 50)+'px'; d.style.top = (w.y - 20)+'px';
      const box = make('div','mcq');
      w.options.forEach(opt=>{
        const label = make('label');
        const inp = document.createElement('input'); inp.type='radio'; inp.name = w.group;
        inp.checked = (w.selected===opt);
        inp.addEventListener('change', ()=> w.selected = opt);
        label.appendChild(inp); label.append(' '+opt);
        box.appendChild(label);
      });
      d.appendChild(box);
      enableDrag(d, w);
      overlay.appendChild(d);
    } else if(w.type==='anchor'){
      const a = make('div','anchor'); a.style.left = w.x+'px'; a.style.top = w.y+'px';
      a.addEventListener('click', ()=> onAnchor(svg, w));
      overlay.appendChild(a);
    }
  }

  function onAnchor(svg, w){
    if(!state.pendingAnchor){ state.pendingAnchor = w; setStatus('Anchor picked — click another to connect.'); return; }
    if(state.pendingAnchor === w){ state.pendingAnchor = null; return; }
    // draw line
    const l = document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1', state.pendingAnchor.x); l.setAttribute('y1', state.pendingAnchor.y);
    l.setAttribute('x2', w.x);                  l.setAttribute('y2', w.y);
    l.setAttribute('stroke', '#ffd166'); l.setAttribute('stroke-width', '3');
    svg.appendChild(l);
    state.pendingAnchor.links.push(w.id); w.links.push(state.pendingAnchor.id);
    state.pendingAnchor = null; setStatus('Anchors connected.');
  }

  function enableDrag(dom, w){
    let on=false, sx=0, sy=0, ox=0, oy=0;
    dom.addEventListener('pointerdown', ev=>{ if(state.tool!=='select')return; on=true; sx=ev.clientX; sy=ev.clientY; ox=w.x; oy=w.y; dom.setPointerCapture(ev.pointerId); });
    dom.addEventListener('pointermove', ev=>{ if(!on)return; const dx=ev.clientX-sx, dy=ev.clientY-sy; w.x=ox+dx; w.y=oy+dy; dom.style.left=(w.x - dom.offsetWidth/2)+'px'; dom.style.top=(w.y - 14)+'px'; });
    dom.addEventListener('pointerup', ()=> on=false);
  }

  // ---------- Marking ----------
  $('#markBtn').addEventListener('click', () => {
    const qn = state.questions[state.currentIdx]?.q; if(!qn) return;
    const overlays = state.overlays.get(qn) || [];
    const ms = state.markScheme.get(qn) || { bullets:[], correctOption:null };
    let total=0, awarded=0; const logs=[];

    // MCQ
    const mcqs = overlays.filter(w=> w.type==='mcq');
    if(mcqs.length){
      total += 1;
      const got = mcqs.some(w=> w.selected && ms.correctOption && w.selected.toUpperCase()===ms.correctOption.toUpperCase());
      awarded += got ? 1 : 0;
      logs.push(`MCQ: selected ${mcqs.map(x=>x.selected||'-').join('/')} vs ${ms.correctOption||'?'} → ${got?'✓':'✗'}`);
    }
    // Text keywords
    const texts = overlays.filter(w=> w.type==='text');
    const tAll = texts.map(t=> (t.value||'').toLowerCase()).join(' ');
    const kws = (ms.bullets||[]).map(b=>b.toLowerCase());
    let hits = 0;
    for(const b of kws.slice(0,6)){
      const parts = b.split(/[;:,/]/).map(s=>s.trim()).filter(Boolean);
      if(parts.some(p=> p.length>2 && tAll.includes(p))) hits++;
    }
    if(kws.length){
      const avail = Math.min(3, kws.length); // conservative default
      const take = Math.min(hits, avail);
      total += avail; awarded += take;
      logs.push(`Keywords matched ${hits}/${kws.length} → +${take}/${avail}`);
    }

    $('#ovMark').value = awarded; $('#ovTotal').value = total;
    $('#markLog').innerHTML = `<div><strong>Auto: ${awarded}/${total}</strong></div>` + logs.map(l=>`<div>• ${escapeHtml(l)}</div>`).join('');
    // switch to Mark Scheme tab to show results clearly
    document.querySelector('.tab[data-tab="marks"]').click();
  });

  $('#applyOverride').addEventListener('click', ()=>{
    const fm = parseInt($('#ovMark').value||'0',10);
    const ft = parseInt($('#ovTotal').value||'0',10);
    $('#markLog').innerHTML = `<div><strong>Final mark set: ${fm}/${ft}</strong></div>` + $('#markLog').innerHTML;
    setStatus(`Final mark stored: ${fm}/${ft}`);
  });

  // ---------- Keyboard shortcuts ----------
  window.addEventListener('keydown', (e)=>{
    if(e.key==='ArrowLeft'){ $('#prevQ').click(); }
    if(e.key==='ArrowRight'){ $('#nextQ').click(); }
    if(e.key.toLowerCase()==='z'){ $('#zoomOut').click(); }
    if(e.key.toLowerCase()==='x'){ $('#zoomIn').click(); }
    if(e.key==='1'){ setTool('select'); }
    if(e.key==='2'){ setTool('text'); }
    if(e.key==='3'){ setTool('mcq'); }
    if(e.key==='4'){ setTool('match'); }
  });

  // ---------- Utils ----------
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
})();
