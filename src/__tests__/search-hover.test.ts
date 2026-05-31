import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupSearchHoverBehavior } from '../main';

describe('Search Hover Behavior', () => {
  let container: HTMLDivElement;
  let input: HTMLInputElement;

  beforeEach(() => {
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

    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);
  });

  it('removes active class after 3 seconds on mouseleave if empty and unfocused', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    container.dispatchEvent(new Event('mouseleave'));

    vi.advanceTimersByTime(2900);
    expect(input.classList.contains('active')).toBe(true);

    vi.advanceTimersByTime(200);
    expect(input.classList.contains('active')).toBe(false);
  });

  it('maintains active class if mouse enters again within 3 seconds', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1500);

    container.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(2000);
    expect(input.classList.contains('active')).toBe(true);
  });

  it('maintains active class if input is focused, even after mouse leaves and 3s pass', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    input.focus();

    input.dispatchEvent(new Event('focus'));

    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(3500);

    expect(input.classList.contains('active')).toBe(true);
  });

  it('maintains active class if input contains text, even after mouse leaves and 3s pass', () => {
    container.dispatchEvent(new Event('mouseenter'));
    expect(input.classList.contains('active')).toBe(true);

    input.value = 'Questie';

    container.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(3500);

    expect(input.classList.contains('active')).toBe(true);
  });
});
