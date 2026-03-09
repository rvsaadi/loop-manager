import React from "react";
import { REC_COLORS } from "../data/constants.js";

export function RecBadge({ rec }) {
  const c = REC_COLORS[rec] || "#aaa";
  return <span style={{
    background:c, color:"white", padding:"2px 10px", borderRadius:20,
    fontSize:11, fontWeight:700, letterSpacing:"0.5px"
  }}>{rec}</span>;
}
