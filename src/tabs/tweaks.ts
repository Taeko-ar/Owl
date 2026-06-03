import { invoke } from '@tauri-apps/api/core';
import { debounce, showToast, setLoadingState, clearLoadingState } from '../utils';
import { getTranslation } from '../i18n';
import { getConfigMetadata } from '../config/known-configs';

export const configGroups = [
  {
    title: 'Display & Window',
    colorClass: 'text-sky-400',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>`,
    keys: ['gxResolution', 'gxWindow', 'gxMaximize', 'gxRefresh'],
  },
  {
    title: 'Performance Tuning',
    colorClass: 'text-emerald-400',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>`,
    keys: ['maxFPS', 'maxFPSbk', 'gxTripleBuffer', 'gxFixLag'],
  },
  {
    title: 'Details & Quality',
    colorClass: 'text-purple-400',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21l-1.81-5.096L2.094 14.1 7.2 13.25 8.187 8l1.81 5.096L15.1 14.1l-5.287.804zm8.25-10.5L17.25 9l-.81-2.596L13.844 5.61l2.596-.414L17.25 2.6l.81 2.596 2.596.414-2.596.804z" /></svg>`,
    keys: ['farClip', 'environmentDetail', 'projectedTextures', 'gxMultisample', 'shadowLevel'],
  },
];

export function parseConfigToMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('--')) continue;

    let key: string | null = null;
    let value = '';

    const setMatch = line.match(/^SET\s+(.+?)\s+(.+)$/i);
    if (setMatch) {
      key = setMatch[1].replace(/^"|"$/g, '');
      value = setMatch[2].trim();
    } else if (line.includes('=')) {
      const idx = line.indexOf('=');
      key = line
        .substring(0, idx)
        .trim()
        .replace(/^\[|\]$/g, '');
      value = line.substring(idx + 1).trim();
    } else {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        key = parts[0];
        value = line.substring(parts[0].length).trim();
      }
    }

    if (key) {
      value = value.replace(/^"|"$/g, '').replace(/;$/g, '').trim();
      map[key] = value;
    }
  }
  return map;
}

export let activeTweaksSubTab = 'presets';

export async function loadConfig() {
  const configTree = document.getElementById('config-tree') as HTMLDivElement | null;
  const gamePath = document.getElementById('gamePath') as HTMLInputElement;
  const activityProgress = document.getElementById('activityProgress') as HTMLElement | null;
  const statusFooter = document.getElementById('status') as HTMLElement;

  if (!configTree || !gamePath) return;
  setLoadingState(getTranslation('status.loading'), 20, null, activityProgress);
  configTree.innerHTML = `<div class="text-slate-500">${getTranslation('tweaks.loading')}</div>`;
  try {
    const raw = await invoke<string>('read_config', { basePath: gamePath.value });
    const configMap = parseConfigToMap(raw);
    configTree.innerHTML = '';

    const mainContainer = document.createElement('div');
    mainContainer.className = 'flex flex-1 min-h-0 gap-6 w-full h-full pb-6';

    const sidebar = document.createElement('div');
    sidebar.className =
      'w-48 flex-shrink-0 flex flex-col gap-1.5 border-r border-slate-800/60 pr-4';

    const contentPanel = document.createElement('div');
    contentPanel.className = 'flex-1 overflow-y-auto pr-3 min-h-0';

    const subTabs = [
      {
        id: 'presets',
        label: getTranslation('tweaks.tabs.presets'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>`,
      },
      {
        id: 'display',
        label: getTranslation('tweaks.groups.display_and_window'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>`,
      },
      {
        id: 'performance',
        label: getTranslation('tweaks.groups.performance_tuning'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>`,
      },
      {
        id: 'quality',
        label: getTranslation('tweaks.groups.details_and_quality'),
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21l-1.81-5.096L2.094 14.1 7.2 13.25 8.187 8l1.81 5.096L15.1 14.1l-5.287.804zm8.25-10.5L17.25 9l-.81-2.596L13.844 5.61l2.596-.414L17.25 2.6l.81 2.596 2.596.414-2.596.804z" /></svg>`,
      },
    ];

    subTabs.forEach((t) => {
      const btn = document.createElement('button');
      const isActive = t.id === activeTweaksSubTab;
      btn.className = `tweak-sidebar-btn w-full px-3.5 py-2.5 rounded-lg text-left text-xs font-semibold flex items-center gap-2.5 transition-all duration-150 cursor-pointer outline-none ${
        isActive
          ? 'bg-slate-800 text-slate-100 border border-slate-700/80 active'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
      }`;
      btn.innerHTML = `${t.icon} <span>${t.label}</span>`;
      btn.addEventListener('click', () => {
        activeTweaksSubTab = t.id;
        loadConfig();
      });
      sidebar.appendChild(btn);
    });

    if (activeTweaksSubTab === 'presets') {
      const presetsCard = document.createElement('div');
      presetsCard.className =
        'rounded-lg border border-slate-800 bg-slate-900 p-6 flex flex-col gap-4';
      presetsCard.innerHTML = `
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${getTranslation('tweaks.presets.low')}</span>
              <span class="text-xs text-slate-400 max-w-[400px]">${getTranslation('tweaks.presets.lowDesc')}</span>
            </div>
            <button class="preset-btn text-xs bg-slate-800 border border-slate-700 hover:border-slate-500 px-3.5 py-1.5 rounded text-slate-100 hover:bg-slate-700 transition-all duration-150 cursor-pointer outline-none font-semibold" data-preset="performance">
              ${getTranslation('settings.apply')}
            </button>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${getTranslation('tweaks.presets.medium')}</span>
              <span class="text-xs text-slate-400 max-w-[400px]">${getTranslation('tweaks.presets.mediumDesc')}</span>
            </div>
            <button class="preset-btn text-xs bg-slate-800 border border-slate-700 hover:border-slate-500 px-3.5 py-1.5 rounded text-slate-100 hover:bg-slate-700 transition-all duration-150 cursor-pointer outline-none font-semibold" data-preset="balanced">
              ${getTranslation('settings.apply')}
            </button>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${getTranslation('tweaks.presets.high')}</span>
              <span class="text-xs text-slate-400 max-w-[400px]">${getTranslation('tweaks.presets.highDesc')}</span>
            </div>
            <button class="preset-btn text-xs bg-slate-800 border border-slate-700 hover:border-slate-500 px-3.5 py-1.5 rounded text-slate-100 hover:bg-slate-700 transition-all duration-150 cursor-pointer outline-none font-semibold" data-preset="quality">
              ${getTranslation('settings.apply')}
            </button>
          </div>
        </div>
      `;

      const PRESETS = {
        performance: {
          nameKey: 'tweaks.presets.low',
          values: {
            farClip: '177.000000',
            environmentDetail: '50.000000',
            shadowLevel: '0',
            gxMultisample: '1',
            projectedTextures: '0',
          },
        },
        balanced: {
          nameKey: 'tweaks.presets.medium',
          values: {
            farClip: '727.000000',
            environmentDetail: '100.000000',
            shadowLevel: '2',
            gxMultisample: '2',
            projectedTextures: '1',
          },
        },
        quality: {
          nameKey: 'tweaks.presets.high',
          values: {
            farClip: '1277.000000',
            environmentDetail: '150.000000',
            shadowLevel: '3',
            gxMultisample: '8',
            projectedTextures: '1',
          },
        },
      };

      presetsCard.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const presetType = btn.getAttribute('data-preset') as keyof typeof PRESETS;
          const presetData = PRESETS[presetType];
          const presetName = getTranslation(presetData.nameKey);
          setLoadingState(
            getTranslation('tweaks.presets.applying', { name: presetName }),
            30,
            null,
            activityProgress
          );
          try {
            for (const [key, val] of Object.entries(presetData.values)) {
              await invoke('set_config_value', {
                basePath: gamePath.value,
                key: key,
                value: val,
              });
            }
            showToast(getTranslation('tweaks.presets.applied', { name: presetName }));
            await loadConfig();
          } catch (err) {
            showToast(getTranslation('toast.error', { error: String(err) }));
          } finally {
            clearLoadingState(statusFooter, activityProgress);
          }
        });
      });

      contentPanel.appendChild(presetsCard);
    } else {
      const groupKey =
        activeTweaksSubTab === 'display' ? 0 : activeTweaksSubTab === 'performance' ? 1 : 2;
      const group = configGroups[groupKey];

      const card = document.createElement('div');
      card.className = 'rounded-lg border border-slate-800 bg-slate-900 p-6 flex flex-col gap-4';

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'flex flex-col gap-4';

      group.keys.forEach((key) => {
        const configMeta = getConfigMetadata(key, key);
        const value = configMap[key] || '';

        const row = document.createElement('div');
        row.className = 'flex flex-col gap-2 py-1.5 border-b border-slate-800/40 last:border-0';

        const saveFn = debounce(async (val: string) => {
          try {
            await invoke('set_config_value', {
              basePath: gamePath.value,
              key: key,
              value: val,
            });
            showToast(getTranslation('toast.saved'));
          } catch (err) {
            console.error(err);
          }
        }, 700);

        const translatedAlias = configMeta.alias || key;
        const translatedDesc = configMeta.desc || '';

        const isToggle =
          configMeta.options &&
          configMeta.options.length === 2 &&
          ((configMeta.options[0].value === '0' && configMeta.options[1].value === '1') ||
            (configMeta.options[0].value === '1' && configMeta.options[1].value === '0'));

        if (isToggle) {
          row.className =
            'flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0';
          row.innerHTML = `
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${translatedAlias}</span>
              <span class="text-xs text-slate-400 max-w-[340px]">${translatedDesc}</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" class="tweak-toggle" data-key="${key}" ${value === '1' ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          `;

          const toggleInput = row.querySelector('.tweak-toggle') as HTMLInputElement;
          toggleInput.addEventListener('change', () => {
            saveFn(toggleInput.checked ? '1' : '0');
          });
        } else if (
          configMeta.type === 'number' &&
          configMeta.min !== undefined &&
          configMeta.max !== undefined
        ) {
          row.innerHTML = `
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-sm text-slate-200 font-semibold">${translatedAlias}</span>
                <span class="text-xs text-slate-400 max-w-[400px]">${translatedDesc}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="tweak-value-text text-sm font-semibold text-sky-400" id="tweak-val-${key}">${value || configMeta.min}</span>
                <span class="text-[11px] text-slate-500 font-normal" id="tweak-sub-${key}">${key === 'maxFPS' && value === '0' ? getTranslation('tweaks.uncapped') : ''}</span>
              </div>
            </div>
            <input type="range" class="tweak-range w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer mt-1" data-key="${key}" min="${configMeta.min}" max="${configMeta.max}" step="${configMeta.step || 1}" value="${value || configMeta.min}" />
          `;

          const rangeInput = row.querySelector('.tweak-range') as HTMLInputElement;
          const valDisplay = row.querySelector(`#tweak-val-${key}`) as HTMLSpanElement;
          const subDisplay = row.querySelector(`#tweak-sub-${key}`) as HTMLSpanElement;

          rangeInput.addEventListener('input', () => {
            valDisplay.textContent = rangeInput.value;
            if (key === 'maxFPS') {
              subDisplay.textContent =
                rangeInput.value === '0' ? getTranslation('tweaks.uncapped') : '';
            }
          });

          rangeInput.addEventListener('change', () => {
            saveFn(rangeInput.value);
          });
        } else if (configMeta.options && configMeta.options.length > 0) {
          row.className =
            'flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0';

          let optionsHtml = configMeta.options
            .map(
              (opt: { label: string; value: string }) =>
                `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
            )
            .join('');

          const found = configMeta.options.some(
            (opt: { label: string; value: string }) => opt.value === value
          );
          if (!found && value !== '') {
            optionsHtml += `<option value="${value}" selected>Custom (${value})</option>`;
          }

          row.innerHTML = `
            <div class="flex flex-col">
              <span class="text-sm text-slate-200 font-semibold">${translatedAlias}</span>
              <span class="text-xs text-slate-400 max-w-[340px]">${translatedDesc}</span>
            </div>
            <select class="tweak-select bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 outline-none focus:border-slate-500 cursor-pointer w-48">
              ${optionsHtml}
            </select>
          `;

          const selectEl = row.querySelector('.tweak-select') as HTMLSelectElement;
          selectEl.addEventListener('change', () => {
            saveFn(selectEl.value);
          });
        }

        itemsContainer.appendChild(row);
      });

      card.appendChild(itemsContainer);
      contentPanel.appendChild(card);
    }

    mainContainer.appendChild(sidebar);
    mainContainer.appendChild(contentPanel);
    configTree.appendChild(mainContainer);
  } catch (err) {
    configTree.innerHTML = `<div class="text-slate-400">${getTranslation('tweaks.unable', { error: String(err) })}</div>`;
  } finally {
    if (statusFooter) clearLoadingState(statusFooter, activityProgress);
  }
}
