// Loop Score Engine v11 - replicates spreadsheet methodology
import { AUX } from "../data/aux.js";
import { ALL_CATS } from "../data/constants.js";

export function calcScore(pv, custo, qc, dims, cat) {
  if (!pv || !custo || !cat || pv <= custo) return null;
  const margem = (pv - custo) / pv;
  const l = dims?.l || 10, w = dims?.w || 5, h = dims?.h || 5;
  const volM3 = (l * w * h) / 1e6;

  // Elasticity
  const eps = Math.abs(AUX.elast[cat] || 0.8);

  // Price ref
  let pRef = 15;
  for (const pr of AUX.priceRefs) {
    if (pv <= pr.ate) { pRef = pr.pref; break; }
  }
  const elastFactor = Math.pow(pRef / pv, eps);

  // Line multiplier
  const lineMult = pv <= 20 ? 2.0 : pv <= 50 ? 1.0 : 0.5;

  // Base demand
  const baseDem = AUX.baseDem[cat] || 4;

  // Price multiplier
  let priceMult = 1.0;
  if (pv <= 10) priceMult = 1.4;
  else if (pv <= 20) priceMult = 1.4;
  else if (pv <= 50) priceMult = 1.0;
  else priceMult = 0.7;

  const pesoRel = baseDem * lineMult * priceMult;
  const somaPesos = AUX.painel.dem_total > 0 ? 1600 : 1600;
  const demTotal = AUX.painel.dem_total || 3150;
  const demanda = (demTotal * pesoRel / somaPesos) * elastFactor;

  const receitaMes = demanda * pv;
  const lucroMes = demanda * (pv - custo);

  // Pi (profit per m3 per month)
  const pi = volM3 > 0 ? lucroMes / volM3 : 0;

  // GMROI
  const estoqueInv = custo * (qc || 50);
  const gmroi = estoqueInv > 0 ? lucroMes / estoqueInv : 0;

  // Cross-sell
  let cs = 0.5;
  const csData = AUX.csMatrix[cat];
  if (csData) {
    if (pv <= csData.l1) cs = csData.cs1;
    else if (pv <= (csData.l2 || 9999)) cs = csData.cs2;
    else cs = csData.cs3 || 0.38;
  }

  // Score absolute
  const piRef = AUX.painel.pi_ref || 50000;
  const gmroiRef = AUX.painel.gmroi_ref || 2;
  const piScore = Math.min(pi / piRef, 1) * 5 * 0.5;
  const gmroiScore = Math.min(gmroi / gmroiRef, 1) * 5 * 0.3;
  const csScore = cs * 5 * 0.2;
  const score = piScore + gmroiScore + csScore;

  // Recommendation
  let rec = "REVISAR";
  if (score >= 3.5 && margem >= 0.40) rec = "AMPLIAR";
  else if (score >= 2.5) rec = "MANTER";
  else if (score < 1.5) rec = "CORTAR";

  // Lerner optimal price
  let pOtimo = pv;
  if (eps > 1) {
    pOtimo = Math.round(eps * custo / (eps - 1));
  }

  return {
    score: Math.round(score * 100) / 100,
    rec, margem: Math.round(margem * 1000) / 10,
    demanda: Math.round(demanda * 10) / 10,
    receitaMes: Math.round(receitaMes),
    lucroMes: Math.round(lucroMes),
    pi: Math.round(pi), gmroi: Math.round(gmroi * 100) / 100, cs,
    pOtimo, piScore: Math.round(piScore*100)/100,
    gmroiScore: Math.round(gmroiScore*100)/100,
    csScore: Math.round(csScore*100)/100,
    elastFactor: Math.round(elastFactor * 100) / 100,
    pesoRel: Math.round(pesoRel * 10) / 10,
    volCm3: l * w * h,
  };
}

