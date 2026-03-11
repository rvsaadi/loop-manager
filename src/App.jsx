import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { SKUS_RAW } from "./data/skus.js";
import { AUX } from "./data/aux.js";
import { CAT_COLORS, REC_COLORS, CAT_EMOJI, ALL_CATS, fmt, fmtN } from "./data/constants.js";
import { BENCHMARK_DB, BENCHMARK_ITEMS } from "./data/benchmarks.js";
import { IDEAL_SLOTS } from "./data/idealSlots.js";
import { calcScore } from "./engine/score.js";
import { exportToXLSX } from "./engine/export.js";
import { calculateFunnel, FUNNEL_DEFAULTS } from "./engine/funnel.js";
import { buildSystemPrompt } from "./data/prompt.js";
import { KPICard } from "./components/KPICard.jsx";
import { RecBadge } from "./components/RecBadge.jsx";
import { ScoreBar } from "./components/ScoreBar.jsx";
import { ProductRow } from "./components/ProductRow.jsx";
import { CatBar } from "./components/CatBar.jsx";
import { Field } from "./components/Field.jsx";
import AIEvaluator from "./tabs/AIEvaluator.jsx";

export default function LoopApp() {
  const [tab, setTab] = useState("dashboard");
  const [catFilter, setCatFilter] = useState(null);
  const [recFilter, setRecFilter] = useState(null);
  const [priceFilter, setPriceFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [skuOverrides, setSkuOverrides] = useState({});
  const [sortBy, setSortBy] = useState("sc");
  const [sortDir, setSortDir] = useState(-1);
  const [expanded, setExpanded] = useState(null);
  const [purchaseLog, setPurchaseLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem("loop_purchases") || sessionStorage.getItem("loop_purchases") || "[]"); } catch { return []; }
  });
  const [editIdx, setEditIdx] = useState(null);
  const [rejectedLog, setRejectedLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem("loop_rejected") || sessionStorage.getItem("loop_rejected") || "[]"); } catch { return []; }
  });
  const [idealSlots, setIdealSlots] = useState(() => {
    try { const s = localStorage.getItem("loop_idealSlots") || sessionStorage.getItem("loop_idealSlots"); if (s) return JSON.parse(s); } catch {}
    return IDEAL_SLOTS.map(s => ({...s}));
  });
  const [idealBudget, setIdealBudget] = useState(45000);
  const [funnelOverrides, setFunnelOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("loop_funnel") || sessionStorage.getItem("loop_funnel") || "{}"); } catch { return {}; }
  });
  const sv = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch { try { sessionStorage.setItem(k, JSON.stringify(d)); } catch {} } };
  useEffect(() => sv("loop_purchases", purchaseLog), [purchaseLog]);
  useEffect(() => sv("loop_rejected", rejectedLog), [rejectedLog]);
  useEffect(() => sv("loop_idealSlots", idealSlots), [idealSlots]);
  useEffect(() => sv("loop_funnel", funnelOverrides), [funnelOverrides]);
  const [idealCatFilter, setIdealCatFilter] = useState(null);
  const [idealStatusFilter, setIdealStatusFilter] = useState(null);


  const handleApprove = useCallback((item) => {
    const now = new Date().toISOString().slice(0,10);
    const isDupe = (list) => list.some(p => p.nome===item.nome && p.fornecedor===item.fornecedor && p.pv===item.pv);
    let matchedSku = item.sku_ideal && item.sku_ideal !== "NENHUM" ? item.sku_ideal : null;
    
    setIdealSlots(prev => {
      // Prevent duplicate fills
      if (prev.some(s => s.matched && s.matchedWith === item.nome && s.matchedFornecedor === item.fornecedor)) return prev;
      const next = prev.map(s => ({...s}));
      
      const fillSlot = (idx) => {
        matchedSku = next[idx].sku || "SKU"+String(next[idx].id).padStart(3,"0");
        next[idx] = {...next[idx], matched: true, isNew: false, matchedWith: item.nome, matchedFornecedor: item.fornecedor, matchedData: {
          pv: item.pv, cu: item.custo, qtd: item.qtd, image: item.image || item.imagePreview, date: now, 
          score: item.score, rec: item.rec, receitaMes: item.receitaMes, lucroMes: item.lucroMes, demanda: item.demanda
        }};
      };
      
      // 1. Try AI-suggested SKU
      if (matchedSku) {
        const idx = next.findIndex(s => (s.sku === matchedSku || "SKU"+String(s.id).padStart(3,"0") === matchedSku) && !s.matched);
        if (idx >= 0) { fillSlot(idx); return next; }
      }
      // 2. Fallback: category + price proximity
      const norm = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
      const cands = next.filter(s => norm(s.c) === norm(item.categoria) && !s.matched);
      if (cands.length > 0) {
        cands.sort((a,b) => Math.abs(a.pv-(item.pv||0)) - Math.abs(b.pv-(item.pv||0)));
        const idx = next.findIndex(s => s.id === cands[0].id);
        fillSlot(idx);
      } else {
        // 3. Extra item (outside ideal)
        const nid = Math.max(...next.map(s=>s.id)) + 1;
        matchedSku = "EXT"+String(nid).padStart(3,"0");
        next.push({ id:nid, sku:matchedSku, n:item.nome, c:item.categoria, l:item.linha||"Base", pv:item.pv, cu:item.custo||0, mg:item.margem||0, q:item.qtd||0, d:[10,5,5], v:250, r:"Fora do ideal", matched:true, isNew:true, matchedWith:item.nome, matchedFornecedor:item.fornecedor, matchedData:{
          pv:item.pv, cu:item.custo, qtd:item.qtd, image:item.image||item.imagePreview, date:now, score:item.score, rec:item.rec, receitaMes:item.receitaMes, lucroMes:item.lucroMes, demanda:item.demanda
        }});
      }
      return next;
    });
    
    setPurchaseLog(prev => {
      if (isDupe(prev)) return prev;
      return [...prev, {...item, status:"aprovado", data:now, matchedSku}];
    });
  }, []);

  const handleReject = useCallback((item) => {
    setRejectedLog(prev => [...prev, item]);
  }, []);

  const handleEditSave = useCallback((idx, updated) => {
    setPurchaseLog(prev => prev.map((p, i) => i === idx ? { ...p, ...updated } : p));
    setEditIdx(null);
  }, []);

  const skus = useMemo(() => SKUS_RAW.map(r => {
    const ov = skuOverrides[r.i] || {};
    const pv = ov.pv !== undefined ? ov.pv : r.pv;
    const qc = ov.qc !== undefined ? ov.qc : r.qc;
    if (ov.pv === undefined && ov.qc === undefined) return r;
    const res = calcScore(pv, r.cu, qc, {l:r.l,w:r.w,h:r.h}, r.c);
    return {...r, pv, qc, mg:res.margem, sc:res.score, rc:res.rec, dm:res.demanda, rv:res.receitaMes, lu:res.lucroMes, pi:res.pi, gm:res.gmroi};
  }), [skuOverrides]);

  const suppliers = useMemo(() => [...new Set([...skus.map(s=>s.f),...purchaseLog.map(p=>p.fornecedor)].filter(Boolean))].sort(), [skus, purchaseLog]);

  const catStats = useMemo(() => {
    const map = {};
    skus.forEach(s => {
      if (!map[s.c]) map[s.c] = {name:s.c, count:0, lucro:0, receita:0, scores:[], estoqueVenda:0, demanda:0, totalQc:0};
      map[s.c].count++; map[s.c].lucro += s.lu; map[s.c].receita += s.rv; map[s.c].scores.push(s.sc);
      map[s.c].estoqueVenda += (s.pv||0) * (s.qc||0);
      map[s.c].demanda += s.dm||0;
      map[s.c].totalQc += s.qc||0;
    });
    const arr = Object.values(map);
    arr.forEach(c => { c.cobertura = c.demanda > 0 ? c.totalQc / c.demanda : 0; });
    return arr.sort((a,b) => b.lucro - a.lucro);
  }, [skus]);

  const totals = useMemo(() => {
    const t = {receita:0, lucro:0, skus:skus.length, ampliar:0, manter:0, revisar:0, cortar:0};
    skus.forEach(s => {
      t.receita += s.rv; t.lucro += s.lu;
      if(s.rc==="AMPLIAR") t.ampliar++; if(s.rc==="MANTER") t.manter++;
      if(s.rc==="REVISAR") t.revisar++; if(s.rc==="CORTAR") t.cortar++;
    });
    t.margem = t.receita > 0 ? (t.lucro/t.receita*100) : 0;
    return t;
  }, [skus]);

  const funnelData = useMemo(() => calculateFunnel(purchaseLog, funnelOverrides), [purchaseLog, funnelOverrides]);

  const filtered = useMemo(() => {
    let f = [...skus];
    if (catFilter) f = f.filter(s => s.c === catFilter);
    if (recFilter) f = f.filter(s => s.rc === recFilter);
    if (priceFilter) {
      const [min, max] = priceFilter.split("-").map(Number);
      f = f.filter(s => s.pv >= min && s.pv <= max);
    }
    if (search) {
      const q = search.toLowerCase();
      f = f.filter(s => s.n.toLowerCase().includes(q) || s.c.toLowerCase().includes(q) || s.f.toLowerCase().includes(q));
    }
    f.sort((a,b) => (a[sortBy] - b[sortBy]) * sortDir);
    return f;
  }, [skus, catFilter, recFilter, priceFilter, search, sortBy, sortDir]);

  const handleSort = useCallback((field) => {
    if (sortBy === field) setSortDir(d => d * -1);
    else { setSortBy(field); setSortDir(-1); }
  }, [sortBy]);

  const priceBuckets = useMemo(() => {
    const b = {"0-10":0,"10-20":0,"20-35":0,"35-50":0,"50-100":0,"100-9999":0};
    skus.forEach(s => {
      if(s.pv<=10) b["0-10"]++; else if(s.pv<=20) b["10-20"]++; else if(s.pv<=35) b["20-35"]++;
      else if(s.pv<=50) b["35-50"]++; else if(s.pv<=100) b["50-100"]++; else b["100-9999"]++;
    });
    return b;
  }, [skus]);

  const priceLabels = {"0-10":"R$5-10","10-20":"R$10-20","20-35":"R$20-35","35-50":"R$35-50","50-100":"R$50-100","100-9999":"R$100+"};

  const TabBtn = ({id, label, emoji, highlight}) => (
    <button onClick={()=>setTab(id)} style={{
      padding:"10px 20px", borderRadius:12, fontSize:14, fontWeight:tab===id?700:500,
      background: tab===id ? (highlight || "#2d3436") : "transparent",
      color:tab===id?"white":"#666", border:"none", cursor:"pointer",
      display:"flex", alignItems:"center", gap:6, transition:"all 0.2s",
      boxShadow: tab===id && highlight ? `0 2px 10px ${highlight}60` : "none"
    }}>{emoji} {label}</button>
  );

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(135deg, #ffecd2 0%, #fcb69f 50%, #ff9a9e 100%)",
      fontFamily:"'Nunito', 'Segoe UI', sans-serif"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
        input:focus, select:focus { outline: 2px solid #6C5CE7; outline-offset: 0px; }
      `}</style>

      {/* HEADER */}
      <div style={{
        background:"rgba(255,255,255,0.95)", backdropFilter:"blur(20px)",
        padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:"1px solid rgba(0,0,0,0.05)", position:"sticky", top:0, zIndex:100
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <div style={{
            width:42, height:42, borderRadius:12,
            background:"linear-gradient(135deg, #6C5CE7, #E84393)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:22, color:"white", fontWeight:900
          }}>∞</div>
          <div>
            <div style={{fontSize:20, fontWeight:900, color:"#2d3436"}}>LOOP</div>
            <div style={{fontSize:11, color:"#888"}}>Sortiment Manager v2.0 · {skus.length} SKUs</div>
          </div>
        </div>
        <div style={{display:"flex", gap:4, background:"#f5f5f5", padding:4, borderRadius:14, flexWrap:"wrap"}}>
          <TabBtn id="dashboard" label="Dashboard" emoji="📊" />
          <TabBtn id="catalogo" label="Catálogo" emoji="🛍️" />
          <TabBtn id="categorias" label="Categorias" emoji="📁" />
          <TabBtn id="avaliar" label="Avaliar Produto" emoji="🤖" highlight="#6C5CE7" />
          <TabBtn id="compras" label={`Compras (${purchaseLog.length})`} emoji="📋" highlight="#00b894" />
          <TabBtn id="insights" label="Insights" emoji="💡" highlight="#E84393" />
          <TabBtn id="ideal" label="Sortimento Ideal" emoji="🎯" highlight="#fd79a8" />
        </div>
      </div>

      <div style={{maxWidth:1200, margin:"0 auto", padding:"20px 16px"}}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            {/* APPROVED SORTIMENT */}
            <div style={{background:"white", borderRadius:16, padding:20, marginBottom:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", border:"2px solid #6C5CE730"}}>
              <div style={{fontSize:18, fontWeight:800, marginBottom:16}}>🛒 Sortimento Aprovado ({purchaseLog.length} SKUs)</div>
              {purchaseLog.length === 0 ? (
                <div style={{textAlign:"center", padding:20, color:"#aaa"}}>
                  <div style={{fontSize:36, marginBottom:8}}>📸</div>Nenhum produto aprovado. Use 🤖 Avaliar Produto.
                  <div style={{marginTop:12}}><button onClick={() => setTab("avaliar")} style={{padding:"10px 24px", borderRadius:10, border:"none", background:"linear-gradient(135deg, #6C5CE7, #E84393)", color:"white", fontWeight:700, cursor:"pointer"}}>Avaliar Produto</button></div>
                </div>
              ) : (<div>
                <div style={{display:"flex", flexWrap:"wrap", gap:10, marginBottom:16}}>
                  <KPICard label="SKUs" value={purchaseLog.length} color="#6C5CE7" emoji="📦" />
                  <KPICard label="Categorias" value={funnelData.n_cats} color="#00b894" emoji="🏷️" sub={"de 13"} />
                  <KPICard label="Investimento" value={fmt(purchaseLog.reduce((a,p) => a + (Number(p.custo)||0)*(Number(p.qtd)||0), 0))} color="#e17055" emoji="💳" />
                  <KPICard label="PM" value={"R$"+(funnelData.pm||0).toFixed(0)} color="#0984e3" emoji="🏷️" sub={((funnelData.pct_sub20||0)*100).toFixed(0)+"% ≤R$20"} />
                  <KPICard label="Score Méd" value={(purchaseLog.reduce((a,p) => a+(Number(p.score)||0), 0)/purchaseLog.length).toFixed(2)} color="#E84393" emoji="⭐" />
                </div>
                {(() => { const filled = idealSlots.filter(s => s.matched).length; const total = idealSlots.filter(s => !s.isNew).length; const pct = total > 0 ? (filled/total*100).toFixed(0) : 0;
                  return (<div style={{background:"#f8f9fa", borderRadius:12, padding:12, marginBottom:8}}>
                    <div style={{display:"flex", justifyContent:"space-between", marginBottom:6}}>
                      <span style={{fontSize:13, fontWeight:700}}>🎯 Progresso Sortimento Ideal</span>
                      <span style={{fontSize:13, fontWeight:700, color:"#6C5CE7"}}>{filled}/{total} ({pct}%)</span></div>
                    <div style={{height:8, background:"#eee", borderRadius:4, overflow:"hidden"}}>
                      <div style={{width:pct+"%", height:"100%", background:"linear-gradient(90deg, #6C5CE7, #00b894)", borderRadius:4}} /></div>
                  </div>);
                })()}
              </div>)}
            </div>

            {/* DYNAMIC FUNNEL */}
            <div style={{background:"white", borderRadius:16, padding:20, marginBottom:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", border:"2px solid #0984e330"}}>
              <div style={{fontSize:18, fontWeight:800, marginBottom:4}}>📊 Funil Dinâmico</div>
              <div style={{fontSize:12, color:"#888", marginBottom:16}}>KPIs calculados em tempo real a partir do sortimento aprovado.</div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:12, marginBottom:16}}>
                {[{k:"passantes_dia",l:"Passantes/dia",d:FUNNEL_DEFAULTS.passantes_dia,h:"7.667 = 10% de 2,3M/mês",s:1},
                  {k:"sr_base",l:"Taxa Parada Base (%)",d:FUNNEL_DEFAULTS.sr_base,h:"3% benchmark Tiger/Miniso",s:0.1},
                  {k:"conv_base",l:"Conversão Base (%)",d:FUNNEL_DEFAULTS.conv_base,h:"20% de quem para, compra",s:0.1},
                  {k:"pa_base",l:"P/A Base",d:FUNNEL_DEFAULTS.pa_base,h:"2.10 conservador (Tiger 4-6)",s:0.05}
                ].map(f => (<div key={f.k}><label style={{fontSize:11, fontWeight:600, color:"#888", display:"block", marginBottom:3}}>{f.l}</label>
                  <input type="number" step={f.s} value={funnelOverrides[f.k] ?? f.d} onChange={e => setFunnelOverrides(p => ({...p, [f.k]: Number(e.target.value)}))} style={{width:"100%", padding:"8px 10px", borderRadius:8, border:"2px solid #0984e340", fontSize:14, fontFamily:"inherit"}} />
                  <div style={{fontSize:10, color:"#0984e3", marginTop:2}}>💡 {f.h}</div></div>))}
              </div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:10, marginBottom:12}}>
                {[{l:"Taxa Parada",v:funnelData.sr+"%",c:"#0984e3",bg:"#f0f7ff",s:"Variedade: "+(funnelData.sr_factors.variety||1).toFixed(3)+"x"},
                  {l:"Conversão",v:funnelData.conv+"%",c:"#00b894",bg:"#f0fdf4",s:"Ampl: "+(funnelData.conv_factors.f_breadth||1).toFixed(3)+"x"},
                  {l:"P/A",v:funnelData.pa,c:"#E84393",bg:"#fef3f2",s:"Preço: "+(funnelData.pa_factors.f_price||1).toFixed(3)+"x"},
                  {l:"Compr/dia",v:funnelData.compradores_dia,c:"#6C5CE7",bg:"#f5f0ff",s:(funnelData.passantes_dia||0).toLocaleString()+" pass"},
                  {l:"Ticket",v:"R$"+funnelData.ticket,c:"#f39c12",bg:"#fff8e1",s:funnelData.pa+" × R$"+funnelData.pm},
                  {l:"Receita/mês",v:fmt(funnelData.receita_mes),c:"#2e7d32",bg:"#e8f5e9",s:funnelData.compradores_dia+"×R$"+funnelData.ticket+"×30"}
                ].map(f => (<div key={f.l} style={{background:f.bg, borderRadius:12, padding:12, textAlign:"center"}}>
                  <div style={{fontSize:11, color:"#888", fontWeight:600}}>{f.l}</div>
                  <div style={{fontSize:22, fontWeight:800, color:f.c}}>{f.v}</div>
                  <div style={{fontSize:10, color:"#888"}}>{f.s}</div></div>))}
              </div>
              <button onClick={() => setFunnelOverrides({})} style={{fontSize:11, color:"#888", background:"none", border:"1px solid #ddd", borderRadius:6, padding:"4px 10px", cursor:"pointer"}}>↩ Resetar premissas</button>
            </div>

            {/* BASE CATALOG */}
            <div style={{fontSize:14, fontWeight:700, color:"#888", marginBottom:12}}>📦 Catálogo Base ({skus.length} SKUs v6 — referência)</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:12, marginBottom:24}}>
              <KPICard label="Receita/mês" value={fmt(totals.receita)} color="#0984e3" emoji="💰" sub={AUX.painel.comp_dia+" compr/dia"} />
              <KPICard label="Lucro/mês" value={fmt(totals.lucro)} color="#00b894" emoji="📈" sub={"Margem "+(totals.margem||0).toFixed(1)+"%"} />
              <KPICard label="SKUs" value={totals.skus} color="#6C5CE7" emoji="📦" sub={catStats.length+" categorias"} />
            </div>
            <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:20}}>
              <div style={{fontSize:16, fontWeight:800, marginBottom:12}}>📊 Performance por Categoria (base)</div>
              <div style={{overflowX:"auto"}}><table style={{width:"100%", borderCollapse:"collapse", fontSize:13}}>
                <thead><tr style={{borderBottom:"2px solid #eee"}}>
                  <th style={{textAlign:"left", padding:"8px 12px", color:"#888"}}>Categoria</th>
                  <th style={{textAlign:"center", padding:"8px 6px", color:"#888"}}>SKUs</th>
                  <th style={{textAlign:"right", padding:"8px 6px", color:"#888"}}>Receita</th>
                  <th style={{textAlign:"right", padding:"8px 6px", color:"#888"}}>Score</th>
                </tr></thead><tbody>
                  {catStats.sort((a,b) => b.receita - a.receita).map(cat => (
                    <tr key={cat.cat} style={{borderBottom:"1px solid #f5f5f5", cursor:"pointer"}} onClick={() => { setCatFilter(cat.cat); setTab("catalogo"); }}>
                      <td style={{padding:"10px 12px", fontWeight:600}}>{CAT_EMOJI[cat.cat]} {cat.cat}</td>
                      <td style={{textAlign:"center"}}>{cat.count}</td>
                      <td style={{textAlign:"right", color:"#0984e3"}}>{fmt(cat.receita)}</td>
                      <td style={{textAlign:"right"}}>{(cat.score||0).toFixed(2)}</td>
                    </tr>))}
                </tbody></table></div>
            </div>
          </div>
        )}

        {/* CATÁLOGO */}
        {tab === "catalogo" && (
          <div>
            <div style={{background:"white", borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:16}}>
              <div style={{display:"flex", gap:12, flexWrap:"wrap", alignItems:"center", marginBottom:12}}>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 Buscar produto, categoria ou fornecedor..."
                  style={{flex:"1 1 250px", padding:"10px 16px", borderRadius:12, border:"2px solid #eee", fontSize:14, fontFamily:"inherit"}} />
                <select value={recFilter||""} onChange={e => setRecFilter(e.target.value||null)}
                  style={{padding:"10px 16px", borderRadius:12, border:"2px solid #eee", fontSize:13, fontFamily:"inherit"}}>
                  <option value="">Todas Recs</option>
                  {["AMPLIAR","MANTER","REVISAR","CORTAR"].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={priceFilter||""} onChange={e => setPriceFilter(e.target.value||null)}
                  style={{padding:"10px 16px", borderRadius:12, border:"2px solid #eee", fontSize:13, fontFamily:"inherit"}}>
                  <option value="">Todas Faixas</option>
                  {Object.entries(priceLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <CatBar cats={catStats} selected={catFilter} onSelect={setCatFilter} />
              <div style={{display:"flex", gap:8, fontSize:12, color:"#888"}}>
                <span style={{fontWeight:600}}>{filtered.length} produtos</span>
                <span>· Ordenar:</span>
                {[["sc","Score"],["pv","Preço"],["lu","Lucro"],["dm","Demanda"],["mg","Margem"]].map(([k,l]) => (
                  <button key={k} onClick={() => handleSort(k)} style={{
                    background:sortBy===k?"#6C5CE7":"#f5f5f5", color:sortBy===k?"white":"#666",
                    border:"none", borderRadius:8, padding:"3px 10px", fontSize:12, fontWeight:600, cursor:"pointer"
                  }}>{l} {sortBy===k ? (sortDir>0?"↑":"↓") : ""}</button>
                ))}
              </div>
            </div>

            <div style={{
              display:"grid", gridTemplateColumns:"40px 1fr 70px 55px 60px 120px 90px",
              padding:"8px 16px", fontSize:11, color:"#888", fontWeight:700, gap:8
            }}>
              <span></span><span>PRODUTO</span>
              <span style={{textAlign:"right"}}>PV (R$)</span><span style={{textAlign:"right"}}>MG%</span>
              <span style={{textAlign:"right"}}>QTD</span><span>SCORE</span><span style={{textAlign:"right"}}>REC</span>
            </div>

            <div style={{maxHeight:"60vh", overflowY:"auto"}}>
              {filtered.map(s => (
                <ProductRow key={s.i} sku={s} expanded={expanded===s.i} onToggle={() => setExpanded(expanded===s.i?null:s.i)}
                  onOverride={(id,field,val) => setSkuOverrides(o => ({...o, [id]: {...(o[id]||{}), [field]:val}}))} />
              ))}
              {filtered.length === 0 && <div style={{textAlign:"center", padding:40, color:"#888"}}>Nenhum produto encontrado 😔</div>}
            </div>
          </div>
        )}

        {/* CATEGORIAS */}
        {tab === "categorias" && (
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16}}>
            {catStats.map(cat => {
              const catSkus = skus.filter(s => s.c === cat.name);
              const avgScore = cat.scores.reduce((a,b)=>a+b,0)/cat.scores.length;
              const avgMg = catSkus.reduce((a,s)=>a+s.mg,0)/catSkus.length;
              const ampliar = catSkus.filter(s=>s.rc==="AMPLIAR").length;
              const cortar = catSkus.filter(s=>s.rc==="CORTAR").length;
              const topSku = [...catSkus].sort((a,b)=>b.sc-a.sc)[0];
              return (
                <div key={cat.name} style={{background:"white", borderRadius:16, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{background:`linear-gradient(135deg, ${CAT_COLORS[cat.name]}20, ${CAT_COLORS[cat.name]}40)`,
                    padding:"16px 20px", borderBottom:`3px solid ${CAT_COLORS[cat.name]}`}}>
                    <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                      <div style={{fontSize:18, fontWeight:800}}>{CAT_EMOJI[cat.name]} {cat.name}</div>
                      <div style={{background:CAT_COLORS[cat.name], color:"white", padding:"2px 10px", borderRadius:20, fontSize:13, fontWeight:700}}>{cat.count}</div>
                    </div>
                  </div>
                  <div style={{padding:"14px 20px"}}>
                    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, fontSize:12, marginBottom:12}}>
                      <div>📦 Estoque: <b style={{color:"#6C5CE7"}}>{fmt(cat.estoqueVenda)}</b></div>
                      <div>💰 Venda: <b style={{color:"#0984e3"}}>{fmt(cat.receita)}/m</b></div>
                      <div>📈 Lucro: <b style={{color:"#00b894"}}>{fmt(cat.lucro)}/m</b></div>
                      <div>📊 Margem: <b>{(avgMg||0).toFixed(0)}%</b></div>
                      <div>⏱️ Cobert: <b style={{color: cat.cobertura>6?"#d63031":cat.cobertura>3?"#fdcb6e":"#00b894"}}>{(cat.cobertura||0).toFixed(1)}m</b></div>
                      <div>ε: <b>{AUX.elast[cat.name] || "N/A"}</b></div>
                      <div style={{color:"#00b894"}}>✅ {ampliar}</div>
                      <div style={{color:"#d63031"}}>🔴 {cortar}</div>
                    </div>
                    <ScoreBar score={avgScore} />
                    {topSku && <div style={{fontSize:11, color:"#888", padding:8, background:"#f9f9f9", borderRadius:8, marginTop:8}}>
                      ⭐ Top: <b>{topSku.n.substring(0,30)}</b> ({(topSku?.sc||0).toFixed(1)})
                    </div>}
                    <button onClick={() => {setTab("catalogo"); setCatFilter(cat.name);}}
                      style={{width:"100%", marginTop:10, padding:"8px 0", borderRadius:10,
                        background:CAT_COLORS[cat.name], color:"white", border:"none", fontSize:13, fontWeight:700, cursor:"pointer"
                      }}>Ver produtos →</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* AI EVALUATOR */}
        {tab === "avaliar" && <AIEvaluator onApprove={handleApprove} onReject={handleReject} suppliers={suppliers} skus={skus} idealSlots={idealSlots} />}
      </div>


        {/* PURCHASE LOG */}
        {tab === "compras" && (
          <div>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
              <div style={{fontSize:20, fontWeight:800}}>📋 Log de Compras ({purchaseLog.length} produtos)</div>
              <div style={{display:"flex", gap:8}}>
                {purchaseLog.length > 0 && (
                  <button onClick={() => exportToXLSX(purchaseLog, `loop_compras_${new Date().toISOString().slice(0,10)}.xls`)}
                    style={{
                      padding:"10px 24px", borderRadius:12, border:"none", fontSize:14, fontWeight:700,
                      background:"#00b894", color:"white", cursor:"pointer",
                      boxShadow:"0 2px 10px rgba(0,184,148,0.3)"
                    }}>📥 Exportar Excel</button>
                )}
                {rejectedLog.length > 0 && (
                  <button onClick={() => exportToXLSX(rejectedLog, `loop_rejeitados_${new Date().toISOString().slice(0,10)}.xls`)}
                    style={{
                      padding:"10px 24px", borderRadius:12, border:"none", fontSize:14, fontWeight:700,
                      background:"#636e72", color:"white", cursor:"pointer"
                    }}>📥 Rejeitados ({rejectedLog.length})</button>
                )}
              </div>
            </div>

            {purchaseLog.length === 0 ? (
              <div style={{
                background:"white", borderRadius:20, padding:60, textAlign:"center",
                boxShadow:"0 2px 12px rgba(0,0,0,0.06)"
              }}>
                <div style={{fontSize:48, marginBottom:16}}>🛒</div>
                <div style={{fontSize:18, fontWeight:700, color:"#2d3436", marginBottom:8}}>
                  Nenhum produto aprovado ainda
                </div>
                <div style={{fontSize:14, color:"#888"}}>
                  Vá para "Avaliar Produto", analise uma foto com AI e clique ✅ para adicionar aqui
                </div>
                <button onClick={() => setTab("avaliar")} style={{
                  marginTop:20, padding:"12px 32px", borderRadius:12, border:"none",
                  background:"linear-gradient(135deg, #6C5CE7, #E84393)", color:"white",
                  fontSize:15, fontWeight:700, cursor:"pointer"
                }}>🤖 Avaliar Produto</button>
              </div>
            ) : (
              <div>
                {/* Summary KPIs */}
                <div style={{display:"flex", flexWrap:"wrap", gap:12, marginBottom:20}}>
                  <KPICard label="Produtos" value={purchaseLog.length} color="#6C5CE7" emoji="📦" />
                  <KPICard label="Investimento" value={fmt(purchaseLog.reduce((a,p) => a + (p.custo||0) * (p.qtd||0), 0))}
                    color="#e17055" emoji="💳" sub="custo × qtd" />
                  <KPICard label="Lucro Est./mês" value={fmt(purchaseLog.reduce((a,p) => a + (p.lucroMes||0), 0))}
                    color="#00b894" emoji="📈" />
                  <KPICard label="Receita Est./mês" value={fmt(purchaseLog.reduce((a,p) => a + (p.receitaMes||0), 0))}
                    color="#0984e3" emoji="💰" />
                  <KPICard label="Score Médio" value={(purchaseLog.reduce((a,p) => a + (p.score||0), 0) / purchaseLog.length).toFixed(2)}
                    color="#E84393" emoji="⭐" />
                </div>


                {/* Category Summary Table */}
                <div style={{background:"white", borderRadius:16, padding:16, marginBottom:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:15, fontWeight:800, marginBottom:12}}>📊 Resumo por Categoria</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%", borderCollapse:"collapse", fontSize:13}}>
                      <thead>
                        <tr style={{borderBottom:"2px solid #eee"}}>
                          <th style={{textAlign:"left", padding:"8px 12px", color:"#888", fontWeight:700}}>Categoria</th>
                          <th style={{textAlign:"center", padding:"8px 6px", color:"#888", fontWeight:700}}>SKUs</th>
                          <th style={{textAlign:"right", padding:"8px 6px", color:"#888", fontWeight:700}}>Custo Total</th>
                          <th style={{textAlign:"right", padding:"8px 6px", color:"#888", fontWeight:700}}>Venda Est./mês</th>
                          <th style={{textAlign:"right", padding:"8px 6px", color:"#888", fontWeight:700}}>Lucro Est./mês</th>
                          <th style={{textAlign:"right", padding:"8px 6px", color:"#888", fontWeight:700}}>Margem Méd.</th>
                          <th style={{textAlign:"right", padding:"8px 6px", color:"#888", fontWeight:700}}>Score Méd.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const byCat = {};
                          purchaseLog.forEach(p => {
                            const c = p.categoria || "Outros";
                            if (!byCat[c]) byCat[c] = { skus:0, custo:0, venda:0, lucro:0, margem:0, score:0 };
                            byCat[c].skus++;
                            byCat[c].custo += (Number(p.custo)||0) * (Number(p.qtd)||0);
                            byCat[c].venda += Number(p.receitaMes)||0;
                            byCat[c].lucro += Number(p.lucroMes)||0;
                            byCat[c].margem += Number(p.margem)||0;
                            byCat[c].score += Number(p.score)||0;
                          });
                          const sorted = Object.entries(byCat).sort((a,b) => b[1].custo - a[1].custo);
                          const totalCusto = sorted.reduce((a,[,v]) => a + v.custo, 0);
                          const totalVenda = sorted.reduce((a,[,v]) => a + v.venda, 0);
                          const totalLucro = sorted.reduce((a,[,v]) => a + v.lucro, 0);
                          return (<>
                            {sorted.map(([cat, v]) => (
                              <tr key={cat} style={{borderBottom:"1px solid #f5f5f5"}}>
                                <td style={{padding:"8px 12px", fontWeight:600}}>
                                  {CAT_EMOJI[cat]||"📦"} {cat}
                                </td>
                                <td style={{textAlign:"center", padding:"8px 6px"}}>{v.skus}</td>
                                <td style={{textAlign:"right", padding:"8px 6px", color:"#e17055", fontWeight:600}}>
                                  R${(v.custo||0).toFixed(0)}
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px", color:"#0984e3", fontWeight:600}}>
                                  R${(v.venda||0).toFixed(0)}/m
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px", color:"#00b894", fontWeight:600}}>
                                  R${(v.lucro||0).toFixed(0)}/m
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px"}}>
                                  {(v.margem / (v.skus||1)).toFixed(0)}%
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px"}}>
                                  {(v.score / (v.skus||1)).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                            <tr style={{borderTop:"2px solid #333", fontWeight:800}}>
                              <td style={{padding:"10px 12px"}}>TOTAL</td>
                              <td style={{textAlign:"center", padding:"10px 6px"}}>{purchaseLog.length}</td>
                              <td style={{textAlign:"right", padding:"10px 6px", color:"#e17055"}}>
                                R${(totalCusto||0).toFixed(0)}
                              </td>
                              <td style={{textAlign:"right", padding:"10px 6px", color:"#0984e3"}}>
                                R${(totalVenda||0).toFixed(0)}/m
                              </td>
                              <td style={{textAlign:"right", padding:"10px 6px", color:"#00b894"}}>
                                R${(totalLucro||0).toFixed(0)}/m
                              </td>
                              <td style={{textAlign:"right", padding:"10px 6px"}}>
                                {purchaseLog.length > 0 ? (purchaseLog.reduce((a,p) => a + (Number(p.margem)||0), 0) / purchaseLog.length).toFixed(0) : 0}%
                              </td>
                              <td style={{textAlign:"right", padding:"10px 6px"}}>
                                {purchaseLog.length > 0 ? (purchaseLog.reduce((a,p) => a + (Number(p.score)||0), 0) / purchaseLog.length).toFixed(2) : "-"}
                              </td>
                            </tr>
                          </>);
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Group by supplier */}
                {(() => {
                  const bySupplier = {};
                  purchaseLog.forEach(p => {
                    const s = p.fornecedor || "Sem fornecedor";
                    if (!bySupplier[s]) bySupplier[s] = [];
                    bySupplier[s].push(p);
                  });
                  return Object.entries(bySupplier).map(([supplier, items]) => (
                    <div key={supplier} style={{marginBottom:20}}>
                      <div style={{
                        background:"white", borderRadius:"16px 16px 0 0", padding:"12px 20px",
                        fontWeight:700, fontSize:15, borderBottom:"2px solid #6C5CE720",
                        display:"flex", justifyContent:"space-between", alignItems:"center"
                      }}>
                        <span>🏭 {supplier} ({items.length} itens)</span>
                        <span style={{fontSize:12, color:"#888"}}>
                          Investimento: R${items.reduce((a,p) => a + (p.custo||0) * (p.qtd||0), 0).toFixed(0)}
                        </span>
                      </div>
                      <div style={{background:"white", borderRadius:"0 0 16px 16px", overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                        {/* Table header */}
                        <div style={{
                          display:"grid", gridTemplateColumns:"40px 1fr 80px 70px 60px 60px 80px 70px 70px 70px 60px",
                          padding:"8px 16px", fontSize:11, color:"#888", fontWeight:700, gap:4, borderBottom:"1px solid #f0f0f0"
                        }}>
                          <span>#</span><span>PRODUTO</span><span style={{textAlign:"right"}}>PV</span>
                          <span style={{textAlign:"right"}}>CUSTO</span><span style={{textAlign:"right"}}>QTD</span>
                          <span style={{textAlign:"right"}}>MG%</span><span style={{textAlign:"right"}}>SCORE</span>
                          <span style={{textAlign:"right"}}>DEM/M</span><span style={{textAlign:"right"}}>REC/M</span><span style={{textAlign:"right"}}>LUCRO/M</span>
                          <span></span>
                        </div>
                        {items.map((p, idx) => (
                          <div key={idx} style={{
                            display:"grid", gridTemplateColumns:"40px 1fr 80px 70px 60px 60px 80px 70px 70px 70px 60px",
                            padding:"10px 16px", fontSize:13, gap:4, borderBottom:"1px solid #f8f8f8",
                            alignItems:"center"
                          }}>
                            <span style={{color:"#888"}}>{idx+1}</span>
                            <div>
                              <div style={{fontWeight:600, fontSize:13}}>{p.nome}</div>
                              <div style={{fontSize:11, color:"#888"}}>{CAT_EMOJI[p.categoria]} {p.categoria} · {p.linha}{p.matchedSku ? " · 🎯"+p.matchedSku : ""}</div>
                            </div>
                            <div style={{textAlign:"right", fontWeight:700}}>R${p.pv}</div>
                            <div style={{textAlign:"right", color:"#888"}}>R${p.custo?.toFixed(2)}</div>
                            <div style={{textAlign:"right"}}>{p.qtd}</div>
                            <div style={{textAlign:"right", color: p.margem >= 60 ? "#00b894" : "#e17055", fontWeight:600}}>
                              {p.margem?.toFixed(0)}%
                            </div>
                            <div style={{textAlign:"right"}}>
                              <ScoreBar score={p.score || 0} />
                            </div>
                            <div style={{textAlign:"right", fontSize:11, color:"#888"}}>{(p.demanda||0).toFixed?.(1)||"?"}</div>
                            <div style={{textAlign:"right", fontSize:11, color:"#0984e3"}}>{fmt(p.receitaMes || ((Number(p.demanda)||0) * (Number(p.pv)||0)))}</div>
                            <div style={{textAlign:"right", fontWeight:600, color:"#00b894"}}>{fmt(p.lucroMes || ((Number(p.demanda)||0) * ((Number(p.pv)||0) - (Number(p.custo)||0))))}</div>
                            <div style={{display:"flex", gap:4}}>
                              <button onClick={() => {
                                const globalIdx = purchaseLog.indexOf(p);
                                setEditIdx(globalIdx);
                              }} style={{
                                background:"none", border:"none", fontSize:14, cursor:"pointer", color:"#0984e3", padding:0
                              }} title="Editar">✏️</button>
                              <button onClick={() => {
                                const ts = p.timestamp;
                                setPurchaseLog(prev => prev.filter(x => x.timestamp !== ts));
                                setRejectedLog(prev => [...prev, p]);
                              }} style={{
                                background:"none", border:"none", fontSize:14, cursor:"pointer", color:"#d63031", padding:0
                              }} title="Mover para rejeitados">🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}

                {/* Rejected section */}
                {rejectedLog.length > 0 && (
                  <details style={{marginTop:20}}>
                    <summary style={{
                      fontSize:15, fontWeight:700, color:"#636e72", cursor:"pointer", padding:"12px 0"
                    }}>❌ Rejeitados ({rejectedLog.length}) — clique para expandir</summary>
                    <div style={{background:"white", borderRadius:16, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginTop:8}}>
                      {rejectedLog.map((p, idx) => (
                        <div key={idx} style={{
                          display:"flex", alignItems:"center", gap:12, padding:"10px 16px",
                          borderBottom:"1px solid #f8f8f8", fontSize:13, opacity:0.7
                        }}>
                          <span style={{color:"#888"}}>{idx+1}</span>
                          <span style={{flex:1, fontWeight:600}}>{p.nome}</span>
                          <span style={{color:"#888"}}>{p.categoria}</span>
                          <span>R${p.pv}</span>
                          <span style={{color:"#888"}}>Score {p.score?.toFixed(2)}</span>
                          <span style={{fontSize:11, color:"#888"}}>{p.veredicto?.split(" ")[0]}</span>
                          <button onClick={() => {
                            setRejectedLog(prev => prev.filter((_,i) => i !== idx));
                            setPurchaseLog(prev => [...prev, p]);
                          }} style={{
                            background:"#00b89420", border:"none", borderRadius:8, padding:"4px 10px",
                            fontSize:11, fontWeight:700, color:"#00b894", cursor:"pointer"
                          }}>↩️ Restaurar</button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* Edit Modal */}
        {editIdx !== null && purchaseLog[editIdx] && (() => {
          const p = purchaseLog[editIdx];
          return (
            <div style={{
              position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.5)",
              display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
            }} onClick={() => setEditIdx(null)}>
              <div style={{
                background:"white", borderRadius:20, padding:24, width:"90%", maxWidth:500,
                maxHeight:"80vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)"
              }} onClick={e => e.stopPropagation()}>
                <div style={{fontSize:18, fontWeight:800, marginBottom:16}}>✏️ Editar — {p.nome}</div>
                {[
                  {k:"nome", label:"Nome", type:"text"},
                  {k:"categoria", label:"Categoria", type:"select", opts: ALL_CATS},
                  {k:"fornecedor", label:"Fornecedor", type:"text"},
                  {k:"pv", label:"Preço Venda (R$)", type:"number"},
                  {k:"custo", label:"Custo (R$)", type:"number"},
                  {k:"qtd", label:"Quantidade", type:"number"},
                ].map(field => (
                  <div key={field.k} style={{marginBottom:12}}>
                    <label style={{fontSize:12, fontWeight:600, color:"#888", display:"block", marginBottom:3}}>
                      {field.label}
                    </label>
                    {field.type === "select" ? (
                      <select
                        defaultValue={p[field.k] || ""}
                        id={`edit-${field.k}`}
                        style={{width:"100%", padding:"10px 12px", borderRadius:10, border:"2px solid #eee", fontSize:14}}
                      >
                        {field.opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        defaultValue={p[field.k] || ""}
                        id={`edit-${field.k}`}
                        style={{width:"100%", padding:"10px 12px", borderRadius:10, border:"2px solid #eee", fontSize:14, boxSizing:"border-box"}}
                      />
                    )}
                  </div>
                ))}
                <div style={{display:"flex", gap:12, marginTop:20}}>
                  <button onClick={() => {
                    const get = k => document.getElementById(`edit-${k}`)?.value;
                    const pv = Number(get("pv")) || p.pv;
                    const custo = Number(get("custo")) || p.custo;
                    const cat = get("categoria") || p.categoria;
                    const newScore = calcScore(pv, custo, Number(get("qtd")) || p.qtd, p.dims, cat);
                    handleEditSave(editIdx, {
                      nome: get("nome") || p.nome,
                      categoria: cat,
                      fornecedor: get("fornecedor") || p.fornecedor,
                      pv: pv,
                      custo: custo,
                      qtd: Number(get("qtd")) || p.qtd,
                      margem: newScore ? newScore.margem : p.margem,
                      score: newScore ? newScore.score : p.score,
                      rec: newScore ? newScore.rec : p.rec,
                      demanda: newScore ? newScore.demanda : p.demanda,
                      receitaMes: newScore ? newScore.receitaMes : p.receitaMes,
                      lucroMes: newScore ? newScore.lucroMes : p.lucroMes,
                      pi: newScore ? newScore.pi : p.pi,
                      gmroi: newScore ? newScore.gmroi : p.gmroi,
                    });
                  }} style={{
                    flex:1, padding:"12px 0", borderRadius:12, border:"none", fontSize:15, fontWeight:800,
                    background:"#00b894", color:"white", cursor:"pointer"
                  }}>💾 Salvar</button>
                  <button onClick={() => setEditIdx(null)} style={{
                    flex:1, padding:"12px 0", borderRadius:12, border:"2px solid #ddd", fontSize:15,
                    fontWeight:700, background:"white", cursor:"pointer", color:"#636e72"
                  }}>Cancelar</button>
                </div>
              </div>
            </div>
          );
        })()}


        {/* INSIGHTS */}
        {tab === "insights" && (() => {
          const ap = purchaseLog;
          const filled = idealSlots.filter(s => s.matched && !s.isNew);
          const openSlots = idealSlots.filter(s => !s.matched);
          const extras = idealSlots.filter(s => s.isNew);
          const totalSlots = idealSlots.filter(s => !s.isNew).length;
          const catGaps = {}; openSlots.forEach(s => { catGaps[s.c] = (catGaps[s.c]||0) + 1; });
          const pBuckets = {"R$0-10":0,"R$10-20":0,"R$20-35":0,"R$35-50":0,"R$50+":0};
          ap.forEach(p => { const pv=Number(p.pv)||0; if(pv<=10) pBuckets["R$0-10"]++; else if(pv<=20) pBuckets["R$10-20"]++; else if(pv<=35) pBuckets["R$20-35"]++; else if(pv<=50) pBuckets["R$35-50"]++; else pBuckets["R$50+"]++; });
          const apCats = {}; ap.forEach(p => { const c=p.categoria||"?"; if(!apCats[c]) apCats[c]={n:0,inv:0,scores:[],margens:[]}; apCats[c].n++; apCats[c].inv+=(Number(p.custo)||0)*(Number(p.qtd)||0); apCats[c].scores.push(Number(p.score)||0); apCats[c].margens.push(Number(p.margem)||0); });
          return (<div style={{padding:20, maxWidth:1100, margin:"0 auto"}}>
            <div style={{fontSize:22, fontWeight:800, marginBottom:20}}>💡 Insights Dinâmicos</div>
            {ap.length === 0 ? (<div style={{background:"white", borderRadius:16, padding:40, textAlign:"center"}}><div style={{fontSize:48, marginBottom:12}}>🔍</div><div style={{fontSize:16, fontWeight:700}}>Sem dados</div><div style={{color:"#888"}}>Aprove produtos para gerar insights.</div></div>
            ) : (<div style={{display:"flex", flexDirection:"column", gap:16}}>
              {/* HEALTH */}
              <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:12}}>🏥 Saúde do Sortimento</div>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:12}}>
                  <div style={{padding:12, borderRadius:10, background:"#f0f7ff"}}><div style={{fontSize:11, color:"#888"}}>Cobertura</div><div style={{fontSize:22, fontWeight:800, color:"#0984e3"}}>{filled.length}/{totalSlots}</div><div style={{fontSize:11, color:"#888"}}>{totalSlots>0?(filled.length/totalSlots*100).toFixed(0):0}% preenchido</div></div>
                  <div style={{padding:12, borderRadius:10, background:extras.length?"#fef2f2":"#f0fdf4"}}><div style={{fontSize:11, color:"#888"}}>Fora do Ideal</div><div style={{fontSize:22, fontWeight:800, color:extras.length?"#e17055":"#00b894"}}>{extras.length}</div></div>
                  <div style={{padding:12, borderRadius:10, background:"#fff8e1"}}><div style={{fontSize:11, color:"#888"}}>Categorias</div><div style={{fontSize:22, fontWeight:800, color:"#f39c12"}}>{funnelData.n_cats}/13</div></div>
                  <div style={{padding:12, borderRadius:10, background:"#f5f0ff"}}><div style={{fontSize:11, color:"#888"}}>Rejeitados</div><div style={{fontSize:22, fontWeight:800, color:"#6C5CE7"}}>{rejectedLog.length}</div></div>
                </div>
              </div>
              {/* GAPS */}
              <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:12}}>🎯 Gaps (slots abertos)</div>
                <div style={{display:"flex", flexWrap:"wrap", gap:8}}>
                  {Object.entries(catGaps).sort((a,b)=>b[1]-a[1]).map(([cat,n]) => (<div key={cat} style={{padding:"8px 14px", borderRadius:10, background:(CAT_COLORS[cat]||"#ccc")+"15", border:"2px solid "+(CAT_COLORS[cat]||"#ccc")+"30"}}><span>{CAT_EMOJI[cat]} {cat} </span><span style={{background:CAT_COLORS[cat], color:"white", borderRadius:10, padding:"2px 8px", fontSize:11, fontWeight:800}}>{n}</span></div>))}
                  {Object.keys(catGaps).length===0 && <div style={{color:"#00b894", fontWeight:700}}>✅ Todos preenchidos!</div>}
                </div>
              </div>
              {/* PRICE DIST */}
              <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:12}}>💰 Distribuição de Preço</div>
                <div style={{display:"flex", gap:4, alignItems:"end", height:120}}>
                  {Object.entries(pBuckets).map(([r,n]) => { const mx=Math.max(...Object.values(pBuckets),1); const h=n>0?Math.max(20,n/mx*100):5;
                    return (<div key={r} style={{flex:1, textAlign:"center"}}><div style={{fontSize:14, fontWeight:800}}>{n}</div><div style={{height:h, background:"linear-gradient(to top, #6C5CE7, #a29bfe)", borderRadius:"6px 6px 0 0"}} /><div style={{fontSize:10, color:"#888", marginTop:4}}>{r}</div></div>);
                  })}
                </div>
                <div style={{marginTop:12, fontSize:12, color:"#888"}}>💡 Ideal: 60-70% ≤R$20. Atual: {((funnelData.pct_sub20||0)*100).toFixed(0)}%{funnelData.pct_sub20<0.6?<span style={{color:"#e17055", fontWeight:700}}> — adicione itens baratos</span>:<span style={{color:"#00b894", fontWeight:700}}> — na faixa ideal!</span>}</div>
              </div>
              {/* FUNNEL IMPACT */}
              <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:12}}>📊 Impacto no Funil</div>
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16}}>
                  {[{l:"Parada",v:funnelData.sr+"%",c:"#0984e3",b:funnelOverrides.sr_base||3,u:"%"},
                    {l:"Conversão",v:funnelData.conv+"%",c:"#00b894",b:funnelOverrides.conv_base||20,u:"%"},
                    {l:"P/A",v:funnelData.pa,c:"#E84393",b:funnelOverrides.pa_base||2.1,u:""}
                  ].map(f => (<div key={f.l} style={{textAlign:"center"}}><div style={{fontSize:12, color:"#888"}}>{f.l}</div><div style={{fontSize:28, fontWeight:800, color:f.c}}>{f.v}</div><div style={{fontSize:10, color:parseFloat(f.v)>f.b?"#00b894":"#e17055"}}>{parseFloat(f.v)>f.b?"▲":"▼"} vs base {f.b}{f.u}</div></div>))}
                </div>
              </div>
              {/* CAT PERF */}
              {Object.keys(apCats).length > 0 && (<div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:12}}>📁 Performance (aprovados)</div>
                <table style={{width:"100%", borderCollapse:"collapse", fontSize:13}}><thead><tr style={{borderBottom:"2px solid #eee"}}>
                  <th style={{textAlign:"left", padding:"8px 12px", color:"#888"}}>Categoria</th><th style={{textAlign:"center", color:"#888"}}>SKUs</th><th style={{textAlign:"right", color:"#888"}}>Investimento</th><th style={{textAlign:"right", color:"#888"}}>Score</th><th style={{textAlign:"right", color:"#888"}}>Margem</th><th style={{textAlign:"center", color:"#888"}}>Gaps</th>
                </tr></thead><tbody>
                  {Object.entries(apCats).sort((a,b)=>b[1].n-a[1].n).map(([cat,d]) => (<tr key={cat} style={{borderBottom:"1px solid #f5f5f5"}}>
                    <td style={{padding:"10px 12px", fontWeight:600}}>{CAT_EMOJI[cat]} {cat}</td><td style={{textAlign:"center"}}>{d.n}</td><td style={{textAlign:"right", color:"#e17055"}}>{fmt(d.inv)}</td><td style={{textAlign:"right"}}>{(d.scores.reduce((a,v)=>a+v,0)/d.scores.length).toFixed(2)}</td><td style={{textAlign:"right"}}>{(d.margens.reduce((a,v)=>a+v,0)/d.margens.length).toFixed(0)}%</td><td style={{textAlign:"center", color:(catGaps[cat]||0)>0?"#e17055":"#00b894", fontWeight:700}}>{catGaps[cat]||"✅"}</td>
                  </tr>))}
                </tbody></table>
              </div>)}
            </div>)}
          </div>);
        })()}

      
        {/* SORTIMENTO IDEAL */}
        {tab === "ideal" && (() => {
          const totalCapital = idealSlots.reduce((a,s) => a + s.cu * s.q, 0);
          const matchedCount = idealSlots.filter(s => s.matched).length;
          const newCount = idealSlots.filter(s => s.isNew).length;
          const pendingCount = idealSlots.filter(s => !s.matched).length;
          const totalSlotsN = idealSlots.length;
          const progress = totalSlotsN > 0 ? matchedCount / totalSlotsN * 100 : 0;
          const idealCats = {};
          idealSlots.forEach(s => {
            if (!idealCats[s.c]) idealCats[s.c] = {name:s.c, total:0, matched:0, newItems:0, capital:0};
            idealCats[s.c].total++;
            if (s.matched && !s.isNew) idealCats[s.c].matched++;
            if (s.isNew) idealCats[s.c].newItems++;
            idealCats[s.c].capital += s.cu * s.q;
          });
          const idealCatArr = Object.values(idealCats).sort((a,b) => b.total - a.total);
          let fSlots = [...idealSlots];
          if (idealCatFilter) fSlots = fSlots.filter(s => s.c === idealCatFilter);
          if (idealStatusFilter === "pending") fSlots = fSlots.filter(s => !s.matched);
          else if (idealStatusFilter === "matched") fSlots = fSlots.filter(s => s.matched && !s.isNew);
          else if (idealStatusFilter === "new") fSlots = fSlots.filter(s => s.isNew);

          return (
            <div>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:12}}>
                <div>
                  <h2 style={{margin:0, fontSize:22, fontWeight:900}}>&#x1F3AF; Sortimento Ideal &#x2014; Guia de Compras</h2>
                  <p style={{margin:"4px 0 0", fontSize:13, color:"#888"}}>148 slots otimizados | Metodologia v11 | Score, Pi, GMROI, CS ponderados</p>
                </div>
                <div style={{display:"flex", alignItems:"center", gap:8}}>
                  <span style={{fontSize:12, color:"#888"}}>Budget estoque:</span>
                  <input value={idealBudget} onChange={e => setIdealBudget(Number(e.target.value) || 0)} style={{width:110, padding:"6px 10px", borderRadius:8, border:"2px solid #eee", fontSize:14, fontWeight:700, textAlign:"right"}} />
                </div>
              </div>

              <div style={{background:"white", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{display:"flex", justifyContent:"space-between", marginBottom:8}}>
                  <span style={{fontSize:14, fontWeight:700}}>Progresso do Sortimento</span>
                  <span style={{fontSize:14, fontWeight:900, color:"#6C5CE7"}}>{matchedCount}/{totalSlotsN} ({(progress||0).toFixed(0)}%)</span>
                </div>
                <div style={{height:20, background:"#f0f0f0", borderRadius:10, overflow:"hidden", position:"relative"}}>
                  <div style={{height:"100%", width:Math.max(0,progress)+"%", background:"linear-gradient(90deg, #6C5CE7, #00b894)", borderRadius:10, transition:"width 0.5s"}} />
                </div>
                <div style={{display:"flex", gap:16, marginTop:10, fontSize:12}}>
                  <span><span style={{display:"inline-block", width:10, height:10, borderRadius:3, background:"#00b894", marginRight:4}} />Comprados: {matchedCount - newCount}</span>
                  <span><span style={{display:"inline-block", width:10, height:10, borderRadius:3, background:"#fdcb6e", marginRight:4}} />Novos: {newCount}</span>
                  <span><span style={{display:"inline-block", width:10, height:10, borderRadius:3, background:"#ddd", marginRight:4}} />Pendentes: {pendingCount}</span>
                </div>
              </div>

              <div style={{display:"flex", gap:12, marginBottom:16, flexWrap:"wrap"}}>
                {[
                  {label:"Capital Estimado", value:"R$"+(totalCapital||0).toFixed(0), color: totalCapital > idealBudget ? "#d63031" : "#00b894", sub: totalCapital > idealBudget ? "ACIMA do budget" : ((100-totalCapital/idealBudget*100).toFixed(0)+"% abaixo")},
                  {label:"SKUs Pendentes", value:pendingCount, color:"#e17055", sub:"precisam ser comprados"},
                  {label:"PM Ideal", value:"R$"+(idealSlots.reduce((a,s)=>a+s.pv,0)/(idealSlots.length||1)).toFixed(0), color:"#6C5CE7"},
                  {label:"Mg Media", value:(idealSlots.reduce((a,s)=>a+s.mg,0)/(idealSlots.length||1)).toFixed(0)+"%", color:"#00b894"},
                  {label:"Categorias", value:[...new Set(idealSlots.map(s=>s.c))].length, color:"#fd79a8"},
                ].map((k,i) => (
                  <div key={i} style={{flex:"1 1 130px", background:"white", borderRadius:14, padding:"14px 18px", boxShadow:"0 2px 10px rgba(0,0,0,0.05)", border:"2px solid "+(k.color||"#eee")+"20"}}>
                    <div style={{fontSize:12, color:"#888", fontWeight:600}}>{k.label}</div>
                    <div style={{fontSize:22, fontWeight:900, color:k.color||"#333"}}>{k.value}</div>
                    {k.sub && <div style={{fontSize:10, color:"#aaa"}}>{k.sub}</div>}
                  </div>
                ))}
              </div>

              <div style={{background:"white", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:14, fontWeight:800, marginBottom:12}}>&#x1F4C1; Por Categoria</div>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:8}}>
                  {idealCatArr.map((c,i) => {
                    const pct = c.total > 0 ? c.matched / c.total * 100 : 0;
                    return (
                      <button key={i} onClick={() => setIdealCatFilter(idealCatFilter === c.name ? null : c.name)} style={{padding:10, borderRadius:10, border: idealCatFilter === c.name ? "2px solid #6C5CE7" : "1px solid #eee", background: idealCatFilter === c.name ? "#6C5CE710" : "white", cursor:"pointer", textAlign:"left"}}>
                        <div style={{display:"flex", justifyContent:"space-between"}}><span style={{fontWeight:700, fontSize:12}}>{c.name}</span><span style={{fontSize:11, color:"#888"}}>{c.matched}/{c.total}</span></div>
                        <div style={{height:4, background:"#f0f0f0", borderRadius:2, marginTop:6}}><div style={{height:"100%", width:pct+"%", background:"#6C5CE7", borderRadius:2}} /></div>
                        <div style={{fontSize:10, color:"#aaa", marginTop:3}}>R${(c.capital||0).toFixed(0)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{display:"flex", gap:8, marginBottom:16, flexWrap:"wrap"}}>
                {[{id:null,label:"Todos",n:idealSlots.length},{id:"pending",label:"Pendentes",n:pendingCount},{id:"matched",label:"Comprados",n:matchedCount-newCount},{id:"new",label:"Novos",n:newCount}].map(f => (
                  <button key={f.id||"all"} onClick={() => setIdealStatusFilter(f.id)} style={{padding:"8px 16px", borderRadius:20, border:"none", fontSize:12, fontWeight:700, background: idealStatusFilter === f.id ? "#6C5CE7" : "#f0f0f0", color: idealStatusFilter === f.id ? "white" : "#666", cursor:"pointer"}}>{f.label} ({f.n})</button>
                ))}
                {idealCatFilter && <button onClick={() => setIdealCatFilter(null)} style={{padding:"8px 16px", borderRadius:20, border:"1px solid #6C5CE7", background:"white", color:"#6C5CE7", fontSize:12, fontWeight:700, cursor:"pointer"}}>x {idealCatFilter}</button>}
              </div>

              <div style={{display:"grid", gap:6}}>
                <div style={{display:"grid", gridTemplateColumns:"36px 40px 1fr 70px 60px 50px 50px 60px 70px", gap:10, padding:"8px 18px", fontSize:11, color:"#aaa", fontWeight:700}}>
                  <div></div><div></div><div>Produto</div><div>PV</div><div>Custo</div><div>Mg</div><div>Qtd</div><div>Capital</div><div>Linha</div>
                </div>
                {fSlots.map(s => {
                  const capItem = s.cu * s.q;
                  return (
                    <div key={s.id} style={{background: s.matched ? "#f0fdf4" : "white", borderRadius:12, padding:"12px 18px", boxShadow:"0 1px 4px rgba(0,0,0,0.03)", display:"grid", gridTemplateColumns:"36px 40px 1fr 70px 60px 50px 50px 60px 70px", alignItems:"center", gap:10, fontSize:13, borderLeft: s.isNew ? "4px solid #fdcb6e" : s.matched ? "4px solid #00b894" : "4px solid #dfe6e9"}}>
                      <div style={{textAlign:"center"}}>{s.matched ? (s.isNew ? <span title="Novo">&#x1F195;</span> : <span title="Comprado">&#x2705;</span>) : <span style={{color:"#ddd"}}>&#x2B1C;</span>}</div>
                      <div>{s.matchedData?.image ? <img src={s.matchedData.image} alt="" style={{width:36, height:36, borderRadius:6, objectFit:"cover"}} /> : <div style={{width:36, height:36, borderRadius:6, background:"#f0f0f0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16}}>{CAT_EMOJI[s.c]||"📦"}</div>}</div>
                      <div>
                        <div style={{fontWeight:700, fontSize:12}}>{s.matched ? s.matchedWith : s.n}</div>
                        <div style={{fontSize:10, color:"#888"}}>{s.c} · {s.matched ? (s.matchedFornecedor||"") : s.r}</div>
                        {s.matched && s.matchedData && <div style={{fontSize:10, color:"#00b894"}}>Rec: {fmt(s.matchedData.receitaMes||0)}/m · Lucro: {fmt(s.matchedData.lucroMes||0)}/m</div>}
                        {!s.matched && <div style={{fontSize:10, color:"#aaa", fontStyle:"italic"}}>{s.r}</div>}
                      </div>
                      <div style={{fontWeight:800, color:"#6C5CE7"}}>R${s.matched && s.matchedData ? s.matchedData.pv : s.pv}</div>
                      <div style={{fontSize:11, color:"#888"}}>R${s.matched && s.matchedData ? (s.matchedData.cu||0).toFixed(2) : (s.cu||0).toFixed(2)}</div>
                      <div style={{fontSize:11, fontWeight:700, color: s.mg >= 70 ? "#00b894" : s.mg >= 50 ? "#fdcb6e" : "#d63031"}}>{(s.mg||0).toFixed(0)}%</div>
                      <div style={{fontSize:11, color:"#888"}}>{s.matched && s.matchedData ? s.matchedData.qtd : s.q}</div>
                      <div style={{fontSize:11, color:"#888"}}>R${(s.matched && s.matchedData ? (s.matchedData.cu||0)*(s.matchedData.qtd||0) : capItem).toFixed(0)}</div>
                      <div><span style={{fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6, background: s.l === "Entrada" ? "#00b89415" : s.l === "Base" ? "#6C5CE715" : "#E8439315", color: s.l === "Entrada" ? "#00b894" : s.l === "Base" ? "#6C5CE7" : "#E84393"}}>{s.l}</span></div>
                    </div>
                  );
                })}
              </div>

              <div style={{marginTop:16, padding:16, background:"rgba(255,255,255,0.7)", borderRadius:12, fontSize:12, color:"#888", lineHeight:1.6}}>
                <strong>Como usar:</strong> Avalie e aprove produtos na aba Avaliar Produto. Cada aprovacao substitui o slot mais similar (mesma categoria + preco mais proximo). Produtos sem par entram como Novo. O objetivo e preencher todos os quadrados com checks verdes.
              </div>
            </div>
          );
        })()}

      <div style={{textAlign:"center", padding:"20px 0 40px", fontSize:12, color:"rgba(0,0,0,0.3)"}}>
        LOOP Sortiment Manager v3.1 · {skus.length} SKUs + {purchaseLog.length} novos · Etapas 1-4 · Fev 2026
      </div>
    </div>
  );
}
