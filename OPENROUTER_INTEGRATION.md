# OpenRouter Integration

## Overview
Implemented OpenRouter API integration to allow users to select from multiple AI models through a dropdown menu next to the hamburger menu.

## What Was Added

### 1. **Configuration Files**
- Added OpenRouter API key to `config/production-config.js`
- Added `getOpenRouterConfig()` method to `config/secure-config.js`
- Updated `main.js` to expose OpenRouter API key to renderer process

### 2. **UI Components**
Added to `index.html`:
- Model dropdown button next to hamburger menu
- Dropdown menu with 8 AI model options:
  - **Jarvis (Default)** - GPT-5 Mini
  - **GPT-4o** - OpenAI
  - **Claude 3.5 Sonnet** - Anthropic
  - **Claude 3 Opus** - Anthropic
  - **Perplexity** - Web Search Enabled
  - **Gemini Pro 1.5** - Google
  - **Llama 3.1 70B** - Meta
  - **Mixtral 8x7B** - Mistral AI

### 3. **Styling**
Added to `styles.css`:
- `.model-dropdown-container` - Container for dropdown
- `.model-dropdown-btn` - Styled button with model name and arrow
- `.model-dropdown-menu` - Dropdown menu styling
- `.model-item` - Individual model items with hover effects
- `.model-item.active` - Active state with blue highlight
- Increased HUD width to accommodate dropdown (min: 300px, max: 450px)

### 4. **JavaScript Functionality**
Added to `script.js`:
- `selectedModel` - State variable for selected model
- `selectedModelName` - State variable for display name
- `openrouterApiKey` - API key loaded from config
- `toggleModelDropdown()` - Toggle dropdown visibility
- `hideModelDropdown()` - Close dropdown
- `selectModel(model, modelName)` - Handle model selection
- `callOpenRouter(message, model)` - OpenRouter API integration
- Event listeners for model dropdown and selection
- Auto-close dropdown when clicking outside
- Route messages to OpenRouter when non-default model selected

### 5. **API Integration**
The `callOpenRouter()` function:
- Makes requests to `https://openrouter.ai/api/v1/chat/completions`
- Includes conversation history context
- Supports document context
- Handles errors gracefully
- Updates conversation history
- Uses the OpenRouter API key: `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`

## How It Works

1. User clicks the model dropdown button next to the hamburger menu
2. Dropdown menu appears with available AI models
3. User selects a model
4. Selected model name is displayed in the button
5. When user sends a message:
   - If "Jarvis" (default) is selected → Uses existing GPT-5 Mini flow
   - If any other model is selected → Routes to OpenRouter API
6. Response is displayed normally in the chat interface

## Features
- ✅ Smooth dropdown animation
- ✅ Visual feedback on hover
- ✅ Active model highlighted with blue accent
- ✅ Auto-close on outside click
- ✅ Conversation history preserved across model switches
- ✅ Document context support
- ✅ Error handling and logging

## Testing
To test the integration:
1. Launch the app
2. Click the "Jarvis" dropdown button
3. Select a different model (e.g., "GPT-4o" or "Claude 3.5 Sonnet")
4. Send a message
5. Check console for `🤖 Using OpenRouter model: [model-name]`
6. Verify response from selected model

## Notes
- The default "Jarvis" model continues to use the existing GPT-5 Mini flow
- OpenRouter handles routing to the appropriate AI provider
- All conversation history is maintained regardless of model switches
- The API key is securely stored in config files and exposed via IPC

