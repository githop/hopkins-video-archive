#!/bin/bash
set -e

# Hopkins Video Archive - Demo Mode Script
# This script orchestrates the full stack: 
# 1. AI Inference (gnarlyvllm)
# 2. UI Build
# 3. Server SFE Compilation
# 4. Cloudflare Tunnel

PROJECT_ROOT="/home/githop/hopkins-video-archive"
GNARLY_ROOT="$PROJECT_ROOT/projects/gnarlyvllm"
DOTENV="$PROJECT_ROOT/.env"

# --- Default Configuration ---
ARCHIVE_PORT=4876

# 1. Load Environment
if [ -f "$DOTENV" ]; then
    TOKEN=$(grep "^TUNNEL_TOKEN=" "$DOTENV" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    ENV_PORT=$(grep "^ARCHIVE_PORT=" "$DOTENV" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if [ -n "$ENV_PORT" ]; then ARCHIVE_PORT=$ENV_PORT; fi
else
    echo "❌ .env file not found at $DOTENV"
    echo "Please create a .env file with TUNNEL_TOKEN=..."
    exit 1
fi

if [ -z "$TOKEN" ]; then
    echo "❌ TUNNEL_TOKEN not found in .env"
    exit 1
fi

echo "🚀 Initializing Complete Archive Stack..."

# 2. Start Inference Stack
echo "🧠 Waking up the Brain (gnarlyvllm)..."
cd "$GNARLY_ROOT"
kubectl create namespace gnarlyvllm 2>/dev/null || true
helm upgrade --install gnarlyvllm ./k8s -f k8s/values-rag-gemma4-e4b.yaml --namespace gnarlyvllm

echo "⏳ Waiting for inference models to be ready..."
kubectl wait --for=condition=Ready pods -n gnarlyvllm -l "app!=gnarly-proxy" --timeout=600s

# 3. Build UI
echo "📦 Building Frontend..."
cd "$PROJECT_ROOT/projects/hop-hv-rag/packages/ui"
bun run build

# 4. Start Archive Server
echo "🌐 Starting Search Server on port $ARCHIVE_PORT..."
# Kill any existing server on this port
fuser -k $ARCHIVE_PORT/tcp > /dev/null 2>&1 || true

# Run server directly with bun
cd "$PROJECT_ROOT/projects/hop-hv-rag"
bun run packages/search/src/server.ts --port "$ARCHIVE_PORT" &
SERVER_PID=$!

# 6. Start Tunnel
echo "☁️  Starting Cloudflare Tunnel..."
podman rm -f cf-archive-demo > /dev/null 2>&1 || true
podman run -d --name cf-archive-demo \
  --net=host \
  --rm \
  -e TUNNEL_TOKEN="$TOKEN" \
  docker.io/cloudflare/cloudflared:latest \
  tunnel run > /dev/null 2>&1

echo ""
echo "--------------------------------------------------------"
echo "✅ ARCHIVE IS LIVE!"
echo "Public Link: https://hv-rag.githop.com"
echo "Internal Port: $ARCHIVE_PORT"
echo "--------------------------------------------------------"
echo "Server logs will appear below. Press [ENTER] to shut down."
echo "--------------------------------------------------------"
echo ""

# Wait for user input
read -p ""

echo "🛑 Shutting down demo..."

# Kill the Bun server
kill $SERVER_PID

# Stop the tunnel container
podman stop cf-archive-demo

# Shutdown inference stack
cd "$GNARLY_ROOT"
helm uninstall gnarlyvllm --namespace gnarlyvllm

echo "✨ Demo offline. See you next time!"
