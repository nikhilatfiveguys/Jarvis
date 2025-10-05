# 🤖 Jarvis 5.0 - AI Overlay Assistant

An intelligent macOS overlay assistant powered by AI with voice activation, screen analysis, and seamless integration with your workflow.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

- 🎯 **AI-Powered Assistant** - Get intelligent responses to your queries
- 🎤 **Voice Activation** - Say "Jarvis" to activate hands-free
- 📸 **Screen Analysis** - Analyze what's on your screen with AI vision
- ⌨️ **Keyboard Shortcuts** - Quick access with ⌘+⇧+Space
- 🌐 **Web Integration** - Open websites, search, and get summaries
- 🖥️ **App Control** - Launch and control applications
- 💬 **Text & Voice Input** - Flexible input methods
- 🎨 **Beautiful UI** - Modern, minimal overlay design

## 📥 Installation

### For Users

1. **Download** the latest release from the [Releases](../../releases) page
2. **Download** `Jarvis-5.0.dmg`
3. **Double-click** the DMG to mount it
4. **Drag** `Jarvis 5.0.app` to your Applications folder
5. **Right-click** the app and select **"Open"** (first time only)
6. **Grant permissions** when prompted (Microphone, Screen Recording)

### Troubleshooting "Damaged File" Error

macOS may show a security warning because the app is not signed. Here's how to fix it:

**Method 1: Right-click Open**
- Right-click (or Control+click) the app → Select **"Open"**
- Click **"Open"** in the dialog

**Method 2: Terminal Command**
```bash
sudo xattr -rd com.apple.quarantine "/Applications/Jarvis 5.0.app"
```

**Method 3: System Settings**
- Go to **System Settings** → **Privacy & Security** → **General**
- Find the message about Jarvis 5.0 → Click **"Allow"**

## 🎯 Usage

### Activation Methods
- Say **"Jarvis"** to activate with voice
- Press **⌘+⇧+Space** to toggle the overlay
- Type directly in the input field

### Commands
- **"What's on my screen?"** - Analyze current screen content
- **"Open [app name]"** - Launch applications
- **"Go to [website]"** - Navigate to websites
- **"Search for [query]"** - Web search
- Ask any question for AI-powered responses

### Keyboard Shortcuts
- **⌘+⇧+Space** - Toggle overlay visibility
- **Escape** - Hide overlay
- **Enter** - Send message

## 🛠️ Development

### Prerequisites
- macOS 10.15 or later
- Node.js 14+ 
- npm or yarn

### Setup
```bash
# Clone the repository
git clone https://github.com/yourusername/jarvis-5.0.git
cd jarvis-5.0

# Install dependencies
npm install

# Start development
npm start
```

### Project Structure
```
jarvis-5.0/
├── main.js              # Electron main process
├── index.html           # Main overlay UI
├── script.js            # UI logic and API integration
├── styles.css           # Styling
├── overlay.html         # Overlay window
├── package.json         # Dependencies and scripts
├── getActiveUrl.js      # Browser URL detection
├── summarizeWebsite.js  # Web scraping and summarization
└── node_modules/        # Dependencies
```

### Scripts
```bash
npm start              # Start the app
npm run dev           # Start with dev tools
npm run build         # Build distributable (requires certificates)
```

## 🔧 Building from Source

### Using Electron Builder (Requires Apple Developer Account)
```bash
npm run build
```

### Manual Build (No Code Signing)
For distribution without code signing:
1. Install dependencies: `npm install`
2. Use Electron Packager or follow [Electron's packaging guide](https://www.electronjs.org/docs/latest/tutorial/application-distribution)

## ⚙️ Configuration

### API Keys
The app uses the Perplexity API for AI responses. Set your API key as an environment variable:

```bash
export PPLX_API_KEY="your-api-key-here"
npm start
```

Or modify the code to store API keys securely.

## 🧰 Tech Stack

- **Electron** - Desktop application framework
- **Perplexity API** - AI-powered responses
- **OpenAI API** - Advanced AI capabilities
- **screenshot-desktop** - Screen capture functionality
- **run-applescript** - macOS system integration

## 📝 Requirements

- macOS 10.15 (Catalina) or later
- 200 MB disk space
- Internet connection for AI features
- Microphone permission (for voice activation)
- Screen Recording permission (for screen analysis)

## 🔒 Privacy

- All processing happens locally except AI API calls
- Screen captures are only sent to AI when explicitly requested
- No data is stored or transmitted without your action
- API keys remain on your machine

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Known Issues

- First launch requires right-click to open (macOS security)
- Requires permissions for microphone and screen recording
- Voice activation may not work without microphone permission

## 🗺️ Roadmap

- [ ] Windows and Linux support
- [ ] Custom hotkey configuration
- [ ] Plugin system for extensions
- [ ] Local AI model support
- [ ] Multi-monitor support
- [ ] Dark/Light theme toggle

## 👏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- AI powered by [Perplexity](https://www.perplexity.ai/) and [OpenAI](https://openai.com/)
- Icons and UI inspiration from modern macOS apps

## 📧 Support

For issues, questions, or feature requests, please [open an issue](../../issues).

---

**Made with ❤️ by Aaron Soni**

