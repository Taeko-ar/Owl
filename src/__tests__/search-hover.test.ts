import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupSearchHoverBehavior } from '../main';

describe('Search Hover Behavior', () => {
  let container: HTMLDivElement;
  let input: HTMLInputElement;

  beforeEach(() => {
    // Setup mock DOM environment
    document.body.innerHTML = `
      <div class="search-container">
        <input type="text" class="search-input" />
      </div>
    `;
    container = document.querySelector('.search-container') as HTMLDivElement;
    input = document.querySelector('.search-input') as HTMLInputElement;

    vi.useFakeTimers();
    setupSearchHoverBehavior();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('adds active class on mouseenter', () => {
    expect(input.classList.contains('active')).toBe(false);

    // Trigger mouseenter on container
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);
  });

  it('removes active class after 3 seconds on mouseleave if empty and unfocused', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    // Trigger mouseleave
    container.dispatchEvent(new Event('mouseleave'));
    // Should still be active before 3s
    vi.advanceTimersByTime(2900);
    expect(input.classList.contains('active')).toBe(true);

    // Advance past 3s
    vi.advanceTimersByTime(200);
    expect(input.classList.contains('active')).toBe(false);
  });

  it('maintains active class if mouse enters again within 3 seconds', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1500);

    // Mouse enters again
    container.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(2000); // Past the initial 3s mark
    expect(input.classList.contains('active')).toBe(true);
  });

  it('maintains active class if input is focused, even after mouse leaves and 3s pass', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    // Mock focus behavior
    input.focus();
    // input.focus() event might need to be explicitly dispatched if jsdom is slow
    input.dispatchEvent(new Event('focus'));

    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(3500);

    expect(input.classList.contains('active')).toBe(true);
  });

  it('maintains active class if input contains text, even after mouse leaves and 3s pass', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    // Type some text
    input.value = 'Questie';

    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(3500);

    expect(input.classList.contains('active')).toBe(true);
  });
});
