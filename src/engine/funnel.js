// Dynamic Funnel Engine - Loop Manager
// Calculates SR, Conv, P/A based on approved sortiment characteristics
// Based on Loop v11.3 Funil Dinâmico methodology

// Default reference values (calibration point)
const DEFAULTS = {
  sr_base: 3.0,       // % taxa de parada base
  conv_base: 20.0,    // % taxa de conversão base
  pa_base: 2.10,      // peças por atendimento base
  n_cats_ref: 12,     // categorias no ponto de calibração
  n_sku_ref: 119,     // SKUs no ponto de calibração
  pm_ref: 17.70,      // PM ponderado de referência (R$)
  pct_sub20_ref: 0.62, // % SKUs ≤ R$20 de referência
  alpha_sr: 0.15,     // sensibilidade parada a variedade
  alpha_conv: 0.12,   // sensibilidade conversão a amplitude
  beta_conv: 0.20,    // sensibilidade conversão a acessibilidade
  alpha_basket: 0.30, // sensibilidade P/A a preço
  gamma_cross: 0.020, // cross-sell por categoria extra
  passantes_dia: 7667,// passantes no corredor/dia
  dias_mes: 30,
};

// Caps (safety limits)
const CAPS = {
  sr_min: 1.5, sr_max: 5.0,
  conv_min: 10, conv_max: 30,
  pa_min: 1.5, pa_max: 3.5,
  f_breadth_max: 1.25,
  f_crosscat_max: 1.20,
};

export function calculateFunnel(approvedProducts, overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  
  if (!approvedProducts || approvedProducts.length === 0) {
    return {
      n_skus: 0, n_cats: 0, pm: 0, pct_sub20: 0,
      sr: cfg.sr_base, conv: cfg.conv_base, pa: cfg.pa_base,
      sr_factors: {}, conv_factors: {}, pa_factors: {},
      compradores_dia: Math.round(cfg.passantes_dia * cfg.sr_base/100 * cfg.conv_base/100),
      demanda_mes: 0, receita_mes: 0,
      passantes_dia: cfg.passantes_dia,
      cfg
    };
  }

  // --- Sortiment metrics ---
  const n_skus = approvedProducts.length;
  const cats = [...new Set(approvedProducts.map(p => p.categoria || p.c))];
  const n_cats = cats.length;
  
  // PM ponderado (by estimated demand if available, otherwise simple average)
  const totalPV = approvedProducts.reduce((s, p) => s + (Number(p.pv) || 0), 0);
  const pm = totalPV / n_skus;
  
  // % SKUs ≤ R$20
  const sub20 = approvedProducts.filter(p => (Number(p.pv) || 0) <= 20).length;
  const pct_sub20 = sub20 / n_skus;

  // --- Taxa de Parada Dinâmica ---
  // SR = SR_base × (N_cats / N_cats_ref) ^ α_sr
  const sr_raw = cfg.sr_base * Math.pow(n_cats / cfg.n_cats_ref, cfg.alpha_sr);
  const sr = Math.max(CAPS.sr_min, Math.min(CAPS.sr_max, sr_raw));
  const sr_factors = {
    variety: Math.pow(n_cats / cfg.n_cats_ref, cfg.alpha_sr),
    n_cats, n_cats_ref: cfg.n_cats_ref
  };

  // --- Conversão Dinâmica ---
  // Conv = Conv_base × f_breadth × f_access
  const f_breadth = Math.min(CAPS.f_breadth_max, Math.pow(n_skus / cfg.n_sku_ref, cfg.alpha_conv));
  const f_access = Math.pow(Math.max(0.3, pct_sub20) / cfg.pct_sub20_ref, cfg.beta_conv);
  const conv_raw = cfg.conv_base * f_breadth * f_access;
  const conv = Math.max(CAPS.conv_min, Math.min(CAPS.conv_max, conv_raw));
  const conv_factors = { f_breadth, f_access, n_skus, n_sku_ref: cfg.n_sku_ref, pct_sub20 };

  // --- P/A Dinâmico ---
  // P/A = PA_base × f_price × f_crosscat
  const f_price = pm > 0 ? Math.pow(cfg.pm_ref / pm, cfg.alpha_basket) : 1;
  const delta_cats = Math.max(0, n_cats - cfg.n_cats_ref);
  const f_crosscat = Math.min(CAPS.f_crosscat_max, 1 + cfg.gamma_cross * delta_cats);
  const pa_raw = cfg.pa_base * f_price * f_crosscat;
  const pa = Math.max(CAPS.pa_min, Math.min(CAPS.pa_max, pa_raw));
  const pa_factors = { f_price, f_crosscat, pm, pm_ref: cfg.pm_ref, delta_cats };

  // --- Funnel results ---
  const compradores_dia = Math.round(cfg.passantes_dia * (sr / 100) * (conv / 100));
  const demanda_mes = Math.round(compradores_dia * pa * cfg.dias_mes);
  const receita_mes = Math.round(compradores_dia * pa * pm * cfg.dias_mes);
  const ticket = pa * pm;

  return {
    n_skus, n_cats, pm: Math.round(pm * 100) / 100, pct_sub20,
    sr: Math.round(sr * 100) / 100,
    conv: Math.round(conv * 100) / 100,
    pa: Math.round(pa * 100) / 100,
    sr_factors, conv_factors, pa_factors,
    compradores_dia,
    demanda_mes,
    receita_mes,
    ticket: Math.round(ticket * 100) / 100,
    passantes_dia: cfg.passantes_dia,
    cfg
  };
}

export { DEFAULTS as FUNNEL_DEFAULTS };
