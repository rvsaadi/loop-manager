import React from "react";
import { REC_COLORS } from "../data/constants.js";

export function ScoreBar({ score, max=5 }) {
  const pct = Math.min(score / max * 100, 100);
  const color = score >= 4 ? "#00b894" : score >= 3 ? "#0984e3" : score >= 2 ? "#fdcb6e" : "#d63031";
  return (
    <div style={{display:"flex", alignItems:"center", gap:8}}>
      <div style={{flex:1, height:8, background:"#f0f0f0", borderRadius:4, overflow:"hidden", minWidth:60}}>
        <div style={{width:`${pct}%`, height:"100%", background:color, borderRadius:4, transition:"width 0.3s"}} />
      </div>
      <span style={{fontSize:13, fontWeight:700, color, minWidth:30}}>{score.toFixed(2)}</span>
    </div>
  );
}
