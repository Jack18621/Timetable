/* app.js - Static SPA prototype
 * - Upload a PDF
 * - Split 'Questions' vs 'Mark Scheme'
 * - Split into Qn. blocks
 * - Render current question pages with overlays
 * - Tools: text, checkbox, match (connect anchors)
 * - Marking: compare to simple parsed mark scheme bullets/options; manual override
 */

const state = {
  pdf: null,
  doc: null,
  pageCount: 0,
  msStartPage: null,
  questions: [], // [{q:1, start:{page,y}, end:{page,yExclusive}, pages:[...] }]
  currentIndex: 0,
  tool: 'select',
  overlaysByQ: new Map(), // q -> [{type, page, x,y, data...}]
  markScheme: new Map(), // q -> { bullets:[], correctOption:null, numericAnswers:[], keywords:[] }
};

// Utility
function el(q){ return document.querySelector(q); }
function make(tag, cls){ const e = document.createElement(tag); if(cls) e.className = cls; return e; }

// Load handlers
el('#loadBtn').addEventListener('click', async () => {
  const file = el('#pdfFile').files?.[0];
  if(!file){ alert('Choose a PDF first'); return; }
  await loadPDF(file);
});

// Tool buttons
document.querySelectorAll('.tools button[data-tool]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    state.tool = btn.dataset.tool;
    document.querySelectorAll('.tools button').forEach(b=>b.classList.toggle('active', b===btn));
  });
});
el('#clearOverlays').addEventListener('click',()=>{
  const q = currentQNumber();
  state.overlaysByQ.set(q, []);
  renderCurrentQuestion();
});

// Nav
el('#prevQ').addEventListener('click',()=>{ if(state.currentIndex>0){ state.currentIndex--; renderCurrentQuestion(); } });
el('#nextQ').addEventListener('click',()=>{ if(state.currentIndex<state.questions.length-1){ state.currentIndex++; renderCurrentQuestion(); } });

// Marking
el('#markBtn').addEventListener('click',()=>{
  const q = currentQNumber();
  const res = markQuestion(q);
  el('#markResult').innerHTML = res.html;
});

function currentQNumber(){
  return state.questions[state.currentIndex]?.q ?? null;
}

// Load and parse PDF
async function loadPDF(file){
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const doc = await loadingTask.promise;
  state.doc = doc;
  state.pageCount = doc.numPages;

  // Detect mark scheme start page
  state.msStartPage = await findMarkSchemeStart(doc);

  // Build question index (before mark scheme pages)
  state.questions = await extractQuestions(doc, 1, (state.msStartPage ?? state.pageCount+1) - 1);

  // Parse mark scheme (basic bullets/options)
  state.markScheme = await parseMarkScheme(doc, state.msStartPage ?? (state.pageCount+1), state.pageCount);

  // Populate sidebar
  const qList = el('#questionList');
  qList.innerHTML = '';
  state.questions.forEach((qobj, idx)=>{
    const b = make('button'); b.textContent = `Q${qobj.q} (${qobj.pages.length} page${qobj.pages.length>1?'s':''})`;
    b.addEventListener('click',()=>{ state.currentIndex = idx; renderCurrentQuestion(); });
    qList.appendChild(b);
  });

  // Mark scheme panel preview
  const msPanel = el('#markSchemePanel');
  if(state.markScheme.size){
    msPanel.innerHTML = '';
    for(const [q, obj] of state.markScheme.entries()){
      const div = make('div','msBlock');
      div.innerHTML = `<strong>Q${q}</strong><br>${(obj?.bullets||[]).map(x=>`• ${escapeHtml(x)}`).join('<br>') || '<em>(no bullets parsed)</em>'}
        ${obj.correctOption? `<br><small>Correct option: ${obj.correctOption}</small>`:''}`;
      msPanel.appendChild(div);
    }
  }else{
    msPanel.innerHTML = '<em>No mark scheme text parsed (pages might be images). Use manual override.</em>';
  }

  // Show first question
  state.currentIndex = 0;
  renderCurrentQuestion();
}

async function findMarkSchemeStart(doc){
  for(let p=1;p<=doc.numPages;p++){
    const page = await doc.getPage(p);
    const text = await page.getTextContent();
    const content = text.items.map(it=>it.str).join(' ').toLowerCase();
    if(content.includes('mark scheme')){
      return p;
    }
  }
  return null;
}

// Extract Q heading positions and ranges
async function extractQuestions(doc, startPage, endPage){
  const hits = []; // [{q,page,y}]
  for(let p=startPage; p<=endPage; p++){
    const page = await doc.getPage(p);
    const text = await page.getTextContent();
    for(const it of text.items){
      const m = it.str.match(/^Q(\d+)\.\s*$/i) || it.str.match(/^(Q\d+)\.\s*/i);
      if(m){
        const qnum = parseInt(m[1] || m[0].replace(/[^\d]/g,''),10);
        // y coordinate from transform (ty in text matrix)
        const y = it.transform[5]; // text baseline y
        hits.push({ q:qnum, page:p, y });
      }
    }
  }
  // Sort by page then y descending (PDF y increases upward)
  hits.sort((a,b)=> a.page===b.page ? b.y - a.y : a.page - b.page);
  // Build ranges
  const questions = [];
  for(let i=0;i<hits.length;i++){
    const curr = hits[i];
    const next = hits[i+1];
    const end = next ? { page: next.page, y: next.y } : { page: endPage, y: -Infinity };
    const pages = [];
    // Pages between curr.page and end.page inclusive
    for(let p=curr.page; p<= (next? next.page : endPage); p++){
      pages.push(p);
    }
    questions.push({ q: curr.q, start: {page: curr.page, y: curr.y}, end, pages });
  }
  // Deduplicate q numbers in case of formatting issues
  const uniqMap = new Map();
  for(const q of questions){
    if(!uniqMap.has(q.q)) uniqMap.set(q.q, q);
  }
  return Array.from(uniqMap.values());
}

// Parse mark scheme (basic): gather bullets per Q; detect A/B/C/D answer lines if present
async function parseMarkScheme(doc, startPage, endPage){
  const map = new Map();
  if(!startPage || startPage > endPage) return map;

  // Simple pass: split text into blocks keyed by Qn.
  let buffer = '';
  for(let p=startPage; p<=endPage; p++){
    const page = await doc.getPage(p);
    const text = await page.getTextContent();
    buffer += '\n' + text.items.map(it=>it.str).join('\n');
  }
  const blocks = buffer.split(/\n(?=Q\d+\.\s)/i);
  for(const blk of blocks){
    const m = blk.match(/Q(\d+)\./i);
    if(!m) continue;
    const q = parseInt(m[1],10);
    const bullets = (blk.match(/^[\-\u2022•]\s+.+$/gm) || []).map(s=>s.replace(/^[\-\u2022•]\s+/,'').trim());
    // Try to detect correct option “A/B/C/D” within mark scheme
    let correctOption = null;
    const optm = blk.match(/Correct\s+answer\s*:\s*([ABCD])/i) || blk.match(/\b\(?(A|B|C|D)\)?\s*is\s*correct\b/i);
    if(optm) correctOption = optm[1].toUpperCase();
    map.set(q, { bullets, correctOption });
  }
  return map;
}

async function renderCurrentQuestion(){
  const qobj = state.questions[state.currentIndex];
  if(!qobj){ return; }
  el('#currentQ').textContent = `Q${qobj.q}`;
  const container = el('#pagesContainer');
  container.innerHTML = '';
  const overlays = state.overlaysByQ.get(qobj.q) || [];
  // Render pages
  for(const p of qobj.pages){
    const page = await state.doc.getPage(p);
    const viewport = page.getViewport({ scale: 1.3 });
    const pageDiv = make('div','page');
    const wrap = make('div','canvasWrapper');
    const canvas = make('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);
    const overlay = make('div','overlay'); overlay.style.width = viewport.width+'px'; overlay.style.height = viewport.height+'px';
    const matchLayer = make('svg','matchLayer'); matchLayer.setAttribute('width', viewport.width); matchLayer.setAttribute('height', viewport.height);
    wrap.appendChild(overlay);
    wrap.appendChild(matchLayer);
    pageDiv.appendChild(wrap);
    container.appendChild(pageDiv);
    // Render PDF
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Highlight question start/end on first/last page
    if(p === qobj.start.page){
      const hl = make('div','questionHighlight'); hl.style.position='absolute'; hl.style.left='0'; hl.style.right='0';
      hl.style.top = Math.max(viewport.height - qobj.start.y*1.3 - 20, 0) + 'px'; // rough mapping; pdfjs coords -> viewport mapping is approximate here
      hl.style.height = '12px'; overlay.appendChild(hl);
    }
    // Repaint overlays belonging to this page
    overlays.filter(w => w.page === p).forEach(w => addWidgetToOverlay(overlay, matchLayer, w, viewport));
    // Pointer for adding new widgets
    overlay.addEventListener('pointerdown',(ev)=>{
      if(state.tool === 'select') return;
      const rect = overlay.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const widget = createWidget(state.tool, p, x, y);
      overlays.push(widget);
      state.overlaysByQ.set(qobj.q, overlays);
      addWidgetToOverlay(overlay, matchLayer, widget, viewport);
    });
  }
}

// Widgets
function createWidget(tool, page, x, y){
  if(tool === 'text'){
    return { type:'text', page, x, y, w: 280, h: 80, value:'' };
  }
  if(tool === 'checkbox'){
    return { type:'checkbox', page, x, y, options:['A','B','C','D'], selected:null };
  }
  if(tool === 'match'){
    // Place an anchor; lines are drawn by connecting pairs of anchors later
    return { type:'anchor', page, x, y, id: crypto.randomUUID() };
  }
  return { type:'unknown', page, x, y };
}

function addWidgetToOverlay(overlay, matchLayer, w, viewport){
  if(w.type === 'text'){
    const d = make('div','widget'); d.style.left = (w.x - w.w/2)+'px'; d.style.top = (w.y - 12)+'px';
    d.style.width = w.w+'px'; d.style.height = w.h+'px';
    const ta = make('textarea'); ta.value = w.value || ''; ta.addEventListener('input',()=> w.value = ta.value);
    d.appendChild(ta);
    enableDrag(d, w);
    overlay.appendChild(d);
  } else if(w.type === 'checkbox'){
    const d = make('div','widget'); d.style.left = (w.x - 40)+'px'; d.style.top = (w.y - 20)+'px';
    const box = make('div','chk');
    (w.options||['A','B','C','D']).forEach(opt=>{
      const label = make('label');
      const inp = document.createElement('input'); inp.type='radio'; inp.name = 'opt-'+Math.random().toString(36).slice(2);
      inp.checked = (w.selected === opt);
      inp.addEventListener('change',()=> w.selected = opt);
      label.appendChild(inp);
      label.appendChild(document.createTextNode(' '+opt));
      box.appendChild(label);
    });
    d.appendChild(box); enableDrag(d, w); overlay.appendChild(d);
  } else if(w.type === 'anchor'){
    const a = make('div','anchor'); a.style.left = w.x+'px'; a.style.top = w.y+'px'; a.title = 'Click two anchors to connect';
    a.addEventListener('click',()=> onAnchorClick(matchLayer, w));
    overlay.appendChild(a);
  }
}

let pendingAnchor = null;
function onAnchorClick(matchLayer, w){
  if(!pendingAnchor){ pendingAnchor = w; return; }
  if(pendingAnchor && pendingAnchor !== w){
    // Draw a line
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', pendingAnchor.x);
    line.setAttribute('y1', pendingAnchor.y);
    line.setAttribute('x2', w.x);
    line.setAttribute('y2', w.y);
    line.setAttribute('stroke', '#ffd166');
    line.setAttribute('stroke-width', '3');
    matchLayer.appendChild(line);
    // store link
    if(!pendingAnchor.links) pendingAnchor.links = [];
    if(!w.links) w.links = [];
    pendingAnchor.links.push(w.id);
    w.links.push(pendingAnchor.id);
    pendingAnchor = null;
  }
}

function enableDrag(dom, w){
  let dragging = false, sx=0, sy=0, ox=0, oy=0;
  dom.addEventListener('pointerdown', (ev)=>{
    dragging = true; sx = ev.clientX; sy = ev.clientY; ox = w.x; oy = w.y; dom.setPointerCapture(ev.pointerId);
  });
  dom.addEventListener('pointermove', (ev)=>{
    if(!dragging) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    w.x = ox + dx; w.y = oy + dy;
    dom.style.left = (w.x - dom.offsetWidth/2)+'px';
    dom.style.top = (w.y - 12)+'px';
  });
  dom.addEventListener('pointerup', (ev)=> dragging = false);
}

// Marking engine
function markQuestion(qnum){
  const overlays = state.overlaysByQ.get(qnum) || [];
  const ms = state.markScheme.get(qnum) || { bullets:[], correctOption:null };
  let total = 0, awarded = 0;
  const logs = [];

  // Multiple choice widgets
  const radios = overlays.filter(w=> w.type==='checkbox');
  if(radios.length){
    total += 1;
    const got = radios.some(w=> w.selected && ms.correctOption && w.selected.toUpperCase() === ms.correctOption.toUpperCase());
    awarded += got ? 1 : 0;
    logs.push(`MCQ: selected = ${radios.map(r=>r.selected||'-').join('/')} — expected ${ms.correctOption||'?' } → ${got?'✓':'✗'}`);
  }

  // Text widgets vs simple keyword bullets
  const texts = overlays.filter(w=> w.type==='text');
  const answerText = texts.map(t=> t.value).join(' ').toLowerCase();
  const keywords = (ms.bullets||[]).map(b=> b.toLowerCase()).filter(b=> b.length>0);
  // naive: count bullet keywords that appear at least once (cap at, say, 6 for safety)
  let count = 0;
  for(const kw of keywords.slice(0,6)){
    // Use simple token containment; allow partial split by semicolons/commas
    const parts = kw.split(/[;:,/]/).map(s=>s.trim()).filter(Boolean);
    const hit = parts.some(p => p.length>2 && answerText.includes(p));
    if(hit){ count++; }
  }
  if(keywords.length){
    // Assume up to min( keywords, 6 ) marks available here; scale to 3 by default
    const avail = Math.min(keywords.length, 6);
    const scaled = Math.min(count, 3); // conservative cap
    total += 3;
    awarded += scaled;
    logs.push(`Keywords: matched ${count}/${avail} → awarded ${scaled}/3`);
  }

  // Manual override UI
  const html = `<div><strong>Auto-mark (rule-based): ${awarded}/${total}</strong></div>
    <div style="margin-top:6px">${logs.map(l=>`<div>• ${escapeHtml(l)}</div>`).join('')}</div>
    <hr>
    <div><strong>Manual override</strong></div>
    <div>Set final mark: <input type="number" id="overrideMark" min="0" step="1" value="${awarded}"> / <input type="number" id="overrideTotal" min="0" step="1" value="${total}"></div>
    <div style="margin-top:6px"><button id="applyOverride">Apply</button></div>`;
  setTimeout(()=>{
    const btn = document.getElementById('applyOverride');
    btn?.addEventListener('click',()=>{
      const fm = parseInt(document.getElementById('overrideMark').value,10);
      const ft = parseInt(document.getElementById('overrideTotal').value,10);
      el('#markResult').innerHTML = `<div><strong>Final mark set: ${fm}/${ft}</strong></div>`;
    });
  },0);

  return { html };
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
