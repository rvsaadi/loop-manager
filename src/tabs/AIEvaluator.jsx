import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { CAT_COLORS, CAT_EMOJI, REC_COLORS, ALL_CATS, fmt, fmtN } from "../data/constants.js";
import { AUX } from "../data/aux.js";
import { BENCHMARK_DB } from "../data/benchmarks.js";
import { calcScore } from "../engine/score.js";
import { buildSystemPrompt } from "../data/prompt.js";
import { KPICard } from "../components/KPICard.jsx";
import { RecBadge } from "../components/RecBadge.jsx";
import { ScoreBar } from "../components/ScoreBar.jsx";
import { Field } from "../components/Field.jsx";

export default function AIEvaluator({ onApprove, onReject, suppliers, skus, idealSlots, prefill, onClearPrefill }) {
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [error, setError] = useState(null);

  // Manual override fields
  const [manualPv, setManualPv] = useState("");
  const [manualCusto, setManualCusto] = useState("");
  const [manualQtd, setManualQtd] = useState("");
  const [manualCat, setManualCat] = useState("");
  const [manualDims, setManualDims] = useState({l:"", w:"", h:""});
  const [isKit, setIsKit] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [editedNome, setEditedNome] = useState("");
  const [manualSku, setManualSku] = useState("");
  const [manualFornecedor, setManualFornecedor] = useState("");

  const [supplierInput, setSupplierInput] = useState("");
  const [approveAttempted, setApproveAttempted] = useState(false);

  // Computed score
  const [scoreResult, setScoreResult] = useState(null);

  // Follow-up chat about product
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading || !aiResult) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const newMsgs = [...chatMsgs, { role: "user", text: userMsg }];
    setChatMsgs(newMsgs);
    setChatLoading(true);
    try {
      // Build context about current product
      const productCtx = `Produto em avaliação: ${aiResult.nome} (${aiResult.categoria})
Preço sugerido: R$${aiResult.preco_sugerido} | Veredicto AI: ${aiResult.veredicto}
${aiResult.descricao}
${scoreResult ? `Score: ${scoreResult.score.toFixed(2)}/5 | Rec: ${scoreResult.rec} | Margem: ${scoreResult.margem}% | Demanda est: ${scoreResult.demanda.toFixed(1)}/mês | Lucro est: R$${scoreResult.lucroMes.toFixed(0)}/mês` : ""}
Benchmark matches: ${JSON.stringify(aiResult.benchmark_match || [])}
Canibalização: ${aiResult.canibalizacao || "N/A"}
Cross-sell: ${(aiResult.cross_sell || []).join(", ")}`;

      // Build conversation history for context
      const history = newMsgs.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text
      }));

      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `Você é o consultor analítico da LOOP, quiosque de variedades 9m² no Rio de Janeiro. O operador está avaliando um produto e quer tirar dúvidas. Responda de forma direta, prática e concisa (max 3-4 frases). Use dados quando possível.

PRODUTO EM AVALIAÇÃO:
${productCtx}

SORTIMENTO LOOP: ${skus.length} SKUs em ${[...new Set(skus.map(s=>s.c))].length} categorias, PM R$${(skus.reduce((a,s)=>a+s.pv,0)/skus.length).toFixed(0)}`,
          messages: history
        })
      });
      const data = await resp.json();
      const reply = data.content?.map(c => c.text || "").join("") || "Sem resposta.";
      setChatMsgs([...newMsgs, { role: "assistant", text: reply }]);
    } catch (err) {
      setChatMsgs([...newMsgs, { role: "assistant", text: "⚠️ Erro: " + (err.message || "falha na API") }]);
    }
    setChatLoading(false);
  };

  const buildLogItem = () => {
    if (!aiResult || !scoreResult) return null;
    return {
      nome: editedNome || aiResult.nome || "Produto",
      categoria: manualCat || aiResult.categoria || "",
      linha: activePv <= 20 ? "Entrada" : activePv <= 50 ? "Base" : "Premium",
      fornecedor: manualFornecedor || supplierInput || "",
      pv: activePv,
      custo: activeCu,
      margem: scoreResult.margem,
      qtd: Number(manualQtd) || 50,
      dims: {
        l: Number(manualDims.l) || aiResult?.dimensoes?.l || 10,
        w: Number(manualDims.w) || aiResult?.dimensoes?.w || 5,
        h: Number(manualDims.h) || aiResult?.dimensoes?.h || 5,
      },
      volCm3: scoreResult.volCm3,
      score: scoreResult.score,
      rec: scoreResult.rec,
      demanda: scoreResult.demanda,
      receitaMes: scoreResult.receitaMes,
      lucroMes: scoreResult.lucroMes,
      pi: scoreResult.pi,
      gmroi: scoreResult.gmroi,
      cs: scoreResult.cs,
      pOtimo: scoreResult.pOtimo,
      precoMiniso: aiResult.preco_miniso,
      precoTiger: aiResult.preco_tiger,
      veredicto: aiResult.veredicto,
      crossSell: aiResult.cross_sell || [],
      sugestaoKit: aiResult.sugestao_kit || "",
      vmTip: aiResult.vm_tip || "",
      canibalizacao: aiResult.canibalizacao || "",
      imagePreview: imagePreview,
      timestamp: new Date().toISOString(),
      _aiResult: aiResult,  // Store for re-evaluation
    };
  };

  // Recalculate score whenever inputs change
  useEffect(() => {
    const pv = Number(manualPv) || (aiResult?.preco_sugerido);
    const cu = Number(manualCusto) || 0;
    const qc = Number(manualQtd) || 50;
    const cat = manualCat || aiResult?.categoria;
    const dims = {
      l: Number(manualDims.l) || aiResult?.dimensoes?.l || 10,
      w: Number(manualDims.w) || aiResult?.dimensoes?.w || 5,
      h: Number(manualDims.h) || aiResult?.dimensoes?.h || 5,
    };
    if (pv > 0 && cu > 0 && cat) {
      const result = calcScore(pv, cu, qc, dims, cat);
      setScoreResult(result);
    } else {
      setScoreResult(null);
    }
  }, [manualPv, manualCusto, manualQtd, manualCat, manualDims, aiResult]);
  // Paste image from clipboard (desktop)
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          const reader = new FileReader();
          reader.onload = (ev) => {
            setImage(ev.target.result);
            setImagePreview(ev.target.result);
            setAiResult(null);
            setScoreResult(null);
            setError(null);
            setIsKit(false);
            setManualFornecedor("");
            setLastAction(null);
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);
  // Pre-fill from approved/rejected product (back to evaluation)
  useEffect(() => {
    if (!prefill) return;
    // Restore AI result
    if (prefill._aiResult) {
      setAiResult(prefill._aiResult);
    }
    // Restore manual fields
    if (prefill.pv) setManualPv(String(prefill.pv));
    if (prefill.custo) setManualCusto(String(prefill.custo));
    if (prefill.qtd) setManualQtd(String(prefill.qtd));
    if (prefill.categoria) setManualCat(prefill.categoria);
    if (prefill.fornecedor) { setManualFornecedor(prefill.fornecedor); setSupplierInput(prefill.fornecedor); }
    if (prefill.dims) setManualDims(prefill.dims);
    if (prefill.imagePreview || prefill.image) setImagePreview(prefill.imagePreview || prefill.image);
    setIsKit(prefill.isKit || false);
    setLastAction(null);
    if (onClearPrefill) onClearPrefill();
  }, [prefill]);



  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImage(ev.target.result);
      setImagePreview(ev.target.result);
      setAiResult(null);
      setScoreResult(null);
      setError(null);
      setIsKit(false);
      setManualFornecedor("");
      setLastAction(null);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!image) return;
    setLoading(true);
    setError(null);
    try {
      const base64 = image.split(",")[1];
      const mediaType = image.split(";")[0].split(":")[1] || "image/jpeg";

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          system: buildSystemPrompt(skus, idealSlots),
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: isKit ? "KIT/CONJUNTO vendido como unidade única. Todos os itens na imagem formam o kit. Analise para LOOP. JSON apenas." : "PRODUTO INDIVIDUAL. Se a imagem mostra vários itens iguais, é o lote/MOQ — analise 1 UNIDADE. Dimensões de 1 peça. JSON apenas." }
            ]
          }]
        })
      });

      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); } catch(e) { throw new Error("Resposta inválida do servidor: " + rawText.slice(0,200)); }
      if (data.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error)));
      if (!data.content) throw new Error("Resposta sem conteúdo: " + JSON.stringify(data).slice(0,200));

      const text = data.content.map(c => c.text || "").join("") || "";
      if (!text) throw new Error("Resposta vazia da AI");
      const clean = text.replace(/```json|```/g, "").trim();
      let parsed;
      try { parsed = JSON.parse(clean); } catch(e) { throw new Error("JSON inválido na resposta: " + clean.slice(0,300)); }

      setAiResult(parsed); setEditedNome(""); setManualSku("");
      setManualPv(parsed.preco_sugerido || "");
      setManualCat(parsed.categoria || "");
      if (parsed.dimensoes) {
        const d = parsed.dimensoes;
        setManualDims({l:d.l?String(Math.round(Number(d.l))):"",w:d.w?String(Math.round(Number(d.w))):"",h:d.h?String(Math.round(Number(d.h))):""});
      }
    } catch (err) {
      setError(err.message || "Erro na análise");
    }
    setLoading(false);
  };

  const handleReset = () => {
    setImage(null); setImagePreview(null); setAiResult(null);
    setScoreResult(null); setError(null); setApproveAttempted(false);
    setManualPv(""); setManualCusto(""); setManualQtd("");
    setManualCat(""); setManualDims({l:"",w:"",h:""}); setSupplierInput("");
    setChatMsgs([]); setChatInput(""); setChatLoading(false);
  };

  const activePv = Number(manualPv) || aiResult?.preco_sugerido || 0;
  const activeCu = Number(manualCusto) || 0;
  const activeCat = manualCat || aiResult?.categoria || "";

  return (
    <div>
      {/* Upload zone */}
      {!imagePreview ? (
        <label style={{
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          padding:60, borderRadius:20, border:"3px dashed #ccc",
          background:"rgba(255,255,255,0.8)", cursor:"pointer", transition:"all 0.3s",
          gap:16, textAlign:"center"
        }}>
          <div style={{fontSize:60}}>📸</div>
          <div style={{fontSize:18, fontWeight:700, color:"#2d3436"}}>Fotografe ou envie imagem do produto</div>
          <div style={{fontSize:13, color:"#888"}}>JPG, PNG · Toque para fototeca ou câmera · No computador: Ctrl+V para colar imagem</div>
          <input type="file" accept="image/*" onChange={handleImageUpload}
            style={{display:"none"}} />
        </label>
      ) : (
        <div>
          {/* Image + Controls row */}
          <div style={{display:"grid", gridTemplateColumns:"280px 1fr", gap:20, marginBottom:20}}>
            {/* Left: Image */}
            <div style={{position:"relative"}}>
              <img src={imagePreview} alt="Produto" style={{
                width:"100%", borderRadius:16, boxShadow:"0 4px 20px rgba(0,0,0,0.1)",
                maxHeight:300, objectFit:"contain", background:"white"
              }} />
              <button onClick={handleReset} style={{
                position:"absolute", top:8, right:8, background:"rgba(0,0,0,0.6)", color:"white",
                border:"none", borderRadius:20, padding:"4px 12px", fontSize:12, cursor:"pointer", fontWeight:600
              }}>✕ Nova foto</button>
              <div style={{display:"flex",gap:6,marginTop:10}}>
                <button onClick={()=>setIsKit(false)} style={{flex:1,padding:"8px 0",borderRadius:8,border:`2px solid ${!isKit?"#6C5CE7":"#ddd"}`,background:!isKit?"#6C5CE720":"white",color:!isKit?"#6C5CE7":"#888",fontWeight:700,fontSize:12,cursor:"pointer"}}>📦 Individual</button>
                <button onClick={()=>setIsKit(true)} style={{flex:1,padding:"8px 0",borderRadius:8,border:`2px solid ${isKit?"#E84393":"#ddd"}`,background:isKit?"#E8439320":"white",color:isKit?"#E84393":"#888",fontWeight:700,fontSize:12,cursor:"pointer"}}>🎁 Kit</button>
              </div>
              {!aiResult && !loading && (
                <button onClick={handleAnalyze} style={{
                  width:"100%", marginTop:12, padding:"14px 0", borderRadius:14,
                  background:"linear-gradient(135deg, #6C5CE7, #E84393)", color:"white",
                  border:"none", fontSize:16, fontWeight:800, cursor:"pointer",
                  boxShadow:"0 4px 15px rgba(108,92,231,0.4)"
                }}>🤖 Analisar com AI</button>
              )}
              {loading && (
                <div style={{
                  width:"100%", marginTop:12, padding:"14px 0", borderRadius:14,
                  background:"#f0f0f0", textAlign:"center", fontSize:14, color:"#888"
                }}>
                  <span style={{display:"inline-block", animation:"spin 1s linear infinite"}}>⏳</span> Analisando...
                  <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
                </div>
              )}
              {error && (
                <div style={{
                  marginTop:12, padding:12, borderRadius:12,
                  background:"#ffe0e0", color:"#c0392b", fontSize:13
                }}>⚠️ {error}</div>
              )}
            </div>

            {/* Right: AI Result or Manual inputs */}
            <div>
              {aiResult && (
                <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:16}}>
                    <span style={{fontSize:28}}>{CAT_EMOJI[aiResult.categoria] || "📦"}</span>
                    <div style={{flex:1}}>
                      <div style={{display:"flex", alignItems:"center", gap:6}}>
                        <input value={editedNome || aiResult.nome} onChange={e => setEditedNome(e.target.value)} style={{fontSize:18, fontWeight:800, border:"none", borderBottom:"2px solid #eee", background:"transparent", padding:"2px 4px", fontFamily:"inherit", width:"100%"}} />
                        <span style={{fontSize:10, color:"#aaa"}}>✏️</span>
                      </div>
                      <div style={{fontSize:13, color:"#888"}}>{aiResult.descricao}</div>
                    </div>
                    <div style={{
                      padding:"6px 16px", borderRadius:12, fontWeight:800, fontSize:16,
                      background: aiResult.veredicto?.startsWith("COMPRAR") ? "#00b89420" :
                                  aiResult.veredicto?.startsWith("REJEITAR") ? "#d6303120" : "#fdcb6e20",
                      color: aiResult.veredicto?.startsWith("COMPRAR") ? "#00b894" :
                             aiResult.veredicto?.startsWith("REJEITAR") ? "#d63031" : "#fdcb6e",
                    }}>
                      {aiResult.veredicto?.startsWith("COMPRAR") ? "✅" :
                       aiResult.veredicto?.startsWith("REJEITAR") ? "❌" : "⚠️"} {aiResult.veredicto?.split(" ")[0]}
                    </div>
                  </div>

                  {/* Price comparison - enriched benchmark panel with product matching */}
                  {(() => {
                    const cat = aiResult.categoria;
                    const b = BENCHMARK_DB[cat] || {};
                    const loopSugerido = aiResult.preco_sugerido;
                    const catSkus = skus.filter(s => s.c === cat);
                    const loopPM = catSkus.length ? (catSkus.reduce((a,s) => a + s.pv, 0) / catSkus.length).toFixed(0) : null;
                    const matches = aiResult.benchmark_match || [];
                    const matchType = aiResult.match_type || "fallback_pm";
                    const matchColors = {Tiger:"#e74c3c", Daiso:"#3498db", Miniso:"#f39c12"};

                    // Determine Loop position among matched prices
                    const matchPrices = matches.map(m=>m.price).filter(Boolean);
                    const allPrices = [...matchPrices, loopSugerido].sort((a,b)=>a-b);
                    const loopRank = allPrices.indexOf(loopSugerido) + 1;
                    const posColor = loopRank === 1 ? "#00b894" : loopRank <= Math.ceil(allPrices.length/2) ? "#fdcb6e" : "#d63031";
                    const posLabel = loopRank === 1 ? "🟢 Mais barato" : loopRank <= Math.ceil(allPrices.length/2) ? "🟡 Competitivo" : "🔴 Acima";

                    return (
                      <div style={{marginBottom:16}}>
                        {/* Match type badge */}
                        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
                          <span style={{
                            fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:12,
                            background: matchType === "direto" ? "#00b89420" : matchType === "subfaixa" ? "#0984e320" : "#fdcb6e30",
                            color: matchType === "direto" ? "#00b894" : matchType === "subfaixa" ? "#0984e3" : "#d4a017",
                          }}>
                            {matchType === "direto" ? "🎯 Match direto" : matchType === "subfaixa" ? "📐 Match subfaixa" : "📊 Fallback PM"}
                          </span>
                          <span style={{fontSize:11, color:"#888", fontStyle:"italic"}}>{aiResult.match_justificativa || ""}</span>
                        </div>

                        {/* Price cards */}
                        <div style={{display:"flex", gap:8, marginBottom:8, flexWrap:"wrap"}}>
                          {/* Loop price */}
                          <div style={{flex:1, padding:12, borderRadius:12, background:`${posColor}12`, textAlign:"center", minWidth:100, border:`2px solid ${posColor}`}}>
                            <div style={{fontSize:10, color:"#888", fontWeight:600}}>Loop (sugerido)</div>
                            <div style={{fontSize:24, fontWeight:900, color:posColor}}>R${loopSugerido}</div>
                            <div style={{fontSize:10, fontWeight:700, color:posColor}}>{posLabel}</div>
                          </div>
                          {/* Matched items */}
                          {matches.map((m, i) => (
                            <div key={i} style={{flex:1, padding:12, borderRadius:12, background:"#f8f8f8", textAlign:"center", minWidth:100, border:"1px solid #eee"}}>
                              <div style={{fontSize:10, color:matchColors[m.store]||"#888", fontWeight:700}}>{m.store}</div>
                              <div style={{fontSize:20, fontWeight:800, color:matchColors[m.store]||"#444"}}>R${m.price}</div>
                              <div style={{fontSize:9, color:"#aaa", lineHeight:1.2, maxHeight:24, overflow:"hidden"}}>{m.name}</div>
                            </div>
                          ))}
                        </div>

                        {/* Loop category context bar */}
                        <div style={{display:"flex", gap:8, alignItems:"center", padding:"8px 12px", borderRadius:10, background:"#6C5CE708", fontSize:12, flexWrap:"wrap"}}>
                          <span style={{fontWeight:700, color:"#6C5CE7"}}>📊 {cat}:</span>
                          <span>Loop PM R${loopPM || "—"} ({catSkus.length} SKUs)</span>
                          {b.tiger && <><span style={{color:"#ccc"}}>·</span><span style={{color:"#e74c3c"}}>Tiger PM R${b.tiger.toFixed(0)}</span></>}
                          {b.daiso && <><span style={{color:"#ccc"}}>·</span><span style={{color:"#3498db"}}>Daiso PM R${b.daiso.toFixed(0)}</span></>}
                          {b.miniso && <><span style={{color:"#ccc"}}>·</span><span style={{color:"#f39c12"}}>Miniso PM R${b.miniso.toFixed(0)}</span></>}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Quick stats */}
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:16, fontSize:12}}>
                    <div style={{padding:8, borderRadius:8, background:"#f9f9f9", textAlign:"center"}}>
                      <div style={{color:"#888", fontSize:10}}>Apelo Visual</div>
                      <div style={{fontWeight:700}}>{"⭐".repeat(aiResult.apelo_visual || 3)}</div>
                    </div>
                    <div style={{padding:8, borderRadius:8, background:"#f9f9f9", textAlign:"center"}}>
                      <div style={{color:"#888", fontSize:10}}>Impulso</div>
                      <div style={{fontWeight:700}}>{"🔥".repeat(aiResult.impulso || 3)}</div>
                    </div>
                    <div style={{padding:8, borderRadius:8, background:"#f9f9f9", textAlign:"center"}}>
                      <div style={{color:"#888", fontSize:10}}>ANVISA</div>
                      <div style={{fontWeight:700, color: aiResult.risco_anvisa === "nenhum" ? "#00b894" : "#e17055"}}>
                        {aiResult.risco_anvisa}
                      </div>
                    </div>
                    <div style={{padding:8, borderRadius:8, background:"#f9f9f9", textAlign:"center"}}>
                      <div style={{color:"#888", fontSize:10}}>Dimensões</div>
                      <div style={{fontWeight:700}}>{aiResult.dimensoes?.l}×{aiResult.dimensoes?.w}×{aiResult.dimensoes?.h}cm</div>
                    </div>
                  </div>

                  {/* Racional de preço */}
                  <div style={{padding:12, borderRadius:12, background:"#f0f7ff", marginBottom:12, fontSize:13}}>
                    <div style={{fontWeight:700, color:"#0984e3", marginBottom:4}}>💰 Racional de Preço</div>
                    {aiResult.racional_preco}
                  </div>
                </div>
              )}

              {/* Manual inputs - always visible after AI result */}
              {aiResult && (
                <div style={{background:"white", borderRadius:16, padding:20, marginTop:12, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:12}}>🎛️ Ajustes Manuais (o Score recalcula em tempo real)</div>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12}}>
                    <Field label="Preço de Venda" value={manualPv} onChange={setManualPv} type="number" prefix="R$" error={approveAttempted && (!manualPv || Number(manualPv) <= 0)} />
                    <Field label="Custo Unitário (R$)" value={manualCusto} onChange={setManualCusto} type="number" prefix="R$" placeholder="Ex: 3.50" error={approveAttempted && (!manualCusto || Number(manualCusto) <= 0)} />
                    <Field label="Qtd Comprada" value={manualQtd} onChange={setManualQtd} type="number" suffix="un" placeholder="Ex: 100" error={approveAttempted && (!manualQtd || Number(manualQtd) <= 0)} />
                  </div>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12}}>
                    <div style={{display:"flex", flexDirection:"column", gap:3}}>
                      <label style={{fontSize:11, fontWeight:600, color:"#888"}}>Categoria</label>
                      <select value={manualCat} onChange={e => setManualCat(e.target.value)}
                        style={{padding:"10px 12px", borderRadius:10, border:"2px solid #eee", fontSize:14, fontFamily:"inherit"}}>
                        <option value="">Selecionar...</option>
                        {ALL_CATS.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
                      </select>
                    </div>
                    <Field label="Comp (cm)" value={manualDims.l} onChange={v => setManualDims(d=>({...d, l:v}))} type="number" />
                    <Field label="Larg (cm)" value={manualDims.w} onChange={v => setManualDims(d=>({...d, w:v}))} type="number" />
                    <Field label="Alt (cm)" value={manualDims.h} onChange={v => setManualDims(d=>({...d, h:v}))} type="number" />

                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12}}>
                    <div style={{display:"flex", flexDirection:"column", gap:3}}>
                      <label style={{fontSize:11, fontWeight:600, color:"#888"}}>Fornecedor *</label>
                      <input value={manualFornecedor} onChange={e=>{setManualFornecedor(e.target.value);setSupplierInput(e.target.value);}}
                        placeholder="Digite fornecedor" style={{padding:"10px 12px", borderRadius:10, border:`2px solid ${!manualFornecedor&&manualCusto?"#e17055":"#eee"}`, fontSize:14, fontFamily:"inherit"}} />
                      {suppliers.length > 0 && <div style={{display:"flex", flexWrap:"wrap", gap:4, marginTop:4}}>
                        {suppliers.slice(0,8).map(s => (
                          <button key={s} type="button" onClick={() => {setManualFornecedor(s);setSupplierInput(s);}}
                            style={{padding:"3px 10px", borderRadius:20, border: manualFornecedor===s ? "2px solid #6C5CE7" : "1px solid #ddd", 
                            background: manualFornecedor===s ? "#6C5CE720" : "#f8f9fa", fontSize:11, cursor:"pointer", fontFamily:"inherit",
                            color: manualFornecedor===s ? "#6C5CE7" : "#666", fontWeight: manualFornecedor===s ? 700 : 400}}>{s}</button>
                        ))}
                      </div>}
                    </div>
                    <div style={{display:"flex", flexDirection:"column", gap:3}}>
                      <label style={{fontSize:11, fontWeight:600, color:"#888"}}>Linha (auto)</label>
                      <div style={{padding:"10px 12px", borderRadius:10, border:"2px solid #eee", fontSize:14, background:"#f8f9fa", color:"#555"}}>
                        {Number(manualPv)<=20?"Entrada":Number(manualPv)<=50?"Base":"Premium"}
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Score result - full width */}
          {scoreResult && aiResult && (
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:20}}>
              {/* Left: Score breakdown */}
              <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16}}>
                  <div style={{fontSize:16, fontWeight:800}}>📊 Score Loop v11</div>
                  <RecBadge rec={scoreResult.rec} />
                </div>

        

        <div style={{textAlign:"center", marginBottom:20}}>
                  <div style={{fontSize:52, fontWeight:900,
                    color: scoreResult.score >= 4 ? "#00b894" : scoreResult.score >= 3 ? "#0984e3" :
                           scoreResult.score >= 2 ? "#fdcb6e" : "#d63031"
                  }}>{scoreResult.score.toFixed(2)}</div>
                  <div style={{fontSize:13, color:"#888"}}>de 5.00</div>
                  <ScoreBar score={scoreResult.score} />
                </div>

                {/* Score decomposition */}
                <div style={{fontSize:13}}>
                  <div style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #f5f5f5"}}>
                    <span>Πi (Lucro/m³) — 50%</span>
                    <span style={{fontWeight:700}}>{scoreResult.piScore.toFixed(2)} <span style={{color:"#888", fontWeight:400}}>/ 2.50</span></span>
                  </div>
                  <div style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #f5f5f5"}}>
                    <span>GMROI — 30%</span>
                    <span style={{fontWeight:700}}>{scoreResult.gmroiScore.toFixed(2)} <span style={{color:"#888", fontWeight:400}}>/ 1.50</span></span>
                  </div>
                  <div style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #f5f5f5"}}>
                    <span>Cross-Sell — 20%</span>
                    <span style={{fontWeight:700}}>{scoreResult.csScore.toFixed(2)} <span style={{color:"#888", fontWeight:400}}>/ 1.00</span></span>
                  </div>
                </div>

                {/* Key metrics */}
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:16}}>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Margem</div>
                    <div style={{fontSize:18, fontWeight:800, color: scoreResult.margem >= 60 ? "#00b894" : "#e17055"}}>
                      {scoreResult.margem}%
                    </div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Demanda est.</div>
                    <div style={{fontSize:18, fontWeight:800}}>{scoreResult.demanda.toFixed(1)}/m</div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Lucro est.</div>
                    <div style={{fontSize:18, fontWeight:800, color:"#00b894"}}>{fmt(scoreResult.lucroMes)}/m</div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Receita est.</div>
                    <div style={{fontSize:18, fontWeight:800}}>{fmt(scoreResult.receitaMes)}/m</div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Πi</div>
                    <div style={{fontSize:18, fontWeight:800}}>{fmtN(scoreResult.pi)}</div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>GMROI</div>
                    <div style={{fontSize:18, fontWeight:800}}>{scoreResult.gmroi.toFixed(2)}x</div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Preço Ótimo (Lerner)</div>
                    <div style={{fontSize:18, fontWeight:800, color:"#6C5CE7"}}>R${scoreResult.pOtimo}</div>
                  </div>
                  <div style={{padding:10, borderRadius:10, background:"#f9f9f9"}}>
                    <div style={{fontSize:10, color:"#888"}}>Vol. produto</div>
                    <div style={{fontSize:18, fontWeight:800}}>{scoreResult.volCm3}cm³</div>
                  </div>
                </div>

                {/* Margem warning */}
                {scoreResult.margem < 40 && (
                  <div style={{marginTop:12, padding:10, borderRadius:10, background:"#ffe0e0", fontSize:12, color:"#c0392b"}}>
                    ⚠️ Margem abaixo de 40% — produto NÃO qualifica para AMPLIAR mesmo com score alto
                  </div>
                )}
              </div>

              {/* Right: AI Insights */}
              <div style={{display:"flex", flexDirection:"column", gap:12}}>
                {/* Canibalizacao */}
                <div style={{background:"white", borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>🎯 Canibalização</div>
                  <div style={{fontSize:13, color:"#444", lineHeight:1.5}}>{aiResult.canibalizacao}</div>
                </div>

                {/* Cross-sell */}
                <div style={{background:"white", borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>🔗 Cross-Sell Sugerido</div>
                  <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                    {(aiResult.cross_sell || []).map((item, idx) => (
                      <span key={idx} style={{
                        padding:"4px 12px", borderRadius:20, background:"#6C5CE710",
                        color:"#6C5CE7", fontSize:12, fontWeight:600
                      }}>{item}</span>
                    ))}
                  </div>
                </div>

                {/* Kit suggestion */}
                <div style={{background:"white", borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>🎁 Sugestão de Kit</div>
                  <div style={{fontSize:13, color:"#444", lineHeight:1.5}}>{aiResult.sugestao_kit}</div>
                </div>

                {/* VM Tip */}
                <div style={{background:"linear-gradient(135deg, #fff9e6, #fff3cd)", borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>🏪 Visual Merchandising</div>
                  <div style={{fontSize:13, color:"#444", lineHeight:1.5}}>{aiResult.vm_tip}</div>
                </div>

                {/* Publico */}
                <div style={{background:"white", borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>👥 Público-Alvo</div>
                  <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                    {(aiResult.publico || []).map((p, idx) => (
                      <span key={idx} style={{
                        padding:"4px 12px", borderRadius:20, background:"#E8439310",
                        color:"#E84393", fontSize:12, fontWeight:600
                      }}>{p}</span>
                    ))}
                  </div>
                </div>

                
                {/* SKU Ideal Match */}
                {aiResult.sku_ideal && (
                  <div style={{
                    padding:12, borderRadius:12, marginBottom:12,
                    background: aiResult.sku_ideal !== "NENHUM" ? "#00b89415" : "#fdcb6e15",
                    border: `2px solid ${aiResult.sku_ideal !== "NENHUM" ? "#00b89440" : "#fdcb6e40"}`
                  }}>
                    <div style={{fontWeight:700, fontSize:14, marginBottom:4}}>
                      {aiResult.sku_ideal !== "NENHUM" ? "🎯" : "⚠️"} SKU: 
                      <select value={manualSku || aiResult.sku_ideal || ""} onChange={e => setManualSku(e.target.value)} style={{fontSize:12, padding:"2px 6px", borderRadius:4, border:"1px solid #ddd", marginLeft:4}}>
                        <option value={aiResult.sku_ideal || ""}>{aiResult.sku_ideal || "Auto"}</option>
                        {idealSlots && idealSlots.filter(s => !s.matched && s.c === (manualCat||aiResult?.categoria)).map(s => (
                          <option key={s.sku||s.id} value={s.sku||"SKU"+String(s.id).padStart(3,"0")}>{s.sku||"SKU"+String(s.id).padStart(3,"0")} - {s.n} (R${s.pv})</option>
                        ))}
                      </select>
                    </div>
                    <div style={{fontSize:13, color:"#555"}}>{aiResult.sku_ideal_motivo}</div>
                    {aiResult.sku_ideal === "NENHUM" && (
                      <div style={{fontSize:11, color:"#e17055", marginTop:4, fontWeight:600}}>
                        Este produto está FORA do sortimento ideal. Se aprovado, será marcado como compra extra.
                      </div>
                    )}
                  </div>
                )}

                {/* Veredicto full */}
                <div style={{
                  background: aiResult.veredicto?.startsWith("COMPRAR") ? "#00b89415" :
                              aiResult.veredicto?.startsWith("REJEITAR") ? "#d6303115" : "#fdcb6e15",
                  borderRadius:16, padding:16, border: `2px solid ${
                    aiResult.veredicto?.startsWith("COMPRAR") ? "#00b89440" :
                    aiResult.veredicto?.startsWith("REJEITAR") ? "#d6303140" : "#fdcb6e40"
                  }`
                }}>
                  <div style={{fontSize:14, fontWeight:700, marginBottom:6}}>📋 Veredicto</div>
                  <div style={{fontSize:13, lineHeight:1.5}}>{aiResult.veredicto}</div>
                </div>
                {!lastAction && <div style={{display:"flex",gap:8,marginTop:12}}>
                  {(!manualCusto||!manualQtd||!manualFornecedor)?<div style={{flex:1,padding:12,background:"#fdcb6e20",border:"2px solid #fdcb6e40",borderRadius:10,textAlign:"center",fontSize:12,color:"#888"}}>⚠️ Preencha Custo, Qtd e Fornecedor para comprar</div>
                  :<button onClick={()=>{setLastAction("aprovado");const item=buildLogItem();if(item&&onApprove)onApprove({...item,sku_ideal:manualSku||aiResult.sku_ideal,sku_ideal_motivo:aiResult.sku_ideal_motivo,image:imagePreview,isKit});}} style={{flex:1,padding:12,background:"#00b894",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:14}}>✅ COMPRAR</button>}
                  <button onClick={()=>{setLastAction("rejeitado");const item=buildLogItem();if(onReject)onReject(item||{nome:aiResult.nome,categoria:manualCat,pv:Number(manualPv),veredicto:aiResult.veredicto,fornecedor:manualFornecedor});}} style={{flex:1,padding:12,background:"#d63031",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:14}}>❌ REJEITAR</button>
                </div>}
                {lastAction && (
                  <div style={{marginTop:12, padding:16, borderRadius:12, textAlign:"center",
                    background: lastAction === "aprovado" ? "#f0fdf4" : "#fef2f2",
                    border: `2px solid ${lastAction === "aprovado" ? "#bbf7d0" : "#fecaca"}`}}>
                    <div style={{fontSize:24, marginBottom:8}}>{lastAction === "aprovado" ? "✅" : "❌"}</div>
                    <div style={{fontSize:14, fontWeight:700, color: lastAction === "aprovado" ? "#166534" : "#991b1b"}}>
                      Produto {lastAction}!
                    </div>
                    <div style={{display:"flex", gap:8, justifyContent:"center", marginTop:12}}>
                      <button onClick={() => setLastAction(null)} style={{padding:"10px 20px", borderRadius:10, border:"2px solid #6C5CE7", background:"white", color:"#6C5CE7", fontWeight:700, cursor:"pointer", fontSize:13}}>
                        🔙 Voltar à avaliação
                      </button>
                      <button onClick={handleReset} style={{padding:"10px 20px", borderRadius:10, border:"2px solid #888", background:"white", color:"#888", fontWeight:700, cursor:"pointer", fontSize:13}}>
                        📸 Nova foto
                      </button>
                    </div>
                  </div>
                )}

                {/* Supplier + Actions */}
                {/* AI Follow-up Chat */}
                <div style={{background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.06)", gridColumn:"1 / -1"}}>
                  <div style={{fontSize:14, fontWeight:800, marginBottom:12, display:"flex", alignItems:"center", gap:8}}>
                    <span style={{fontSize:20}}>💬</span> Perguntar sobre este produto
                    {chatMsgs.length > 0 && <span style={{fontSize:11, color:"#888", fontWeight:400}}>({chatMsgs.filter(m=>m.role==="user").length} perguntas)</span>}
                  </div>

                  {chatMsgs.length > 0 && (
                    <div style={{maxHeight:280, overflowY:"auto", marginBottom:12, display:"flex", flexDirection:"column", gap:8, padding:12, borderRadius:12, background:"#fafafa"}}>
                      {chatMsgs.map((m, i) => (
                        <div key={i} style={{
                          alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                          maxWidth:"85%", padding:"10px 14px", borderRadius:14,
                          background: m.role === "user" ? "#6C5CE7" : "white",
                          color: m.role === "user" ? "white" : "#333",
                          fontSize:13, lineHeight:1.5, whiteSpace:"pre-wrap",
                          boxShadow: m.role === "assistant" ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                          borderBottomRightRadius: m.role === "user" ? 4 : 14,
                          borderBottomLeftRadius: m.role === "assistant" ? 4 : 14,
                        }}>{m.text}</div>
                      ))}
                      {chatLoading && (
                        <div style={{alignSelf:"flex-start", padding:"10px 14px", borderRadius:14, background:"white", fontSize:13, color:"#888", boxShadow:"0 1px 4px rgba(0,0,0,0.08)"}}>
                          <span style={{display:"inline-block", animation:"pulse 1.5s ease-in-out infinite"}}>💭</span> Pensando...
                          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{display:"flex", gap:8}}>
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                      placeholder="Ex: Qual MOQ ideal? Risco de canibalizar borrachas?"
                      style={{flex:1, padding:"12px 16px", borderRadius:12, border:"2px solid #eee", fontSize:14, fontFamily:"inherit", outline:"none"}}
                    />
                    <button onClick={handleChatSend} disabled={chatLoading || !chatInput.trim()}
                      style={{
                        padding:"12px 20px", borderRadius:12, border:"none", fontSize:14, fontWeight:800,
                        background: chatLoading || !chatInput.trim() ? "#eee" : "linear-gradient(135deg, #6C5CE7, #E84393)",
                        color: chatLoading || !chatInput.trim() ? "#aaa" : "white",
                        cursor: chatLoading || !chatInput.trim() ? "default" : "pointer"
                      }}>🚀</button>
                  </div>

                  {chatMsgs.length === 0 && (
                    <div style={{display:"flex", gap:6, marginTop:10, flexWrap:"wrap"}}>
                      {["Qual o MOQ ideal para testar?","Risco de canibalizar SKUs existentes?","Melhor posição no quiosque?","Vale importar ou comprar nacional?"].map((q, i) => (
                        <button key={i} onClick={() => setChatInput(q)}
                          style={{padding:"6px 12px", borderRadius:20, border:"1px solid #e0e0e0", background:"white", fontSize:11, color:"#666", cursor:"pointer", fontFamily:"inherit"}}
                        >{q}</button>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== MAIN APP ===== */
