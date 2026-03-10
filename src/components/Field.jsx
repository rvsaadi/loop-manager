import React, { useRef } from "react";

export function Field({ label, value, onChange, type="text", prefix, suffix, small, disabled, placeholder, error }) {
  const ref = useRef(null);
  return (
    <div style={{display:"flex", flexDirection:"column", gap:3}}>
      {label && <label style={{fontSize:11, fontWeight:600, color: error ? "#d63031" : "#888"}}>{error ? "⚠ " + label : label}</label>}
      <div style={{display:"flex", alignItems:"center", gap:0, background:disabled?"#f5f5f5":"white",
        border: error ? "2px solid #d63031" : "2px solid #eee", borderRadius:10, overflow:"hidden", transition:"border 0.2s",
        boxShadow: error ? "0 0 0 3px rgba(214,48,49,0.15)" : "none",
      }}>
        {prefix && <span style={{padding:"0 0 0 10px", fontSize:13, color:"#aaa", fontWeight:600}}>{prefix}</span>}
        <input
          ref={ref}
          type={type}
          value={value ?? ""}
          disabled={disabled}
          placeholder={placeholder || ""}
          onChange={e => onChange(type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
          style={{
            flex:1, padding: small ? "6px 10px" : "10px 12px", border:"none", outline:"none",
            fontSize:14, fontFamily:"inherit", background:"transparent", width:"100%",
            minWidth:0,
          }}
        />
        {suffix && <span style={{padding:"0 10px 0 0", fontSize:12, color:"#aaa"}}>{suffix}</span>}
      </div>
    </div>
  );
}
