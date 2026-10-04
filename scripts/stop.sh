#!/bin/bash

# Wayfinderr - Stop Services

set -e

echo "🛑 Stopping Wayfinderr services..."
echo ""

if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml not found."
    exit 1
fi

# Stop services
echo "Stopping Docker services..."
docker-compose down

echo ""
echo "✅ Services stopped successfully!"
echo ""
echo "💾 Data persisted in volumes:"
echo "   • Database: wayfinderr-data"
echo "   • MakeMKV output: makemkv-output"
