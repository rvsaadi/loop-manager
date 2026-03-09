import React from "react";
import { CAT_COLORS, CAT_EMOJI, ALL_CATS } from "../data/constants.js";

export function CatBar({ cats, selected, onSelect }) {
  return (
    <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:16}}>
      <button onClick={() => onSelect(null)} style={{
        padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
        border: !selected ? "2px solid #2d3436" : "2px solid #ddd",
        background: !selected ? "#2d3436" : "white", color: !selected ? "white" : "#888"
      }}>Todas ({cats.reduce((a,c)=>a+c.count,0)})</button>
      {cats.map(c => (
        <button key={c.name} onClick={() => onSelect(c.name === selected ? null : c.name)} style={{
          padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
          border: c.name===selected ? `2px solid ${CAT_COLORS[c.name]}` : "2px solid #eee",
          background: c.name===selected ? CAT_COLORS[c.name] : "white",
          color: c.name===selected ? "white" : "#666"
        }}>{CAT_EMOJI[c.name]} {c.name} ({c.count})</button>
      ))}
    </div>
  );
}
