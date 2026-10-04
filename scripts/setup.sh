#!/bin/bash

# Wayfinderr - Initial Setup

set -e

echo "🔧 Wayfinderr - Initial Setup"
echo "=============================="
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."
echo ""

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi
echo "✓ Docker installed"

if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose v2 is not available. Please update Docker."
    exit 1
fi
echo "✓ Docker Compose installed"

if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml not found. Please run from project root."
    exit 1
fi
echo "✓ Project structure valid"

echo ""
echo "🐳 Pulling Docker images..."
docker compose pull

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Next steps:"
echo "   1. Start services: ./scripts/start.sh"
echo "   2. Open http://localhost:3000"
echo "   3. Go to 'Servers' and add your Ultra.cc servers"
echo "   4. Click 'Test' to verify connection"
echo ""
echo "📖 For more info, see: docs/QUICK-START.md"
