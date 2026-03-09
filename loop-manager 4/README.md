# Loop Manager v3.5

Quiosque de Variedades | Gestão de Sortimento com IA

## Deploy Rápido (3 minutos)

### Opção 1: Terminal (recomendado)
```bash
cd loop-manager
chmod +x DEPLOY.sh
./DEPLOY.sh
```

### Opção 2: Manual via GitHub
1. Crie um repositório no GitHub (github.com/new)
2. Suba os arquivos deste projeto
3. No Netlify (app.netlify.com), clique "Add new site" → "Import from Git"
4. Selecione o repositório → Deploy

### Configurar API Key (obrigatório para IA)
1. No painel do Netlify → Site configuration → Environment variables
2. Adicione: `ANTHROPIC_API_KEY` = `sk-ant-sua-chave-aqui`
3. Obtenha a chave em: https://console.anthropic.com/settings/keys

## Atualizar
Peça as alterações no chat do Claude → receba ZIP atualizado → faça re-deploy.
