import React from "react";
import { CAT_COLORS, CAT_EMOJI, REC_COLORS, fmt, fmtN } from "../data/constants.js";
import { AUX } from "../data/aux.js";
import { RecBadge } from "./RecBadge.jsx";
import { ScoreBar } from "./ScoreBar.jsx";

export function ProductRow({ sku, expanded, onToggle, onOverride, readOnly }) {
  const emoji = CAT_EMOJI[sku.c] || "📦";
  return (
    <div style={{
      background:"white", borderRadius:14, marginBottom:8,
      boxShadow:"0 1px 6px rgba(0,0,0,0.04)", overflow:"hidden",
      border: expanded ? `2px solid ${CAT_COLORS[sku.c]||"#ccc"}` : "2px solid transparent"
    }}>
      <div onClick={onToggle} style={{
        display:"grid", gridTemplateColumns:"40px 1fr 70px 55px 60px 120px 90px",
        alignItems:"center", padding:"12px 16px", cursor:"pointer", gap:8,
      }}>
        <span style={{fontSize:20}}>{emoji}</span>
        <div>
          <div style={{fontWeight:600, fontSize:14}}>{sku.n}</div>
          <div style={{fontSize:11, color:"#888"}}>{sku.c} · {sku.li} · {sku.f}</div>
        </div>
        <div style={{textAlign:"right"}} onClick={e => e.stopPropagation()}>
          <input type="number" disabled={readOnly} value={sku.pv} onChange={e => onOverride(sku.i, "pv", Number(e.target.value))}
            style={{width:60, textAlign:"right", fontWeight:700, fontSize:14, border:"1px solid #eee", borderRadius:6, padding:"3px 5px", fontFamily:"inherit", background:"#f8f9fa"}} />
        </div>
        <div style={{textAlign:"right", fontSize:12, color: sku.mg>=70?"#00b894":sku.mg>=40?"#fdcb6e":"#d63031", fontWeight:600}}>{typeof sku.mg==="number"?sku.mg.toFixed(0):sku.mg}%</div>
        <div style={{textAlign:"right"}} onClick={e => e.stopPropagation()}>
          <input type="number" value={sku.qc} onChange={e => onOverride(sku.i, "qc", Number(e.target.value))}
            style={{width:52, textAlign:"right", fontSize:12, border:"1px solid #eee", borderRadius:6, padding:"3px 5px", fontFamily:"inherit", background:"#f8f9fa"}} />
        </div>
        <ScoreBar score={sku.sc} />
        <div style={{textAlign:"right"}}><RecBadge rec={sku.rc} /></div>
      </div>
      {expanded && (
        <div style={{
          padding:"12px 16px 16px", borderTop:"1px solid #f0f0f0",
          display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, fontSize:13
        }}>
          <div>
            <div style={{color:"#888", fontSize:11, marginBottom:2}}>Financeiro</div>
            <div>Custo: <b>R${sku.cu.toFixed(2)}</b></div>
            <div>Receita: <b>{fmt(sku.rv)}/m</b></div>
            <div>Lucro: <b>{fmt(sku.lu)}/m</b></div>
            <div>GMROI: <b>{sku.gm.toFixed(2)}x</b></div>
          </div>
          <div>
            <div style={{color:"#888", fontSize:11, marginBottom:2}}>Operacional</div>
            <div>Dimensões: <b>{sku.l}×{sku.w}×{sku.h}cm</b></div>
            <div>Vol: <b>{(sku.l*sku.w*sku.h).toLocaleString()}cm³</b></div>
            <div>MOQ: <b>{sku.moq}</b> | Qtd: <b>{sku.qc}</b></div>
            <div>Πi: <b>{fmtN(sku.pi)}/m³</b></div>
          </div>
          <div>
            <div style={{color:"#888", fontSize:11, marginBottom:2}}>Score</div>
            <div>Cross-Sell: <b>{sku.cs.toFixed(2)}</b></div>
            <div>ε: <b>{AUX.elast[sku.c] || "N/A"}</b></div>
            {sku.ob && <div style={{marginTop:6, padding:8, background:"#fff9e6", borderRadius:8, fontSize:11, color:"#666"}}>💡 {sku.ob}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
