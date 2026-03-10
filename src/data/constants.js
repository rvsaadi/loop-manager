// UI Constants
export const CAT_COLORS = {
  "Papelaria":"#FF6B6B","Beauty":"#E84393","Brinquedos":"#6C5CE7","Cozinha":"#00B894",
  "Party":"#FDCB6E","Baby":"#74B9FF","Home Fragrance":"#A29BFE","Personal Care":"#FF9FF3",
  "Food & Candy":"#F19066","Seasonal":"#78E08F","Acessórios":"#FC427B","Tech Accessories":"#3DC1D3",
  "Iluminação":"#FFC312","Eletrônicos":"#95A5A6"
};

export const REC_COLORS = {"AMPLIAR":"#00b894","MANTER":"#0984e3","REVISAR":"#fdcb6e","CORTAR":"#d63031"};

export const CAT_EMOJI = {
  "Papelaria":"✏️","Beauty":"💄","Brinquedos":"🧸","Cozinha":"🍳","Party":"🎉","Baby":"👶",
  "Home Fragrance":"🕯️","Personal Care":"🧴","Food & Candy":"🍫","Seasonal":"🎄",
  "Acessórios":"💍","Tech Accessories":"📱","Iluminação":"💡","Eletrônicos":"🔌"
};

export const ALL_CATS = ["Papelaria","Beauty","Brinquedos","Cozinha","Party","Baby","Home Fragrance",
  "Personal Care","Food & Candy","Seasonal","Acessórios","Tech Accessories","Iluminação","Eletrônicos"];

export const fmt = (v) => v >= 1000 ? `R$${(v/1000).toFixed(1)}k` : `R$${Math.round(v)}`;
export const fmtN = (v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${Math.round(v)}`;
