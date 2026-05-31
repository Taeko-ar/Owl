# OWL

**O**pen-source **W**ow **L**auncher for World of Warcraft Classic 1.12.1 and WoTLK 3.3.5a.

[![Test/Linter Status](https://github.com/Taeko-ar/Owl/actions/workflows/test-linter.yml/badge.svg)](https://github.com/Taeko-ar/Owl/actions/workflows/test-linter.yml)
[![Release Build Status](https://github.com/Taeko-ar/Owl/actions/workflows/release.yml/badge.svg)](https://github.com/Taeko-ar/Owl/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue.svg)](https://github.com/Taeko-ar/Owl/blob/main/LICENSE.md)

<p align="center">
  <img src="img/launcher.gif" width="100%" alt="OWL Preview">
</p>

## Features

- **Addon & Patch Management**:
  - Enable, disable, delete, and update installed addons and patches/mods
  - Manage Git branches directly from the interface for git-based addons
  - Scan and open addon/patch folders instantly
- **Import addons from addon stores**:
  - Supports installation of addons directly from **CurseForge** and **GitHub**.
  - Filter catalog by categories and target game versions (Vanilla vs. WotLK).
- **Game Configuration**:
  - Edit `config.wtf` game settings (tweaks) directly through a user-friendly configuration panel.
- **Utilities**:
  - Multi-language support (English, Spanish (Latam), Portuguese (Brasil))
  - Dark/Light mode

## Install

Download the latest release from [here](https://github.com/Taeko-ar/Owl/releases).

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

- Run in development mode:

  ```bash
  # Backend
  npm run dev
  ```

  ```bash
  # Frontend
  npm run preview
  ```

- Run tests:

  ```bash
  # Run all unit tests
  npm run unit

  # Run with coverage reports
  npx vitest run --coverage

  # Run automated E2E tests
  npm run automation
  ```

- Build for production:

  ```bash
  npm run build
  ```
