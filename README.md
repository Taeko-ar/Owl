# OWL

**O**pen-source **W**ow **L**auncher for World of Warcraft Classic 1.12.1 and WoTLK 3.3.5a.

[![Test/Linter Status](https://github.com/Taeko-ar/Owl/actions/workflows/test-linter.yml/badge.svg)](https://github.com/Taeko-ar/Owl/actions/workflows/test-linter.yml)
[![Release Build Status](https://github.com/Taeko-ar/Owl/actions/workflows/release.yml/badge.svg)](https://github.com/Taeko-ar/Owl/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue.svg)](https://github.com/Taeko-ar/Owl/blob/main/LICENSE.md)

<p align="center">
  <img src="img/launcher.gif" width="100%" alt="OWL Preview">
</p>

## Install

Download the latest release from [here](https://github.com/Taeko-ar/Owl/releases).

## Features

- **Addon & Patch Management**:
  - Enable, disable, delete, and update installed addons and patches/mods
  - Save, apply, rename, and delete custom addon configurations with the **User Profiles** system
  - Import and export addon configurations to share or back up setups easily
  - Manage Git branches directly from the interface for git-based addons
  - Scan and open addon/patch folders instantly
- **Import addons from addon stores**:
  - Supports installation of addons directly from **CurseForge** and **GitHub**
  - Automatic dependency detection and installation when importing addons
  - Filter catalog by categories and target game versions (Vanilla vs. WotLK)
- **Game Configuration & Downloader**:
  - Built-in torrent downloader integrated with `librqbit` to download the game client via magnet links or `.torrent` files with progress tracking, speed display, and pause/resume/cancel controls
  - Setup choices modal on startup to locate existing game paths or download a new client
  - Edit `config.wtf` game settings (tweaks) directly through a user-friendly configuration panel
- **Utilities**:
  - Multi-language support (English, Spanish (Latam), Portuguese (Brasil))
  - Dark/Light mode
- **Multi OS Support**:
    - Cross-platform launcher supporting Windows and Linux (Bazzite only validated but it should work on any Fedora-based distro). Check the [Linux Setup & Compatibility guide](#running-wowexe-on-linux-proton--wine) for Proton/Wine runner configuration and Wayland setup.

## Local Development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Run in development mode:

   ```bash
   # Standard
   pnpm run dev

   # Linux (Wayland / WebKitGTK fix)
   pnpm run dev:linux
   ```

3. Run tests:

   ```bash
   # Run Rust cargo check
   pnpm run cargo:check

   # Run frontend unit tests
   pnpm run unit

   # Run with coverage reports
   pnpm run lint

   # Run automated E2E tests
   pnpm run automation
   ```

4. Build for production:

   ```bash
   pnpm run build
   ```


## Linux Setup & Compatibility

### WebKitGTK & Wayland Rendering
If running on Linux under Wayland or encountering rendering/WebKitGTK issues (e.g. blank window or display errors), use the dedicated Linux dev command:

```bash
pnpm run dev:linux
```

This passes recommended environment overrides:
`GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1`

<a id="linux-proton-setup"></a>
### Running WoW.exe on Linux (Proton & Wine)
To launch Windows executables (`WoW.exe`), Owl handles compatibility automatically:

- **Steam Proton (Automatic)**: Owl automatically scans system Steam installations (Native Steam, Flatpak Steam, `compatibilitytools.d`, GE-Proton, Proton Experimental) and launches the game with an automatically provisioned Proton prefix at `~/.local/share/owl/proton_prefix/`.
- **System Wine**: If Steam Proton is unavailable, Owl automatically falls back to system `wine` or `wine64`.
- **Custom Runner Override**: You can specify a custom runner or custom Proton path via environment variables:
  ```bash
  GAME_RUNNER="proton run" pnpm run dev:linux
  # or
  GAME_RUNNER="/path/to/proton run" pnpm run dev:linux
  ```

### System Build Dependencies
Building from source on Linux requires GTK3 and WebKitGTK development packages:

- **Debian / Ubuntu**:
  ```bash
  sudo apt update && sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Fedora**:
  ```bash
  sudo dnf install gtk3-devel webkit2gtk4.1-devel gcc-c++ openssl-devel
  ```
- **Bazzite**:
  ```bash
  sudo rpm-ostree install webkit2gtk4.1-devel gtk3-devel openssl-devel dbus-devel libsoup3-devel
  ```
- **Arch Linux**:
  ```bash
  sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 cairo pango
  ```
