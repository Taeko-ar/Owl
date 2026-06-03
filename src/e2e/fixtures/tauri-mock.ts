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
        return window.__OWL_MOCK_SETTINGS__ || {
          path: 'C:\\\\wow',
          windowSize: '1280x720',
          stayOpen: true,
          addonProfiles: window.__OWL_MOCK_PROFILES__ || [],
          activeProfile: window.__OWL_MOCK_ACTIVE_PROFILE__ || null,
        };

      case 'get_addon_profiles':
        return window.__OWL_MOCK_PROFILES__ || [];

      case 'save_addon_profile': {
        const name = args?.name;
        const enabledAddons = args?.enabledAddons || [];
        if (!window.__OWL_MOCK_PROFILES__) {
          window.__OWL_MOCK_PROFILES__ = [];
        }
        const index = window.__OWL_MOCK_PROFILES__.findIndex((p) => p.name === name);
        if (index !== -1) {
          window.__OWL_MOCK_PROFILES__[index].enabledAddons = enabledAddons;
        } else {
          window.__OWL_MOCK_PROFILES__.push({ name, enabledAddons });
        }
        window.__OWL_MOCK_ACTIVE_PROFILE__ = name;
        return 'OK';
      }

      case 'apply_addon_profile': {
        const name = args?.name;
        if (name === 'All Addons') {
          window.__OWL_MOCK_ACTIVE_PROFILE__ = null;
        } else {
          window.__OWL_MOCK_ACTIVE_PROFILE__ = name;
          if (window.__OWL_MOCK_PROFILES__ && window.__OWL_MOCK_ADDONS__) {
            const profile = window.__OWL_MOCK_PROFILES__.find(p => p.name === name);
            if (profile) {
              const enabledSet = new Set(profile.enabledAddons);
              window.__OWL_MOCK_ADDONS__ = window.__OWL_MOCK_ADDONS__.map(addon => {
                const baseName = addon.replace(/-disabled$/, '');
                return enabledSet.has(baseName) ? baseName : baseName + '-disabled';
              });
            }
          }
        }
        return 'OK';
      }

      case 'delete_addon_profile': {
        const name = args?.name;
        if (window.__OWL_MOCK_PROFILES__) {
          window.__OWL_MOCK_PROFILES__ = window.__OWL_MOCK_PROFILES__.filter((p) => p.name !== name);
        }
        if (window.__OWL_MOCK_ACTIVE_PROFILE__ === name) {
          window.__OWL_MOCK_ACTIVE_PROFILE__ = null;
        }
        return 'OK';
      }

      case 'rename_addon_profile': {
        const oldName = args?.oldName;
        const newName = args?.newName;
        if (window.__OWL_MOCK_PROFILES__) {
          const profile = window.__OWL_MOCK_PROFILES__.find((p) => p.name === oldName);
          if (profile) {
            profile.name = newName;
          }
        }
        if (window.__OWL_MOCK_ACTIVE_PROFILE__ === oldName) {
          window.__OWL_MOCK_ACTIVE_PROFILE__ = newName;
        }
        return 'OK';
      }

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

      case 'toggle_addon': {
        const name = args?.addonName;
        const enable = args?.enable;
        if (window.__OWL_MOCK_ADDONS__ && name) {
          const baseName = name.replace(/-disabled$/, '');
          const target = enable ? baseName : baseName + '-disabled';
          const oldTarget = enable ? baseName + '-disabled' : baseName;
          const idx = window.__OWL_MOCK_ADDONS__.indexOf(oldTarget);
          if (idx !== -1) {
            window.__OWL_MOCK_ADDONS__[idx] = target;
          } else {
            const idx2 = window.__OWL_MOCK_ADDONS__.indexOf(baseName);
            if (idx2 !== -1) {
              window.__OWL_MOCK_ADDONS__[idx2] = target;
            }
          }
        }
        return 'OK';
      }

      case 'toggle_patch': {
        const name = args?.patchName;
        const enable = args?.enable;
        if (window.__OWL_MOCK_PATCHES__ && name) {
          const baseName = name.replace(/-disabled[.]mpq$/i, '').replace(/[.]mpq$/i, '');
          const suffix = name.toLowerCase().endsWith('.mpq') ? '.mpq' : '';
          const target = enable ? baseName + suffix : baseName + '-disabled' + suffix;
          const oldTarget = enable ? baseName + '-disabled' + suffix : baseName + suffix;
          const idx = window.__OWL_MOCK_PATCHES__.indexOf(oldTarget);
          if (idx !== -1) {
            window.__OWL_MOCK_PATCHES__[idx] = target;
          } else {
            const idx2 = window.__OWL_MOCK_PATCHES__.indexOf(baseName + suffix);
            if (idx2 !== -1) {
              window.__OWL_MOCK_PATCHES__[idx2] = target;
            }
          }
        }
        return 'OK';
      }

      case 'download_curseforge_addon':
      case 'download_github_release':
      case 'download_and_extract_addon':
      case 'open_addon_folder':
      case 'open_patch_folder':
      case 'open_mods_folder':
      case 'delete_addon':
      case 'delete_patch':
      case 'launch_game':
      case 'save_settings':
      case 'check_for_app_update':
      case 'cleanup_temp_archive':
        return null;

      case 'confirm_install_bundled':
      case 'resolve_addon_dependency':
        return 'Successfully imported: Dependency';

      case 'check_addon_dependencies':
      case 'check_orphaned_dependencies':
        return [];

      case 'export_addon_list':
        return window.__OWL_MOCK_EXPORT_STRING__ || 'eyJ2IjoxLCJhZGRvbnMiOlt7Im5hbWUiOiJUZXN0QWRkb24iLCJlbmFibGVkIjp0cnVlLCJzb3VyY2UiOiJtYW51YWwifV19';

      case 'validate_import_string':
        if (args?.importStr?.includes('invalid')) {
          throw new Error('Invalid base64 string');
        }
        return window.__OWL_MOCK_IMPORT_PAYLOAD__ || {
          v: 1,
          addons: [
            { name: 'TestAddon', enabled: true, source: 'manual' }
          ]
        };

      case 'git_status':
        return { status: 'up_to_date', branch: 'main' };

      case 'git_update':
        return 'Updated';

      case 'read_config':
        return {};

      case 'write_config':
        return null;

      case 'pick_torrent_file':
        return 'C:\\\\game.torrent';

      case 'start_torrent_download':
        return 'info_hash_abc';

      case 'cancel_torrent_download':
      case 'pause_torrent_downloads':
      case 'resume_torrent_downloads':
        return null;

      case 'get_active_downloads':
        return window.__OWL_MOCK_ACTIVE_DOWNLOADS__ || [];

      case 'validate_game_path':
        return window.__OWL_MOCK_VALIDATE_GAME_PATH__ !== undefined ? window.__OWL_MOCK_VALIDATE_GAME_PATH__ : true;

      case 'check_update_details':
        return window.__OWL_MOCK_UPDATE_DETAILS__ !== undefined ? window.__OWL_MOCK_UPDATE_DETAILS__ : {
          version: '1.2.0',
          body: 'Added amazing features!\\n- Feature 1\\n- Feature 2',
        };

      case 'get_app_version':
        return '1.1.0';

      default:
        console.warn('[OWL mock] Unhandled invoke command:', cmd, args);
        return null;
    }
  };
`;
