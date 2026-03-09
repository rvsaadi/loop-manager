import React from "react";

export function KPICard({ label, value, sub, color, emoji }) {
  return (
    <div style={{
      background:"white", borderRadius:16, padding:"16px 20px", minWidth:140,
      boxShadow:"0 2px 12px rgba(0,0,0,0.06)", border:`2px solid ${color||"#eee"}`,
      display:"flex", flexDirection:"column", gap:4, flex:"1 1 140px"
    }}>
      <div style={{fontSize:13, color:"#888", fontWeight:500}}>{label}</div>
      <div style={{fontSize:28, fontWeight:800, color:color||"#2d3436", letterSpacing:"-1px"}}>
        {emoji && <span style={{marginRight:4}}>{emoji}</span>}{value}
      </div>
      {sub && <div style={{fontSize:11, color:"#aaa"}}>{sub}</div>}
    </div>
  );
}
