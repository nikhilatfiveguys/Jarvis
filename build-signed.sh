#!/bin/bash

# Set your Apple credentials as environment variables
export APPLE_ID="aaronsoni06@gmail.com"
export APPLE_ID_PASSWORD="zhlh-ktaa-vtjl-wtel"
export APPLE_TEAM_ID="DMH3RU9FQQ"

# Build the signed and notarized app
npm run build

echo "✅ Build complete! Check the dist/ folder for your signed .dmg file."
