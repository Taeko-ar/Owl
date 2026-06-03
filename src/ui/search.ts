export function setupMainSearchEvents() {
  const addonsSearch = document.getElementById('addons-search') as HTMLInputElement | null;
  const addonsClear = document.getElementById('addons-search-clear') as HTMLButtonElement | null;
  const patchesSearch = document.getElementById('patches-search') as HTMLInputElement | null;
  const patchesClear = document.getElementById('patches-search-clear') as HTMLButtonElement | null;

  const toggleClear = (input: HTMLInputElement, clearBtn: HTMLButtonElement | null) => {
    if (!clearBtn) return;
    if (input.value.trim().length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  };

  addonsSearch?.addEventListener('input', () => {
    toggleClear(addonsSearch, addonsClear);
    const query = addonsSearch.value.toLowerCase().trim();
    const addonRows = document.querySelectorAll('#addons-list > div') as NodeListOf<HTMLDivElement>;
    addonRows.forEach((row) => {
      const addonName = row.getAttribute('data-addon')?.toLowerCase() || '';
      const text = row.textContent?.toLowerCase() || '';
      if (addonName.includes(query) || text.includes(query)) {
        row.classList.remove('hidden');
        row.style.display = '';
      } else {
        row.classList.add('hidden');
        row.style.display = 'none';
      }
    });
  });

  addonsClear?.addEventListener('click', () => {
    if (addonsSearch) {
      addonsSearch.value = '';
      addonsSearch.dispatchEvent(new Event('input'));
      addonsSearch.focus();
    }
  });

  patchesSearch?.addEventListener('input', () => {
    toggleClear(patchesSearch, patchesClear);
    const query = patchesSearch.value.toLowerCase().trim();
    const patchRows = document.querySelectorAll(
      '#patches-list > div'
    ) as NodeListOf<HTMLDivElement>;
    patchRows.forEach((row) => {
      const patchName = row.getAttribute('data-patch')?.toLowerCase() || '';
      const text = row.textContent?.toLowerCase() || '';
      if (patchName.includes(query) || text.includes(query)) {
        row.classList.remove('hidden');
        row.style.display = '';
      } else {
        row.classList.add('hidden');
        row.style.display = 'none';
      }
    });
  });

  patchesClear?.addEventListener('click', () => {
    if (patchesSearch) {
      patchesSearch.value = '';
      patchesSearch.dispatchEvent(new Event('input'));
      patchesSearch.focus();
    }
  });
}

export function setupSearchHoverBehavior() {
  const containers = document.querySelectorAll('.search-container');
  containers.forEach((container) => {
    const input = container.querySelector('.search-input') as HTMLInputElement | null;
    if (!input) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const showInput = () => {
      if (input.disabled) return;
      if (timer) clearTimeout(timer);
      input.classList.add('active');
    };

    const hideInputWithDelay = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (input !== document.activeElement && input.value.trim().length === 0) {
          input.classList.remove('active');
        }
      }, 3000);
    };

    container.addEventListener('mouseenter', showInput);
    container.addEventListener('mouseleave', hideInputWithDelay);
    input.addEventListener('focus', () => {
      if (timer) clearTimeout(timer);
    });

    input.addEventListener('blur', () => {
      if (!container.matches(':hover')) {
        hideInputWithDelay();
      }
    });
  });
}
