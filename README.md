# spacecat sage

A desktop application for generating and editing image captions, with support for both OpenAI and JoyCaption.

> ⚠️ **Warning:** The current releases (as of `v0.1.2-alpha`) are extremely unstable and *do* have bugs, including basic operational issues. Build from source for now.

I am in the middle of a major refactor so most things are currently broken, including:
- [x] Session persistence
- [ ] Image editor saving
- [ ] Batch captioning
- [ ] vLLM/JoyCaption support
- [ ] Large project stability
- [ ] All prompts
- [ ] Image virtualization (WIP)
- [ ] Drag and drop support

Current basic functionality includes:
- [x] Individual image captioning via OpenAI API
- [x] Manual caption editing
- [x] Import/export kohya dataset 

## Features

*   Support for OpenAI API and JoyCaption alpha two (vLLM)
*   Pre-defined prompts for JoyCaption
*   Keeps original files unmodified
*   Single and batch processing
*   Basic image editing

## Quick Start

### Getting Started

1.  Download the latest release or build from source (see [development docs](docs/DEVELOPMENT.md))
2.  Configure your captioning model:
    *   For OpenAI: Add your API key
    *   For joycaption: Set up vLLM (see [joycaption alpha two](docs/joycaption-alpha-two.md))
3.  Select your prompt (optimized for JoyCaption but allows any prompt)
4.  Import images or a folder
5.  Caption your images one at a time or in batches:
    *   Click generate to process the current image; _or_
    *   Select multiple images and click caption to process them in a batch
6.  Export images and txt files when you're done to train SD/Flux

### Additional Features

- Basic image editing tools:
    - Crop
    - Rotate
    - Flip
- "Separate Viewed Images" option helps you keep track of your progress when you use the batch captioning feature
- Reset to saved caption: Allows you to revert any caption to what it was when you first opened it


### Installation

Since the app isn't signed, I recommend you look through source code and build it on your own machine (see [development docs](docs/DEVELOPMENT.md)). *But* that's a little annoying, so I've compiled binaries for major platforms.

You can download the latest release [here](https://github.com/markuryy/spacecat-sage/releases/latest) for your platform (it's built for darwin but compiled for linux and windows).

#### Windows / Linux

On Linux and Windows, you can download the .zip file and extract it to your desired location. Run the executable to start the app.

On windows, it's easy to bypass the prompt by clicking "run anyway":

> Windows protected your PC
> Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.
> App: spacecat sage.exe
> Publisher: Unknown publisher

#### macOS

On macOS, you can drag and drop the app to your Applications folder. 

There are [a few more steps](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) to open the app:

> Overriding security settings to open an app is the most common way that a Mac gets infected with malware.
>
> On your Mac, choose Apple menu  > System Settings, then click Privacy & Security  in the sidebar. (You may need to scroll down.)
>
> 1. Go to Security, then click Open.
> 2. Click Open Anyway.
>
>    This button is available for about an hour after you try to open the app.
>
> 3. Enter your login password, then click OK.
>
> The app is saved as an exception to your security settings, and you can open it in the future by double-clicking it, just as you can for any authorized app.