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
