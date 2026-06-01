export const TAURI_MOCK_SCRIPT = `
  // Stub the Tauri IPC bridge so import('@tauri-apps/api/core').invoke() works
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb, once) => {
      const id = Math.random().toString(36).slice(2);
      window[id] = once ? (...args) => { cb(...args); delete window[id]; } : cb;
      return id;
    },
    invoke: async (cmd, args) => {
      return window.__OWL_INVOKE_MOCK__(cmd, args);
    },
    postMessage: () => {},
  };

  // Default mock implementations — override per-test via window.__OWL_INVOKE_OVERRIDES__
  window.__OWL_INVOKE_OVERRIDES__ = {};

  window.__OWL_INVOKE_MOCK__ = async (cmd, args) => {
    if (window.__OWL_INVOKE_OVERRIDES__[cmd]) {
      return window.__OWL_INVOKE_OVERRIDES__[cmd](args);
    }

    switch (cmd) {
      case 'load_settings':
        return { path: 'C:\\\\wow', windowSize: '1280x720', stayOpen: true };

      case 'get_addons':
        return window.__OWL_MOCK_ADDONS__ || [];

      case 'get_patches':
        return window.__OWL_MOCK_PATCHES__ || [];

      case 'parse_toc':
        return {
          name: args?.addonName || 'TestAddon',
          title: args?.addonName || 'Test Addon',
          author: 'TestAuthor',
          version: '1.0.0',
          hasGit: false,
          description: 'A test addon',
        };

      case 'detect_game_version':
        return window.__OWL_MOCK_GAME_VERSION__ || '3.3.5a';

      case 'search_curseforge_addons':
        return window.__OWL_MOCK_CF_RESULTS__ || {
          data: [
            {
              id: 10001,
              name: 'Questie',
              summary: 'Quest helper addon for WotLK',
              logo: { thumbnailUrl: 'https://via.placeholder.com/64' },
              links: { websiteUrl: 'https://questie.com' },
              authors: [{ name: 'QuestieDevs' }],
            },
            {
              id: 10002,
              name: 'Deadly Boss Mods',
              summary: 'Boss mod addon',
              logo: { thumbnailUrl: 'https://via.placeholder.com/64' },
              links: { websiteUrl: 'https://dbm.com' },
              authors: [{ name: 'MysticalOS' }],
            },
          ],
        };

      case 'get_curseforge_mod_files':
        return window.__OWL_MOCK_CF_FILES__ || {
          data: [
            {
              id: 100011,
              displayName: 'Questie-v3.3.5',
              fileName: 'Questie-v3.3.5.zip',
              releaseType: 1,
              downloadUrl: 'http://example.com/Questie.zip',
              gameVersions: ['3.3.5'],
              hashes: [{ algo: 1, value: 'aabbccdd' }],
            },
          ],
        };

      case 'get_curseforge_mod_description':
        return '<div>Questie is the most popular quest helper addon for WotLK.</div>';

      case 'search_github_addons':
        return window.__OWL_MOCK_GH_RESULTS__ || {
          items: [
            {
              id: 99001,
              full_name: 'author/SomeAddon',
              description: 'A github addon',
              html_url: 'https://github.com/author/SomeAddon',
              stargazers_count: 42,
              owner: { avatar_url: 'https://via.placeholder.com/64', login: 'author' },
            },
          ],
        };

      case 'get_github_releases':
        return window.__OWL_MOCK_GH_RELEASES__ || [
          {
            id: 1,
            tag_name: 'v1.2.3',
            name: 'v1.2.3',
            prerelease: false,
            assets: [
              { id: 1, name: 'SomeAddon.zip', browser_download_url: 'http://example.com/addon.zip', size: 1024 },
            ],
          },
        ];

      case 'download_curseforge_addon':
      case 'download_github_release':
      case 'toggle_addon':
      case 'toggle_patch':
      case 'open_addon_folder':
      case 'open_patch_folder':
      case 'open_mods_folder':
      case 'delete_addon':
      case 'delete_patch':
      case 'launch_game':
      case 'save_settings':
      case 'check_for_app_update':
        return null;

      case 'git_status':
        return { status: 'up_to_date', branch: 'main' };

      case 'git_update':
        return 'Updated';

      case 'read_config':
        return {};

      case 'write_config':
        return null;

      default:
        console.warn('[OWL mock] Unhandled invoke command:', cmd, args);
        return null;
    }
  };
`;
