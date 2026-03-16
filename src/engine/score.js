// Loop Score Engine v11.5 - Continuous demand + pricing strategy
// Demand ALWAYS monotonically decreasing with price. No steps.
// Includes Lerner optimal + Chamariz (traffic driver) pricing.
import { AUX } from "../data/aux.js";

// Category reference prices
const CAT_PREF = {
  "Papelaria": 12, "Beauty": 25, "Brinquedos": 20, "Cozinha": 15,
  "Party": 18, "Baby": 25, "Home Fragrance": 20, "Personal Care": 18,
  "Food & Candy": 12, "Seasonal": 18, "Acessórios": 15, "Tech Accessories": 18,
  "Iluminação": 50, "Eletrônicos": 100
};

// Simulate profit at a given price point
function simulateProfit(testPv, custo, baseDem, demTotal, somaPesos, pRef, eps) {
  const lineMult = Math.max(0.3, Math.min(2.5, Math.pow(20 / testPv, 0.5)));
  const elastFactor = Math.pow(pRef / testPv, eps);
  const pesoRel = baseDem * lineMult;
  const dem = (demTotal * pesoRel / somaPesos) * elastFactor;
  const profit = dem * (testPv - custo);
  const revenue = dem * testPv;
  return { pv: testPv, dem, profit, revenue, margem: (testPv - custo) / testPv };
}

export function calcScore(pv, custo, qc, dims, cat) {
  if (!pv || !custo || !cat || pv <= custo) return null;
  const margem = (pv - custo) / pv;
  const l = dims?.l || 10, w = dims?.w || 5, h = dims?.h || 5;
  const volM3 = (l * w * h) / 1e6;
  const eps = Math.abs(AUX.elast[cat] || 0.8);
  const pRef = CAT_PREF[cat] || 15;
  const elastFactor = Math.pow(pRef / pv, eps);
  const lineMult = Math.max(0.3, Math.min(2.5, Math.pow(20 / pv, 0.5)));
  const baseDem = AUX.baseDem[cat] || 4;
  const pesoRel = baseDem * lineMult;
  const somaPesos = 1200;
  const demTotal = AUX.painel.dem_total || 3150;
  const demanda = (demTotal * pesoRel / somaPesos) * elastFactor;
  const receitaMes = demanda * pv;
  const lucroMes = demanda * (pv - custo);
  const pi = volM3 > 0 ? lucroMes / volM3 : 0;
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

  // === PRICING STRATEGY ===
  // Simulate profit curve from custo+1 to custo*5 in R$1 steps
  const minTest = Math.ceil(custo) + 1;
  const maxTest = Math.min(Math.round(custo * 5), 200);
  let bestProfit = { pv: pv, profit: 0 };
  let bestVolume = { pv: minTest, dem: 0 };
  const profitCurve = [];

  for (let p = minTest; p <= maxTest; p++) {
    const sim = simulateProfit(p, custo, baseDem, demTotal, somaPesos, pRef, eps);
    profitCurve.push(sim);
    if (sim.profit > bestProfit.profit) bestProfit = sim;
    if (p === minTest || sim.dem > bestVolume.dem) bestVolume = sim;
  }

  // Lerner theoretical (only meaningful for ε > 1)
  const lernerPrice = eps > 1 ? Math.round(eps * custo / (eps - 1)) : null;

  // Practical optimal (from simulation - works for ALL elasticities)
  const pOtimo = bestProfit.pv;

  // Chamariz price: price that maximizes demand while keeping margem ≥ 30%
  const minMargem = 0.30;
  const chamarizPrice = Math.ceil(custo / (1 - minMargem));
  const chamarizSim = simulateProfit(chamarizPrice, custo, baseDem, demTotal, somaPesos, pRef, eps);

  // Current vs optimal comparison
  const currentProfit = lucroMes;
  const optimalProfit = bestProfit.profit;
  const uplift = currentProfit > 0 ? ((optimalProfit - currentProfit) / currentProfit * 100) : 0;

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
    piScore: Math.round(piScore * 100) / 100,
    gmroiScore: Math.round(gmroiScore * 100) / 100,
    csScore: Math.round(csScore * 100) / 100,
    elastFactor: Math.round(elastFactor * 100) / 100,
    lineMult: Math.round(lineMult * 100) / 100,
    pesoRel: Math.round(pesoRel * 10) / 10,
    volCm3: l * w * h,
    pRef, eps,
    // Pricing strategy
    pOtimo,           // Price that maximizes monthly profit (simulated)
    optPrice: pOtimo, // Alias
    lernerPrice,      // Theoretical Lerner (null if ε ≤ 1)
    chamarizPrice,    // Min price with ≥30% margin (traffic driver)
    chamarizDemanda: Math.round(chamarizSim.dem * 10) / 10,
    chamarizLucro: Math.round(chamarizSim.profit),
    optDemanda: Math.round(bestProfit.dem * 10) / 10,
    optLucro: Math.round(bestProfit.profit),
    uplift: Math.round(uplift * 10) / 10, // % profit uplift vs current price
  };
}
