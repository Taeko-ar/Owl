import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupMainSearchEvents, setupSearchHoverBehavior } from '../ui/search';

describe('Search UI Events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('setupMainSearchEvents filters addons and patches correctly', () => {
    document.body.innerHTML = `
      <input id="addons-search" value="" />
      <button id="addons-search-clear" class="hidden"></button>
      <div id="addons-list">
        <div data-addon="Questie">Questie WoW Addon</div>
        <div data-addon="Bagnon">Inventory Bag mod</div>
      </div>

      <input id="patches-search" value="" />
      <button id="patches-search-clear" class="hidden"></button>
      <div id="patches-list">
        <div data-patch="patch-enUS-W.mpq">Wow custom patch</div>
        <div data-patch="patch-enUS-X.mpq">Another patch</div>
      </div>
    `;

    setupMainSearchEvents();

    const addonsSearch = document.getElementById('addons-search') as HTMLInputElement;
    const addonsClear = document.getElementById('addons-search-clear') as HTMLButtonElement;
    const patchesSearch = document.getElementById('patches-search') as HTMLInputElement;
    const patchesClear = document.getElementById('patches-search-clear') as HTMLButtonElement;

    const questieRow = document.querySelector('[data-addon="Questie"]') as HTMLDivElement;
    const bagnonRow = document.querySelector('[data-addon="Bagnon"]') as HTMLDivElement;

    // Trigger input on addonsSearch
    addonsSearch.value = 'Bag';
    addonsSearch.dispatchEvent(new Event('input'));

    expect(addonsClear.classList.contains('hidden')).toBe(false);
    expect(questieRow.classList.contains('hidden')).toBe(true);
    expect(bagnonRow.classList.contains('hidden')).toBe(false);

    // Trigger clear on addonsClear
    addonsClear.click();
    expect(addonsSearch.value).toBe('');
    expect(questieRow.classList.contains('hidden')).toBe(false);

    // Patches list filtering
    const patchW = document.querySelector('[data-patch="patch-enUS-W.mpq"]') as HTMLDivElement;
    const patchX = document.querySelector('[data-patch="patch-enUS-X.mpq"]') as HTMLDivElement;

    patchesSearch.value = 'custom';
    patchesSearch.dispatchEvent(new Event('input'));

    expect(patchesClear.classList.contains('hidden')).toBe(false);
    expect(patchW.classList.contains('hidden')).toBe(false);
    expect(patchX.classList.contains('hidden')).toBe(true);

    // Trigger clear on patchesClear
    patchesClear.click();
    expect(patchesSearch.value).toBe('');
    expect(patchX.classList.contains('hidden')).toBe(false);
  });

  it('setupSearchHoverBehavior covers blur focus and hover edge cases', () => {
    document.body.innerHTML = `
      <div class="search-container">
        <input type="text" class="search-input" />
      </div>
    `;

    setupSearchHoverBehavior();

    const container = document.querySelector('.search-container') as HTMLDivElement;
    const input = document.querySelector('.search-input') as HTMLInputElement;

    // Mouseenter
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    // Focus clears timer
    input.focus();

    // Mouseleave with focus does not hide
    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(3500);
    expect(input.classList.contains('active')).toBe(true);

    // Blur without container hover triggers delay hide
    container.matches = vi.fn().mockReturnValue(false);
    input.blur();
    vi.advanceTimersByTime(3000);
    expect(input.classList.contains('active')).toBe(false);
  });

  it('covers missing clearBtn branch, null elements, missing search/clear components and row mapping fallbacks', () => {
    // 1. missing clearBtn (addons-search-clear is missing)
    document.body.innerHTML = `
      <input id="addons-search" value="" />
      <div id="addons-list">
        <div data-addon="Questie">Questie</div>
      </div>
    `;
    setupMainSearchEvents();
    const input = document.getElementById('addons-search') as HTMLInputElement;
    input.value = 'Q';
    input.dispatchEvent(new Event('input')); // toggleClear returns immediately because clearBtn is null

    // 2. row textContent and data-addon missing fallbacks
    document.body.innerHTML = `
      <input id="addons-search" value="" />
      <button id="addons-search-clear" class="hidden"></button>
      <div id="addons-list">
        <div></div> <!-- missing data-addon AND textContent is empty -->
      </div>
      <input id="patches-search" value="" />
      <button id="patches-search-clear" class="hidden"></button>
      <div id="patches-list">
        <div></div>
      </div>
    `;
    setupMainSearchEvents();
    const input2 = document.getElementById('addons-search') as HTMLInputElement;
    input2.value = 'Q';
    input2.dispatchEvent(new Event('input')); // addonName and text default to ''
    const patchInput = document.getElementById('patches-search') as HTMLInputElement;
    patchInput.value = 'Q';
    patchInput.dispatchEvent(new Event('input'));

    // 3. setupSearchHoverBehavior missing input branch
    document.body.innerHTML = `
      <div class="search-container"></div> <!-- missing input element -->
    `;
    setupSearchHoverBehavior(); // should early exit

    // 4. addonsClear and patchesClear when search inputs are missing
    document.body.innerHTML = `
      <button id="addons-search-clear"></button>
      <button id="patches-search-clear"></button>
    `;
    setupMainSearchEvents();
    (document.getElementById('addons-search-clear') as HTMLButtonElement).click();
    (document.getElementById('patches-search-clear') as HTMLButtonElement).click();

    // 5. focus when timer is active, and blur when container matches :hover
    document.body.innerHTML = `
      <div class="search-container">
        <input type="text" class="search-input" />
      </div>
    `;
    setupSearchHoverBehavior();
    const container = document.querySelector('.search-container') as HTMLDivElement;
    const inputHover = document.querySelector('.search-input') as HTMLInputElement;

    // Trigger mouseenter/mouseleave to set timer, then mouseenter again to clear active timer
    container.dispatchEvent(new Event('mouseenter'));
    container.dispatchEvent(new Event('mouseleave'));
    container.dispatchEvent(new Event('mouseenter'));

    // Reset timer and test focus/blur
    container.dispatchEvent(new Event('mouseleave'));
    // Trigger focus to clear timer
    inputHover.dispatchEvent(new Event('focus'));

    // Trigger blur when container matches :hover (should not hide)
    container.matches = vi.fn().mockReturnValue(true);
    inputHover.dispatchEvent(new Event('blur'));
  });
});
