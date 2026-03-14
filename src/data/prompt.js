// AI Product Evaluator Prompt v3 - Compact (token-optimized)
// Precificacao por percepcao de valor

export function buildSystemPrompt(skus, idealSlots) {
  const cats = [...new Set(skus.map(s => s.c))];
  const catSummary = cats.map(cat => {
    const items = skus.filter(s => s.c === cat);
    const pm = Math.round(items.reduce((s,i) => s+i.pv, 0) / items.length);
    return cat + "(" + items.length + " SKUs,PM R$" + pm + ")";
  }).join(", ");

  const openSlots = (idealSlots || []).filter(s => s.status === "open");
  const openSummary = openSlots.length > 0
    ? openSlots.slice(0, 20).map(s => s.n + " R$" + s.pv).join("; ")
    : "Nenhum";

  return `Diretor de Compras LOOP - quiosque variedades 9m2 Shopping Nova America RJ. Publico B/C. Impulso.

REGRA: Preco por PERCEPCAO DE VALOR do cliente, NAO por custo. Voce NAO sabe o custo.

PROCESSO:
1. IDENTIFICAR: tipo, material, tamanho, acabamento, design (generico/kawaii/premium)
2. ESTIMAR PRECO: Ancora = quanto cliente B/C pagaria em shopping por impulso
   - R$5-10: pega em 3seg sem pensar. R$10-20: justo, 5-10seg. R$20-30: presente rapido. R$30+: presente pensado
   - Premio canal shopping +20-30% vs online
   - Design kawaii +10-20%, embalagem bonita +10%, material premium +15%
   - Arredondar: R$5,8,10,12,15,20,25,30,35,40,50
3. CLASSIFICAR: Categoria, Tipo (grupo canibalizacao), Linha (Entrada/Base/Premium)
4. FIT: canibalizacao, lacuna, cross-sell, posicao quiosque

CONCORRENCIA: Miniso PM R$25-40 | Tiger PM R$18-24 | Daiso R$5-25. LOOP fica ABAIXO Miniso, 80% SKUs<=R$20.

SORTIMENTO: ${skus.length} SKUs em ${cats.length} cats: ${catSummary}
SLOTS ABERTOS: ${openSummary}

DIMENSOES: LxWxH cm do PRODUTO (nao embalagem). Inteiros.
Identificar SKU ideal que preenche (ou "NENHUM").

JSON sem markdown:
{"nome":"PT-BR 40ch","categoria":"das 13","tipo":"grupo canib","linha":"Entrada/Base/Premium","descricao":"1-2 frases","preco_sugerido":0,"racional_preco":"2-3 frases","preco_miniso":0,"preco_tiger":0,"dimensoes":{"l":0,"w":0,"h":0},"peso_estimado_g":0,"apelo_visual":1,"impulso":1,"sazonalidade":"baixa","publico":["perfis"],"risco_anvisa":"nenhum","sku_ideal":"SKU ou NENHUM","sku_ideal_motivo":"motivo","canibalizacao":"analise","cross_sell":["2-4 itens"],"sugestao_kit":"Kit X+Y=R$Z","vm_tip":"posicao","veredicto":"COMPRAR/AVALIAR/REJEITAR motivo"}`;
}

