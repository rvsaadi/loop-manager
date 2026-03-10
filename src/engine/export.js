// XLS Export - HTML table format compatible with Excel
// Matches the format from loop_compras_2026-02-27.xls

export function exportToXLSX(data, filename) {
  if (!data.length) return;
  
  const REC_COLORS = { AMPLIAR:"#C6EFCE", MANTER:"#BDD7EE", REVISAR:"#FCE4D6", CORTAR:"#FFC7CE" };
  
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>';
  html += '<x:ExcelWorksheet><x:Name>Compras Loop</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>';
  html += '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>';
  html += '<body><table border="1" style="border-collapse:collapse;font-family:Calibri;font-size:11pt">';
  
  // Header row
  const headers = ["#","Nome","Fornecedor","Categoria","Linha","PV (R$)","Custo (R$)","Margem%","MOQ","L","W","H","Vol(cm³)","Score","Rec","Dem/m","Receita/m","Lucro/m","Πi","GMROI","CS","P.Ótimo","Veredicto","Detalhes"];
  html += '<tr style="background:#2d3436;color:white;font-weight:bold">';
  headers.forEach(h => { html += `<td style="padding:6px 8px">${h}</td>`; });
  html += '</tr>';
  
  // Data rows
  let totRev = 0, totLuc = 0, totInv = 0;
  data.forEach((d, i) => {
    const bg = REC_COLORS[d.rec] || "#fff";
    const vol = ((d.l||10) * (d.w||5) * (d.h||5));
    const inv = (d.custo||0) * (d.qtd||0);
    totRev += (d.rv||0);
    totLuc += (d.lu||0);
    totInv += inv;
    const details = [d.veredicto||"", d.canibalizacao ? "| " + d.canibalizacao : "", d.vm_tip ? "| " + d.vm_tip : ""].filter(Boolean).join(" ");
    
    html += `<tr style="background:${bg}">`;
    html += `<td>${i+1}</td>`;
    html += `<td>${d.nome||""}</td>`;
    html += `<td>${d.fornecedor||""}</td>`;
    html += `<td>${d.categoria||""}</td>`;
    html += `<td>${d.linha||""}</td>`;
    html += `<td>R$ ${d.pv||""}</td>`;
    html += `<td>R$ ${(d.custo||0).toFixed?.(2)||""}</td>`;
    html += `<td>${d.margem ? (d.margem*100).toFixed(1)+"%" : ""}</td>`;
    html += `<td>${d.qtd||""}</td>`;
    html += `<td>${d.l||""}</td>`;
    html += `<td>${d.w||""}</td>`;
    html += `<td>${d.h||""}</td>`;
    html += `<td>${vol}</td>`;
    html += `<td>${d.score ? d.score.toFixed(2) : ""}</td>`;
    html += `<td>${d.rec||""}</td>`;
    html += `<td>${d.dm ? d.dm.toFixed(1) : ""}</td>`;
    html += `<td>R$ ${d.rv ? Math.round(d.rv) : ""}</td>`;
    html += `<td>R$ ${d.lu ? Math.round(d.lu) : ""}</td>`;
    html += `<td>R$ ${d.pi ? Math.round(d.pi).toLocaleString() : ""}</td>`;
    html += `<td>${d.gm ? d.gm.toFixed(2) : ""}</td>`;
    html += `<td>${d.cs||""}</td>`;
    html += `<td>R$ ${d.preco_otimo||d.pv||""}</td>`;
    html += `<td>${d.veredicto||""}</td>`;
    html += `<td>${details}</td>`;
    html += '</tr>';
  });
  
  // TOTAL row
  const avgMg = data.reduce((s,d) => s + (d.margem||0), 0) / data.length;
  const avgSc = data.reduce((s,d) => s + (d.score||0), 0) / data.length;
  html += `<tr style="background:#f1f1f1;font-weight:bold">`;
  html += `<td></td><td>TOTAL (${data.length} SKUs)</td><td></td><td></td><td></td><td></td>`;
  html += `<td>Inv: R$ ${totInv.toFixed(0)}</td><td>${(avgMg*100).toFixed(1)}%</td>`;
  html += `<td></td><td></td><td></td><td></td><td></td>`;
  html += `<td>${avgSc.toFixed(2)}</td><td></td><td></td>`;
  html += `<td>R$ ${Math.round(totRev)}</td><td>R$ ${Math.round(totLuc)}</td>`;
  html += `<td></td><td></td><td></td><td></td><td></td><td></td>`;
  html += '</tr>';
  
  html += '</table></body></html>';
  
  const blob = new Blob(["\uFEFF" + html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (filename || "loop_compras").replace(/\.csv$/, ".xls");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
