// Loop Score Engine v11.4 - Fully continuous demand model
// Demand is ALWAYS monotonically decreasing with price. No steps, no jumps.
import { AUX } from "../data/aux.js";
import { ALL_CATS } from "../data/constants.js";

// Category reference prices (median of typical range for each category)
const CAT_PREF = {
  "Papelaria": 12, "Beauty": 25, "Brinquedos": 20, "Cozinha": 15,
  "Party": 18, "Baby": 25, "Home Fragrance": 20, "Personal Care": 18,
  "Food & Candy": 12, "Seasonal": 18, "Acessórios": 15, "Tech Accessories": 18,
  "Iluminação": 50, "Eletrônicos": 100
};

export function calcScore(pv, custo, qc, dims, cat) {
  if (!pv || !custo || !cat || pv <= custo) return null;
  const margem = (pv - custo) / pv;
  const l = dims?.l || 10, w = dims?.w || 5, h = dims?.h || 5;
  const volM3 = (l * w * h) / 1e6;

  // Elasticity for this category
  const eps = Math.abs(AUX.elast[cat] || 0.8);

  // Category reference price (continuous)
  const pRef = CAT_PREF[cat] || 15;

  // Elasticity factor: (pRef / pv)^ε — ALWAYS decreasing with pv
  const elastFactor = Math.pow(pRef / pv, eps);

  // Line multiplier: CONTINUOUS function (20/pv)^0.5, capped [0.3, 2.5]
  // Cheap items (R$5) get 2.0x boost, R$20 = 1.0x (neutral), R$50 = 0.63x
  const lineMult = Math.max(0.3, Math.min(2.5, Math.pow(20 / pv, 0.5)));

  // Base demand weight for category
  const baseDem = AUX.baseDem[cat] || 4;

  // Relative weight (fully continuous)
  const pesoRel = baseDem * lineMult;
  const somaPesos = 1200;
  const demTotal = AUX.painel.dem_total || 3150;
  const demanda = (demTotal * pesoRel / somaPesos) * elastFactor;

  const receitaMes = demanda * pv;
  const lucroMes = demanda * (pv - custo);

  // Pi (profit per m3 per month)
  const pi = volM3 > 0 ? lucroMes / volM3 : 0;

  // GMROI
  const estoqueInv = custo * (qc || 50);
  const gmroi = estoqueInv > 0 ? lucroMes / estoqueInv : 0;

  // Cross-sell score
  let cs = 0.5;
  const csData = AUX.csMatrix[cat];
  if (csData) {
    if (pv <= csData.l1) cs = csData.cs1;
    else if (pv <= (csData.l2 || 9999)) cs = csData.cs2;
    else cs = csData.cs3 || 0.38;
  }

  // Score absolute (patamares fixos)
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

  const dem = Math.round(demanda * 10) / 10;
  const rec_mes = Math.round(receitaMes);
  const luc_mes = Math.round(lucroMes);

  return {
    score: Math.round(score * 100) / 100,
    rec,
    margem: Math.round(margem * 1000) / 10, margin: margem,
    demanda: dem, demand: dem,
    receitaMes: rec_mes, revenue: rec_mes,
    lucroMes: luc_mes, profit: luc_mes,
    pi: Math.round(pi), gmroi: Math.round(gmroi * 100) / 100, cs,
    pOtimo, optPrice: pOtimo,
    piScore: Math.round(piScore * 100) / 100,
    gmroiScore: Math.round(gmroiScore * 100) / 100,
    csScore: Math.round(csScore * 100) / 100,
    elastFactor: Math.round(elastFactor * 100) / 100,
    lineMult: Math.round(lineMult * 100) / 100,
    pesoRel: Math.round(pesoRel * 10) / 10,
    volCm3: l * w * h,
    pRef,
  };
}
