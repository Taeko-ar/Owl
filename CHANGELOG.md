## [1.1.3] - 2026-06-03

## Added
- Added a way to pick which game executable to launch when your WoW folder has more than one, and Owl remembers your choice for next time.
- Added a splash screen now shows while the launcher starts up, instead of a blank white window.
- Added addon details: now show quick buttons to open the addon's GitHub or CurseForge page.
- After downloading a WoW install via torrent, Owl now asks if you want to set that folder as your game path automatically.

## Fixed
- Fixed the launcher window not rendering or dragging correctly on some Linux systems.
- Fixed a security issue where a malicious addon archive (RAR/7z) could write files outside your addons folder.
- Fixed addon and download names not being safely displayed, which could break the interface with certain characters.
- Fixed addons with available updates not being sorted to the top of the list.
- Fixed a duplicate background request when launching the game, making launches slightly faster.
- Various behind-the-scenes stability and testing improvements.

## [1.1.2] - 2026-06-03

- Fixed a few issues from the marketplace

## [1.1.1] - 2026-06-03

### Added

- Added user profiles to save, apply, rename, and delete custom addon configuration presets.
- Added an import/export system to share and back up addon configurations.
- Added confirmation dialogs when deleting addons or patches to prevent accidental removal.
- Added automatic dependency detection and installation when importing addons.
- Added validation checks for imported addons to reject corrupted archives, loose files at the root level, or missing `.toc` files.
- Built-in torrent downloader integrated with `librqbit` for downloading the game client via magnet links or `.torrent` files, complete with progress tracking, speed display, and pause/resume/cancel controls.
- Added an install choice modal when no game path is configured, allowing users to locate an existing installation or trigger the new torrent downloader.
- Bundled addon imports now display checkboxes, letting users select which sub-addons within the archive to install.

### Fixed

- Fixed an issue with addon installing via .rar wihtout git adding -master to the folder
- Fixed launcher setting behavior to keep the window open after launching by default.
- Fixed timer clearing bugs related to clearTimeout execution.
