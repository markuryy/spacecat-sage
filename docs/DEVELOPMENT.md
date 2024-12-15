# Development Guide for spacecat sage

## Setup

1. Install dependencies:
```bash
bun run init
```

This creates a Python virtual environment and installs all required packages.

## Development

Run the development server:
```bash
bun run dev
```

This starts both the React frontend and Python backend. The app will be available at `http://localhost:5173`.

## Building

Create a standalone executable:
```bash
bun run build
```

The build process packages both the frontend and backend into a single executable using PyInstaller.

### Platform-specific Builds

Each platform has its own spec file:
- `build-windows.spec`
- `build-linux.spec`
- `build-macos.spec`

Note: Build on the target platform - Windows builds must be done on Windows, etc.

## Setting up joycaption

If you want to use joycaption instead of OpenAI, you'll need to set up a vLLM endpoint. Serve it locally or use RunPod serverless:

1. Get a RunPod account
2. Deploy "serverless vLLM" with these settings:
   - Model: `fancyfeast/llama-joycaption-alpha-two-hf-llava`
   - Enable prefix caching
   - Max model length: 4096
3. Copy your endpoint ID and API key
4. Configure in sage:
   - Base URL: `https://api.runpod.ai/v2/[endpoint-id]/openai/v1`
   - API Key: Your RunPod key

For ~~more~~ the exact same info, see [joycaption alpha two](joycaption-alpha-two.md).
