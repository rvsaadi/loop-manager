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
    try { const s = localStorage.getItem("loop_purchases") || sessionStorage.getItem("loop_purchases"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [editIdx, setEditIdx] = useState(null);
  const [rejectedLog, setRejectedLog] = useState(() => {
    try { const s = localStorage.getItem("loop_rejected") || sessionStorage.getItem("loop_rejected"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [idealSlots, setIdealSlots] = useState(() => {
    try { const s = localStorage.getItem("loop_idealSlots") || sessionStorage.getItem("loop_idealSlots"); if (s) return JSON.parse(s); } catch {}
    return IDEAL_SLOTS.map(s => ({...s}));
  });
  const [idealBudget, setIdealBudget] = useState(45000);
  const [funnelOverrides, setFunnelOverrides] = useState(() => {
    try { const s = localStorage.getItem("loop_funnel") || sessionStorage.getItem("loop_funnel"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  
  // Persist data
  const saveData = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch { try { sessionStorage.setItem(k, JSON.stringify(d)); } catch {} } };
  useEffect(() => saveData("loop_purchases", purchaseLog), [purchaseLog]);
  useEffect(() => saveData("loop_rejected", rejectedLog), [rejectedLog]);
  useEffect(() => saveData("loop_idealSlots", idealSlots), [idealSlots]);
  useEffect(() => saveData("loop_funnel", funnelOverrides), [funnelOverrides]);

  const [idealCatFilter, setIdealCatFilter] = useState(null);
  const [idealStatusFilter, setIdealStatusFilter] = useState(null);

  const suppliers = useMemo(() => {
    const s = new Set(SKUS_RAW.map(sk => sk.f).filter(Boolean));
    purchaseLog.forEach(p => { if (p.fornecedor) s.add(p.fornecedor); });
    return [...s].sort();
  }, [purchaseLog]);

  const handleApprove = useCallback((item) => {
    const approvedItem = {...item, status: "aprovado", data: new Date().toISOString().slice(0,10)};
    setPurchaseLog(prev => {
      if (prev.some(p => p.nome === item.nome && p.fornecedor === item.fornecedor && p.pv === item.pv)) return prev;
      return [...prev, approvedItem];
    });
    setIdealSlots(prev => {
      if (prev.some(s => s.status === "filled" && s.filled?.nome === item.nome && s.filled?.fornecedor === item.fornecedor)) return prev;
      const next = prev.map(s => ({...s}));
      const fillData = { nome: item.nome, fornecedor: item.fornecedor, pv: item.pv, cu: item.custo, qtd: item.qtd, image: item.image, date: approvedItem.data, score: item.score, rec: item.rec };
      if (item.sku_ideal && item.sku_ideal !== "NENHUM") {
        const idx = next.findIndex(s => s.sku === item.sku_ideal && s.status === "open");
        if (idx >= 0) { next[idx] = {...next[idx], status: "filled", filled: fillData}; return next; }
      }
      const catNorm = (item.categoria||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
      const cands = next.filter(s => (s.c||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase() === catNorm && s.status === "open");
      if (cands.length > 0) {
        cands.sort((a,b) => Math.abs(a.pv-(item.pv||0)) - Math.abs(b.pv-(item.pv||0)));
        const idx = next.findIndex(s => s.id === cands[0].id);
        next[idx] = {...next[idx], status: "filled", filled: fillData};
      } else {
        const nid = Math.max(...next.map(s=>s.id)) + 1;
        next.push({ sku:"EXT"+String(nid).padStart(3,"0"), id:nid, n:item.nome, c:item.categoria, l:item.linha||"Base", pv:item.pv, cu:item.custo||0, mg:item.margem||0, q:item.qtd||0, d:[10,5,5], v:250, r:"Fora do ideal", status:"extra", filled:fillData });
      }
      return next;
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
            <div style={{display:"flex", flexWrap:"wrap", gap:12, marginBottom:24}}>
              <KPICard label="Receita/mês" value={fmt(totals.receita)} color="#0984e3" emoji="💰" sub={`${AUX.painel.comp_dia} compr/dia`} />
              <KPICard label="Lucro/mês" value={fmt(totals.lucro)} color="#00b894" emoji="📈" sub={`Margem ${totals.margem.toFixed(1)}%`} />
              <KPICard label="SKUs" value={totals.skus} color="#6C5CE7" emoji="📦" sub={`${catStats.length} categorias`} />
              <KPICard label="P/A" value={AUX.painel.pa.toFixed(2)} color="#E84393" emoji="🛒" sub={`${AUX.painel.dem_total} pcs/mês`} />
              <KPICard label="Taxa Parada" value={`${AUX.painel.sr}%`} color="#fdcb6e" emoji="👀" sub={`Conv ${AUX.painel.conv}%`} />
            </div>

            <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:20}}>
              <div style={{fontSize:16, fontWeight:700, marginBottom:16}}>Recomendações do Sortimento</div>
              <div style={{display:"flex", gap:12, flexWrap:"wrap"}}>
                {[
                  {k:"AMPLIAR",v:totals.ampliar,c:"#00b894",d:"Score ≥ 3.5"},
                  {k:"MANTER",v:totals.manter,c:"#0984e3",d:"Score 2.5-3.5"},
                  {k:"REVISAR",v:totals.revisar,c:"#fdcb6e",d:"Score 1.5-2.5"},
                  {k:"CORTAR",v:totals.cortar,c:"#d63031",d:"Score < 1.5"},
                ].map(r => (
                  <div key={r.k} onClick={() => {setTab("catalogo"); setRecFilter(r.k);}}
                    style={{flex:"1 1 140px", padding:16, borderRadius:14, background:`${r.c}15`,
                    border:`2px solid ${r.c}30`, cursor:"pointer", textAlign:"center"}}>
                    <div style={{fontSize:32, fontWeight:900, color:r.c}}>{r.v}</div>
                    <div style={{fontSize:13, fontWeight:700, color:r.c}}>{r.k}</div>
                    <div style={{fontSize:11, color:"#888"}}>{r.d}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", marginBottom:20}}>
              <div style={{fontSize:16, fontWeight:700, marginBottom:16}}>📊 Performance por Categoria</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
                  <thead><tr style={{borderBottom:"2px solid #eee"}}>
                    {["Categoria","SKUs","Estoque (PV)","Venda Est./mês","Lucro/mês","Cobertura","Score"].map(h =>
                      <th key={h} style={{textAlign:h==="Categoria"?"left":"right", padding:"8px 6px", color:"#888", fontWeight:700, fontSize:11, whiteSpace:"nowrap"}}>{h}</th>
                    )}
                  </tr></thead>
                  <tbody>
                    {catStats.map(c => {
                      const avgS = c.scores.reduce((a,b)=>a+b,0)/c.scores.length;
                      const cob = c.cobertura;
                      return (
                        <tr key={c.name} style={{borderBottom:"1px solid #f5f5f5", cursor:"pointer"}}
                          onClick={() => {setTab("catalogo"); setCatFilter(c.name);}}>
                          <td style={{padding:"10px 6px", fontWeight:600, whiteSpace:"nowrap"}}>
                            {CAT_EMOJI[c.name]} {c.name}
                          </td>
                          <td style={{textAlign:"right", padding:"8px 6px"}}>{c.count}</td>
                          <td style={{textAlign:"right", padding:"8px 6px", color:"#6C5CE7", fontWeight:600}}>{fmt(c.estoqueVenda)}</td>
                          <td style={{textAlign:"right", padding:"8px 6px", color:"#0984e3", fontWeight:600}}>{fmt(c.receita)}</td>
                          <td style={{textAlign:"right", padding:"8px 6px", color:"#00b894", fontWeight:600}}>{fmt(c.lucro)}</td>
                          <td style={{textAlign:"right", padding:"8px 6px"}}>
                            <span style={{background:(cob>6?"#d6303120":cob>3?"#fdcb6e20":"#00b89420"), color:cob>6?"#d63031":cob>3?"#fdcb6e":"#00b894", padding:"2px 8px", borderRadius:8, fontWeight:700, fontSize:11}}>
                              {cob.toFixed(1)}m
                            </span>
                          </td>
                          <td style={{textAlign:"right", padding:"8px 6px", fontWeight:700,
                            color: avgS>=4?"#00b894":avgS>=3?"#0984e3":"#fdcb6e"
                          }}>⭐{avgS.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{borderTop:"2px solid #333", fontWeight:800, fontSize:12}}>
                      <td style={{padding:"10px 6px"}}>TOTAL</td>
                      <td style={{textAlign:"right", padding:"8px 6px"}}>{skus.length}</td>
                      <td style={{textAlign:"right", padding:"8px 6px", color:"#6C5CE7"}}>{fmt(catStats.reduce((a,c)=>a+c.estoqueVenda,0))}</td>
                      <td style={{textAlign:"right", padding:"8px 6px", color:"#0984e3"}}>{fmt(catStats.reduce((a,c)=>a+c.receita,0))}</td>
                      <td style={{textAlign:"right", padding:"8px 6px", color:"#00b894"}}>{fmt(catStats.reduce((a,c)=>a+c.lucro,0))}</td>
                      <td></td><td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
              <div style={{fontSize:16, fontWeight:700, marginBottom:16}}>Distribuição de Preço</div>
              <div style={{display:"flex", gap:8, alignItems:"flex-end", height:140}}>
                {Object.entries(priceBuckets).map(([k,v]) => {
                  const maxV = Math.max(...Object.values(priceBuckets));
                  return (
                    <div key={k} onClick={() => {setTab("catalogo"); setPriceFilter(priceFilter===k?null:k);}}
                      style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", cursor:"pointer", gap:4}}>
                      <span style={{fontSize:12, fontWeight:700}}>{v}</span>
                      <div style={{width:"100%", borderRadius:"8px 8px 0 0", height:`${v/maxV*100}px`, minHeight:8,
                        background:priceFilter===k?"#6C5CE7":"linear-gradient(180deg, #6C5CE740, #6C5CE720)"}} />
                      <span style={{fontSize:10, color:"#888", fontWeight:600}}>{priceLabels[k]}</span>
                    </div>
                  );
                })}
              </div>
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
                      <div>📊 Margem: <b>{avgMg.toFixed(0)}%</b></div>
                      <div>⏱️ Cobert: <b style={{color: cat.cobertura>6?"#d63031":cat.cobertura>3?"#fdcb6e":"#00b894"}}>{cat.cobertura.toFixed(1)}m</b></div>
                      <div>ε: <b>{AUX.elast[cat.name] || "N/A"}</b></div>
                      <div style={{color:"#00b894"}}>✅ {ampliar}</div>
                      <div style={{color:"#d63031"}}>🔴 {cortar}</div>
                    </div>
                    <ScoreBar score={avgScore} />
                    {topSku && <div style={{fontSize:11, color:"#888", padding:8, background:"#f9f9f9", borderRadius:8, marginTop:8}}>
                      ⭐ Top: <b>{topSku.n.substring(0,30)}</b> ({topSku.sc.toFixed(1)})
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
                                  R${v.custo.toFixed(0)}
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px", color:"#0984e3", fontWeight:600}}>
                                  R${v.venda.toFixed(0)}/m
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px", color:"#00b894", fontWeight:600}}>
                                  R${v.lucro.toFixed(0)}/m
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px"}}>
                                  {(v.margem / v.skus).toFixed(0)}%
                                </td>
                                <td style={{textAlign:"right", padding:"8px 6px"}}>
                                  {(v.score / v.skus).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                            <tr style={{borderTop:"2px solid #333", fontWeight:800}}>
                              <td style={{padding:"10px 12px"}}>TOTAL</td>
                              <td style={{textAlign:"center", padding:"10px 6px"}}>{purchaseLog.length}</td>
                              <td style={{textAlign:"right", padding:"10px 6px", color:"#e17055"}}>
                                R${totalCusto.toFixed(0)}
                              </td>
                              <td style={{textAlign:"right", padding:"10px 6px", color:"#0984e3"}}>
                                R${totalVenda.toFixed(0)}/m
                              </td>
                              <td style={{textAlign:"right", padding:"10px 6px", color:"#00b894"}}>
                                R${totalLucro.toFixed(0)}/m
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
                          display:"grid", gridTemplateColumns:"40px 1fr 80px 70px 60px 60px 80px 80px 80px 60px",
                          padding:"8px 16px", fontSize:11, color:"#888", fontWeight:700, gap:4, borderBottom:"1px solid #f0f0f0"
                        }}>
                          <span>#</span><span>PRODUTO</span><span style={{textAlign:"right"}}>PV</span>
                          <span style={{textAlign:"right"}}>CUSTO</span><span style={{textAlign:"right"}}>QTD</span>
                          <span style={{textAlign:"right"}}>MG%</span><span style={{textAlign:"right"}}>SCORE</span>
                          <span style={{textAlign:"right"}}>LUCRO/M</span><span style={{textAlign:"right"}}>REC</span>
                          <span></span>
                        </div>
                        {items.map((p, idx) => (
                          <div key={idx} style={{
                            display:"grid", gridTemplateColumns:"40px 1fr 80px 70px 60px 60px 80px 80px 80px 60px",
                            padding:"10px 16px", fontSize:13, gap:4, borderBottom:"1px solid #f8f8f8",
                            alignItems:"center"
                          }}>
                            <span style={{color:"#888"}}>{idx+1}</span>
                            <div>
                              <div style={{fontWeight:600, fontSize:13}}>{p.nome}</div>
                              <div style={{fontSize:11, color:"#888"}}>{CAT_EMOJI[p.categoria]} {p.categoria} · {p.linha}</div>
                              {p.sku_ideal && p.sku_ideal !== "NENHUM" && <div style={{fontSize:10, color:"#6C5CE7", fontWeight:600}}>🎯 {p.sku_ideal}</div>}
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
                            <div style={{textAlign:"right", fontWeight:600, color:"#00b894"}}>{fmt(p.lucroMes)}</div>
                            <div style={{textAlign:"right"}}><RecBadge rec={p.rec || ""} /></div>
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
          const totRec = catStats.reduce((a,c)=>a+c.receita,0);
          const totLuc = catStats.reduce((a,c)=>a+c.lucro,0);
          const avgMg = skus.length ? skus.reduce((a,s)=>a+s.mg,0)/skus.length : 0;
          const avgSc = skus.length ? skus.reduce((a,s)=>a+s.sc,0)/skus.length : 0;
          const top5 = [...skus].sort((a,b)=>b.lu-a.lu).slice(0,5);
          const bottom5 = [...skus].sort((a,b)=>a.sc-b.sc).slice(0,5);
          const highCov = catStats.filter(c=>c.cobertura>4).sort((a,b)=>b.cobertura-a.cobertura);
          const lowCov = catStats.filter(c=>c.cobertura<1.5 && c.demanda>0);
          const sub20 = skus.filter(s=>s.pv<=20).length;
          const pctSub20 = (sub20/skus.length*100);
          const ampliarSkus = skus.filter(s=>s.rc==="AMPLIAR");
          const cortarSkus = skus.filter(s=>s.rc==="CORTAR");
          const lowMgAmpliar = skus.filter(s=>s.rc==="AMPLIAR"&&s.mg<40);
          const expansionCats = catStats.filter(c=>c.count<=4);
          const topPiCats = [...catStats].sort((a,b)=>{
            const piA = a.lucro/(a.count||1); const piB = b.lucro/(b.count||1);
            return piB-piA;
          }).slice(0,3);
          
          const sections = [
            {title:"🎯 Diagnóstico do Sortimento Atual", color:"#0984e3", items:[
              `Sortimento com ${skus.length} SKUs em ${catStats.length} categorias. Score médio ${avgSc.toFixed(2)}/5.00. ${ampliarSkus.length} SKUs AMPLIAR (${(ampliarSkus.length/skus.length*100).toFixed(0)}%), ${cortarSkus.length} CORTAR (${(cortarSkus.length/skus.length*100).toFixed(0)}%).`,
              `Receita estimada ${fmt(totRec)}/mês, lucro ${fmt(totLuc)}/mês, margem média ${avgMg.toFixed(0)}%.`,
              `${pctSub20.toFixed(0)}% dos SKUs custam ≤R$20. Meta Flying Tiger: 65-70%. ${pctSub20>=60?"✅ Dentro da faixa ideal para impulso.":"⚠️ Considere aumentar SKUs ≤R$20 para maximizar P/A."}`,
              cortarSkus.length>0 ? `🔴 ${cortarSkus.length} SKUs para CORTAR consomem espaço e capital. Top candidatos a remoção: ${cortarSkus.slice(0,3).map(s=>s.n.substring(0,25)).join(", ")}. Liberar facings para categorias com melhor Πi.` : "✅ Nenhum SKU para corte — sortimento enxuto.",
              lowMgAmpliar.length>0 ? `⚠️ ${lowMgAmpliar.length} SKUs com AMPLIAR mas margem <40%: ${lowMgAmpliar.map(s=>s.n.substring(0,20)+"("+s.mg.toFixed(0)+"%)").join(", ")}. Renegociar custo ou subir PV.` : "",
            ]},
            {title:"📈 Ações para Aumentar Vendas & GMROI", color:"#00b894", items:[
              `EXPANDIR categorias com melhor lucro/SKU: ${topPiCats.map(c=>c.name+" ("+fmt(c.lucro/c.count)+"/SKU)").join(", ")}. Cada SKU novo nessas categorias gera retorno acima da média.`,
              `GIRAR ESTOQUE: ${highCov.length} categorias com cobertura >4 meses: ${highCov.map(c=>c.name+" ("+c.cobertura.toFixed(1)+"m)").join(", ")}. Liquidar excesso com 20-30% off e reinvestir em alto giro.`,
              lowCov.length>0 ? `⚠️ Risco de ruptura: ${lowCov.map(c=>c.name+" ("+c.cobertura.toFixed(1)+"m)").join(", ")}. Reordenar urgente — ruptura de estoque em SKU AMPLIAR é perda direta de receita.` : "",
              `GMROI médio do sortimento: calcule CMV mensal e divida o lucro bruto. Meta: ≥2,0x. SKUs com GMROI <1,0x estão destruindo valor — reduzir estoque ou eliminar.`,
              `Rotação Flying Tiger: trocar 10-15% do sortimento a cada 2 meses. Clientes recorrentes (funcionários do complexo Nova América) precisam perceber novidade. Pipeline: ter sempre 5-10 amostras de novos SKUs em avaliação.`,
            ]},
            {title:"👀 Aumentar Taxa de Parada & Conversão", color:"#E84393", items:[
              `TAXA DE PARADA (meta ≥3%): A parada é o primeiro gargalo do funil. De cada 1% adicional de parada → ~15 compradores/dia extras → ~R$500/dia de receita.`,
              `Tática #1 — AROMA: Posicionar Home Fragrance e Food & Candy na borda do quiosque voltada para o corredor. Sachês abertos e chocolates à mostra perfumam e atraem. Efeito Cacau Show: aroma converte passante em curioso.`,
              `Tática #2 — COR: Agrupar produtos por paleta de cor (não por categoria). Parede rosa = beauty + papelaria rosa + brinquedo rosa. Efeito Flying Tiger: arco-íris visual para no corredor.`,
              `Tática #3 — DEMONSTRAÇÃO ATIVA: Impressora térmica imprimindo fotos de passantes (grátis). Vendedor fora do quiosque oferecendo amostra de chocolate. Criar evento, não esperar o cliente.`,
              `CONVERSÃO (meta ≥20%): De quem para, 20% precisa comprar. Cada 5% a mais de conversão → R$7-8k/mês extras.`,
              `Tática: "Zona R$10" visível (bin na entrada com 30+ SKUs a R$10). Remove barreira psicológica de preço. Daiso faz isso com 100% do sortimento. Loop pode fazer com 25-30%.`,
              `Tática: Sinalização clara de preço. Etiquetas grandes e coloridas. Cliente não pode ter dúvida do preço — dúvida = desistência em impulso.`,
            ]},
            {title:"🏪 Visual Merchandising (DNA Flying Tiger)", color:"#6C5CE7", items:[
              `LAYOUT CIRCUITO: Mesmo em 9m², criar fluxo direcional. Entrada pela lateral com "Zona R$10" → parede de papelaria/beauty → gôndola central com brinquedos/acessórios → caixa com Food & Candy e Party. Cliente vê tudo antes de pagar.`,
              `ZONAS DE COR: Não organizar por categoria. Organizar por cor/tema. "Canto rosa" (beauty + papelaria feminina), "Canto fun" (brinquedos + party), "Canto zen" (home fragrance + velas). Efeito Instagram: cliente fotografa.`,
              `VERTICALIDADE: Produtos mais baratos (R$5-15) na altura dos olhos e das mãos. Produtos caros/âncora (luminárias, kits) acima da linha dos olhos — são vitrine, não impulso. Crianças: brinquedos e Food & Candy na altura dos olhos delas (~1m).`,
              `CROSS-MERCHANDISING: Não separar categorias. Colocar borracha R$5 ao lado do caderno R$20. Lip balm R$10 ao lado do espelho R$12. Sachê R$10 ao lado da vela R$50. O cliente que pega 1 vê o complemento imediato.`,
              `CHECKOUT ZONE: Últimos 50cm antes do caixa = Food & Candy + mini acessórios R$5-10. Impulso final. "Ah, vou levar esse chocolate também." Cacau Show faz 30%+ da venda na área de checkout.`,
              `RENOVAÇÃO: Trocar posição dos displays a cada 2 semanas. O cérebro ignora o familiar. Mover papelaria da parede A para parede B custa zero e gera percepção de novidade.`,
            ]},
            {title:"🛒 Aumentar P/A e Ticket Médio", color:"#fdcb6e", items:[
              `P/A ATUAL: ${AUX.painel.pa} peças/compra. META: 2,5-3,0. Cada +0,1 no P/A → ~R$1.500/mês a mais. O P/A é o multiplicador mais poderoso do funil depois da conversão.`,
              `KITS PRONTOS: "Kit Aniversário" (vela+topo+faixa+balões = R$65), "Kit Autoestima" (lip balm+sheet mask+sachê+espelho = R$55), "Kit Volta às Aulas" (canetas+borracha+washi+stickers = R$40). Kits elevam ticket 40-60%.`,
              `SUGESTÃO ATIVA: Treinar vendedor para cada venda sugerir 1 item complementar. "Levou a borracha? Esses stickers combinam, R$8." "Presente? Inclui um sachê — fica lindo e perfumado, R$10." Cacau Show: upsell treinado em cada transação.`,
              `BUNDLING DE PREÇO: "Leve 3 por R$25" em itens de R$10. "2º item com 20% off em beauty." Incentiva a 2ª e 3ª peça. Action e Daiso usam bundling agressivamente.`,
              `PM PONDERADO: ${fmt(AUX.painel.pm_pond)}. Para subir o ticket sem subir preço: focar cross-sell de categorias com PM mais alto (Home Fragrance R$44, Beauty R$33) junto com itens de entrada.`,
              `PROGRAMA DE FIDELIDADE: Cartão físico "Compre 10, ganhe 1". Custo: R$0,20/cartão. Efeito: cliente que tem 7 carimbos compra 3 itens que não compraria para completar. ROI comprovado em varejo de impulso.`,
            ]},
            {title:"⚡ Eficiência Operacional", color:"#00cec9", items:[
              `REPOSIÇÃO INTELIGENTE: SKUs AMPLIAR = 2 pacotes no quiosque (1 display + 1 buffer). MANTER = 1 pacote. REVISAR/CORTAR = mínimo viável. Repor do depósito 2-3x/semana, não diariamente.`,
              `REGRA DOS 60 DIAS: SKU que vende <5 un/mês por 60 dias → liquidação 30% off por 30 dias → se não vendeu, doar/descartar. Capital parado é custo de oportunidade.`,
              `CONTAGEM RÁPIDA: Inventário parcial diário (10 SKUs/dia por amostragem). Inventário completo mensal. Discrepância >5%: investigar furto ou erro de registro.`,
              `HORÁRIOS DE PICO: Nova América tem 3 picos — almoço (12-14h), saída trabalho (17-19h), noite familiar (19-21h). Demonstração ativa nos picos. Reposição e organização nos vales (10-12h, 14-16h).`,
              `DADOS: Registrar TODA venda com categoria e horário. Em 30 dias, você terá curva de demanda por hora do dia, dia da semana, e categoria. Esse dado vale mais que qualquer estimativa teórica.`,
              `COMPRAS: Manter pipeline de 10-20 amostras de novos produtos sempre em trânsito. Lead time China = 30-45 dias. Planejar compra com 60 dias de antecedência. Para Food & Candy nacional: pedido semanal com distribuidor.`,
            ]},
          ];
          
          // Benchmark data: 202 items from 3 sources (Mar/2026)
          const benchmarkData = [
            {cat:"Papelaria", loop:null, tiger:22.75, daiso:12.06, miniso:34.81, tiger_r:"€1-6", daiso_r:"R$8-17", miniso_r:"R$10-140"},
            {cat:"Beauty", loop:null, tiger:20.15, daiso:14.24, miniso:35.32, tiger_r:"€2-5", daiso_r:"R$10-20", miniso_r:"R$16-75"},
            {cat:"Brinquedos", loop:null, tiger:23.40, daiso:12.99, miniso:57.13, tiger_r:"€2-6", daiso_r:"R$10-17", miniso_r:"R$30-90"},
            {cat:"Cozinha", loop:null, tiger:28.44, daiso:14.61, miniso:70.99, tiger_r:"€3-6", daiso_r:"R$12-17", miniso_r:"R$40-110"},
            {cat:"Home Fragrance", loop:null, tiger:22.75, daiso:14.66, miniso:28.74, tiger_r:"€2-6", daiso_r:"R$12-17", miniso_r:"R$15-50"},
            {cat:"Iluminação", loop:null, tiger:36.83, daiso:null, miniso:59.08, tiger_r:"€3-10", daiso_r:"—", miniso_r:"R$20-80"},
            {cat:"Acessórios", loop:null, tiger:23.56, daiso:13.59, miniso:38.82, tiger_r:"€2-5", daiso_r:"R$10-20", miniso_r:"R$13-75"},
            {cat:"Food & Candy", loop:null, tiger:15.79, daiso:18.32, miniso:null, tiger_r:"€2-4", daiso_r:"R$13-30", miniso_r:"—"},
            {cat:"Party", loop:null, tiger:14.08, daiso:null, miniso:null, tiger_r:"€2-3", daiso_r:"—", miniso_r:"—"},
          ];
          // Fill Loop PM from catStats
          benchmarkData.forEach(b => {
            const cs = catStats.find(c => c.name === b.cat);
            if (cs && cs.count > 0) {
              const catSkus = skus.filter(s => s.c === b.cat);
              if (catSkus.length) b.loop = catSkus.reduce((a,s) => a + s.pv, 0) / catSkus.length;
            }
          });
          const getPos = (b) => {
            const vals = [["Loop",b.loop],["Tiger",b.tiger],["Daiso",b.daiso],["Miniso",b.miniso]].filter(v=>v[1]!=null);
            vals.sort((a,c)=>a[1]-c[1]);
            const idx = vals.findIndex(v=>v[0]==="Loop");
            if(idx<0) return {rank:"-",total:vals.length,emoji:"⬜"};
            const rank = idx+1;
            const emoji = rank===1?"🟢":rank===vals.length?"🔴":"🟡";
            return {rank,total:vals.length,emoji};
          };

          return (
            <div>
              <div style={{background:"linear-gradient(135deg, #1e3c72, #2a5298)", borderRadius:16, padding:24, marginBottom:24, color:"white"}}>
                <div style={{fontSize:22, fontWeight:800, marginBottom:8}}>💡 Insights — Head de Vendas & VM</div>
                <div style={{fontSize:13, opacity:0.85}}>Análise do sortimento atual com recomendações baseadas em benchmarks Flying Tiger, Miniso, Daiso, Action e Cacau Show. Foco: maximizar KPIs → vendas.</div>
              </div>
              
              {sections.map((sec, si) => (
                <div key={si} style={{background:"white", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", borderLeft:`4px solid ${sec.color}`}}>
                  <div style={{fontSize:16, fontWeight:800, marginBottom:14, color:sec.color}}>{sec.title}</div>
                  <div style={{display:"flex", flexDirection:"column", gap:10}}>
                    {sec.items.filter(Boolean).map((item, ii) => (
                      <div key={ii} style={{fontSize:13, lineHeight:1.6, padding:"10px 14px", background:"#f8f9fa", borderRadius:10, color:"#2d3436"}}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              
              {/* BENCHMARK COMPETITIVO */}
              <div style={{background:"white", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", borderLeft:"4px solid #e17055"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:6, color:"#e17055"}}>📊 Benchmark Competitivo — PM por Categoria (R$)</div>
                <div style={{fontSize:11, color:"#888", marginBottom:14}}>202 itens pesquisados · Fontes: lojasminiso.com.br, flyingtiger.com (€→R$6,50), daiso.com.br · Mar/2026</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
                    <thead>
                      <tr style={{background:"#2d3436", color:"white"}}>
                        <th style={{padding:"8px 10px", textAlign:"left", borderRadius:"8px 0 0 0"}}>Categoria</th>
                        <th style={{padding:"8px 10px", textAlign:"center", background:"#6C5CE7"}}>Loop</th>
                        <th style={{padding:"8px 10px", textAlign:"center", background:"#e17055"}}>F. Tiger</th>
                        <th style={{padding:"8px 10px", textAlign:"center", background:"#00b894"}}>Daiso BR</th>
                        <th style={{padding:"8px 10px", textAlign:"center", background:"#E84393"}}>Miniso</th>
                        <th style={{padding:"8px 10px", textAlign:"center", borderRadius:"0 8px 0 0"}}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkData.map((b, i) => {
                        const pos = getPos(b);
                        const bg = i % 2 ? "#f8f9fa" : "white";
                        return (
                          <tr key={i} style={{background: bg}}>
                            <td style={{padding:"7px 10px", fontWeight:600, borderBottom:"1px solid #eee"}}>{b.cat}</td>
                            <td style={{padding:"7px 10px", textAlign:"center", fontWeight:700, color:"#6C5CE7", borderBottom:"1px solid #eee"}}>{b.loop ? `R$${b.loop.toFixed(0)}` : "—"}</td>
                            <td style={{padding:"7px 10px", textAlign:"center", color:"#e17055", borderBottom:"1px solid #eee"}}>{b.tiger ? `R$${b.tiger.toFixed(0)}` : "—"}</td>
                            <td style={{padding:"7px 10px", textAlign:"center", color:"#00b894", borderBottom:"1px solid #eee"}}>{b.daiso ? `R$${b.daiso.toFixed(0)}` : "—"}</td>
                            <td style={{padding:"7px 10px", textAlign:"center", color:"#E84393", borderBottom:"1px solid #eee"}}>{b.miniso ? `R$${b.miniso.toFixed(0)}` : "—"}</td>
                            <td style={{padding:"7px 10px", textAlign:"center", fontWeight:700, fontSize:11, borderBottom:"1px solid #eee"}}>{pos.emoji} {pos.rank}º/{pos.total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Key insights from benchmark */}
                <div style={{marginTop:14, display:"flex", flexDirection:"column", gap:8}}>
                  {[
                    benchmarkData.filter(b => {const p=getPos(b); return p.rank===p.total && p.total>1;}).length > 0 ?
                      `🔴 MAIS CARO em: ${benchmarkData.filter(b=>{const p=getPos(b);return p.rank===p.total&&p.total>1}).map(b=>b.cat).join(", ")}. Revisar SKUs >R$50 nessas categorias — puxam PM para cima e afastam da zona de impulso.` : null,
                    benchmarkData.filter(b => {const p=getPos(b); return p.rank===1 && p.total>1;}).length > 0 ?
                      `🟢 MAIS BARATO em: ${benchmarkData.filter(b=>{const p=getPos(b);return p.rank===1&&p.total>1}).map(b=>b.cat).join(", ")}. Vantagem competitiva real — comunicar "a partir de R$5" nessas categorias.` : null,
                    `📍 Daiso está no RJ (Rio Sul, ParkJacarepaguá, Nova Iguaçu) — PM R$12-18 é o concorrente de preço mais próximo. Loop se diferencia por curadoria visual, não preço.`,
                    `📍 Miniso opera 2-4x acima da Loop em todas as categorias. No Nova América (sem Miniso), Loop tem faixa R$5-20 exclusiva.`,
                    `📍 Flying Tiger PM R$15-37 é o benchmark de posicionamento ideal. 70% dos itens <€5 (R$32) gera P/A de 4-6 peças.`,
                  ].filter(Boolean).map((insight, ii) => (
                    <div key={ii} style={{fontSize:12, lineHeight:1.5, padding:"8px 12px", background:"#fff5f0", borderRadius:8, color:"#2d3436"}}>{insight}</div>
                  ))}
                </div>
              </div>

              {/* FAIXAS DE PREÇO COMPARATIVAS */}
              <div style={{background:"white", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", borderLeft:"4px solid #fdcb6e"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:14, color:"#f39c12"}}>📐 Faixas de Preço Comparativas</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%", borderCollapse:"collapse", fontSize:11}}>
                    <thead>
                      <tr style={{background:"#f39c12", color:"white"}}>
                        <th style={{padding:"7px 8px", textAlign:"left", borderRadius:"8px 0 0 0"}}>Categoria</th>
                        <th style={{padding:"7px 8px", textAlign:"center"}}>F. Tiger (EUR)</th>
                        <th style={{padding:"7px 8px", textAlign:"center"}}>Daiso BR</th>
                        <th style={{padding:"7px 8px", textAlign:"center", borderRadius:"0 8px 0 0"}}>Miniso BR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkData.map((b, i) => (
                        <tr key={i} style={{background: i%2 ? "#fffdf5" : "white"}}>
                          <td style={{padding:"6px 8px", fontWeight:600, borderBottom:"1px solid #f0ead6"}}>{b.cat}</td>
                          <td style={{padding:"6px 8px", textAlign:"center", borderBottom:"1px solid #f0ead6", fontFamily:"monospace"}}>{b.tiger_r}</td>
                          <td style={{padding:"6px 8px", textAlign:"center", borderBottom:"1px solid #f0ead6", fontFamily:"monospace"}}>{b.daiso_r}</td>
                          <td style={{padding:"6px 8px", textAlign:"center", borderBottom:"1px solid #f0ead6", fontFamily:"monospace"}}>{b.miniso_r}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{background:"white", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:16, fontWeight:800, marginBottom:14, color:"#d63031"}}>🏆 Top 5 SKUs (Lucro/mês) vs ⚠️ Bottom 5 (Score)</div>
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>
                  <div>
                    <div style={{fontSize:12, fontWeight:700, color:"#00b894", marginBottom:8}}>🏆 Top Performers</div>
                    {top5.map((s,i) => (
                      <div key={i} style={{display:"flex", justifyContent:"space-between", padding:"6px 10px", background:i%2?"#f8f9fa":"white", borderRadius:6, fontSize:12, marginBottom:2}}>
                        <span style={{fontWeight:600}}>{i+1}. {s.n.substring(0,28)}</span>
                        <span style={{color:"#00b894", fontWeight:700}}>{fmt(s.lu)}/m</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{fontSize:12, fontWeight:700, color:"#d63031", marginBottom:8}}>⚠️ Candidatos a Corte</div>
                    {bottom5.map((s,i) => (
                      <div key={i} style={{display:"flex", justifyContent:"space-between", padding:"6px 10px", background:i%2?"#ffeaea":"white", borderRadius:6, fontSize:12, marginBottom:2}}>
                        <span style={{fontWeight:600}}>{i+1}. {s.n.substring(0,28)}</span>
                        <span style={{color:"#d63031", fontWeight:700}}>⭐{s.sc.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
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
                  <span style={{fontSize:14, fontWeight:900, color:"#6C5CE7"}}>{matchedCount}/{totalSlotsN} ({progress.toFixed(0)}%)</span>
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
                  {label:"Capital Estimado", value:"R$"+totalCapital.toFixed(0), color: totalCapital > idealBudget ? "#d63031" : "#00b894", sub: totalCapital > idealBudget ? "ACIMA do budget" : ((100-totalCapital/idealBudget*100).toFixed(0)+"% abaixo")},
                  {label:"SKUs Pendentes", value:pendingCount, color:"#e17055", sub:"precisam ser comprados"},
                  {label:"PM Ideal", value:"R$"+(idealSlots.reduce((a,s)=>a+s.pv,0)/idealSlots.length).toFixed(0), color:"#6C5CE7"},
                  {label:"Mg Media", value:(idealSlots.reduce((a,s)=>a+s.mg,0)/idealSlots.length).toFixed(0)+"%", color:"#00b894"},
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
                        <div style={{fontSize:10, color:"#aaa", marginTop:3}}>R${c.capital.toFixed(0)}</div>
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
                <div style={{display:"grid", gridTemplateColumns:"36px 1fr 70px 60px 50px 50px 60px 70px", gap:10, padding:"8px 18px", fontSize:11, color:"#aaa", fontWeight:700}}>
                  <div></div><div>Produto</div><div>PV</div><div>Custo</div><div>Mg</div><div>Qtd</div><div>Capital</div><div>Linha</div>
                </div>
                {fSlots.map(s => {
                  const capItem = s.cu * s.q;
                  return (
                    <div key={s.id} style={{background:"white", borderRadius:12, padding:"12px 18px", boxShadow:"0 1px 4px rgba(0,0,0,0.03)", display:"grid", gridTemplateColumns:"36px 1fr 70px 60px 50px 50px 60px 70px", alignItems:"center", gap:10, fontSize:13, borderLeft: s.isNew ? "4px solid #fdcb6e" : s.matched ? "4px solid #00b894" : "4px solid #dfe6e9", opacity: s.matched && !s.isNew ? 0.65 : 1}}>
                      <div style={{textAlign:"center"}}>{s.matched ? (s.isNew ? <span title="Novo">&#x1F195;</span> : <span title="Comprado">&#x2705;</span>) : <span style={{color:"#ddd"}}>&#x2B1C;</span>}</div>
                      <div>
                        <div style={{fontWeight:700, fontSize:12}}>{s.n}</div>
                        <div style={{fontSize:10, color:"#888"}}>{s.c} &#xB7; {s.r}</div>
                        {s.matchedWith && <div style={{fontSize:10, color:"#00b894", fontWeight:600}}>&#x2192; {s.matchedWith}</div>}
                      </div>
                      <div style={{fontWeight:800, color:"#6C5CE7"}}>R${s.pv}</div>
                      <div style={{fontSize:11, color:"#888"}}>R${s.cu.toFixed(2)}</div>
                      <div style={{fontSize:11, fontWeight:700, color: s.mg >= 70 ? "#00b894" : s.mg >= 50 ? "#fdcb6e" : "#d63031"}}>{s.mg.toFixed(0)}%</div>
                      <div style={{fontSize:11, color:"#888"}}>{s.q}</div>
                      <div style={{fontSize:11, color:"#888"}}>R${capItem.toFixed(0)}</div>
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
