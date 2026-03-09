#!/bin/bash
# ==============================================
# Loop Manager - Deploy para Netlify
# Execute este script no terminal (Mac/Linux)
# ==============================================

echo "🔄 Loop Manager - Deploy Automático"
echo "===================================="
echo ""

# 1. Check if netlify-cli is installed
if ! command -v netlify &> /dev/null; then
    echo "📦 Instalando Netlify CLI..."
    npm install -g netlify-cli
fi

# 2. Login to Netlify (opens browser)
echo ""
echo "🔑 Fazendo login no Netlify (vai abrir o navegador)..."
netlify login

# 3. Build the project
echo ""
echo "🔨 Buildando o projeto..."
npm install
npm run build

# 4. Create new site and deploy
echo ""
echo "🚀 Fazendo deploy..."
netlify init --manual
netlify deploy --prod --dir=dist --functions=netlify/functions

echo ""
echo "✅ Deploy completo!"
echo ""
echo "⚠️  IMPORTANTE: Configure a API key do Claude:"
echo "   1. Abra o painel do Netlify (a URL apareceu acima)"
echo "   2. Vá em: Site configuration → Environment variables"
echo "   3. Adicione: ANTHROPIC_API_KEY = sk-ant-sua-chave-aqui"
echo "   4. Clique 'Save'"
echo ""
echo "🔑 Para obter uma API key: https://console.anthropic.com/settings/keys"
