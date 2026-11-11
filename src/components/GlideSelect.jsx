'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

import './GlideSelect.css';

const SIZES = {
  sm: { chip: 28, row: 26, font: 11.5 },
  md: { chip: 34, row: 30, font: 12 },
  lg: { chip: 42, row: 38, font: 13.5 }
};
const PAD = 5;
const GAP = 1;
const MENU_GAP = 6;
const DEFAULT_OPTIONS = ['One', 'Two', 'Three'];

const norm = o => (typeof o === 'string' ? { value: o, label: o } : o);
const textOf = it => (typeof it.label === 'string' ? it.label : String(it.value ?? ''));
const typeaheadIndex = (items, from, ch) => {
  const c = ch.toLowerCase();
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!items[i].disabled && textOf(items[i]).toLowerCase().startsWith(c)) return i;
  }
  return from;
};

const findNextEnabled = (items, start, stepDir) => {
  const n = items.length;
  let i = start;
  for (let k = 0; k < n; k++) {
    const clamped = Math.min(n - 1, Math.max(0, i));
    if (!items[clamped]?.disabled) return clamped;
    i += stepDir;
    if (i < 0 || i >= n) break;
  }
  return start;
};

export default function GlideSelect({
  options = DEFAULT_OPTIONS,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select…',
  showTags = true,
  accentColor,
  surfaceColor,
  highlightColor,
  textColor,
  size = 'md',
  radius = 10,
  menuWidth = 176,
  placement = 'bottom',
  align = 'left',
  popDuration = 180,
  glideDuration = 220,
  rememberPosition = true,
  disabled = false,
  fullWidth = false,
  portal = true,
  ariaLabel = 'Select',
  className = '',
  style
}) {
  const items = options.map(norm);
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const selected = items.findIndex(it => it.value === current);
  const [phase, setPhase] = useState('closed');
  const [active, setActive] = useState(null);
  const [side, setSide] = useState(placement);
  const [portalCoords, setPortalCoords] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const pillRef = useRef(null);
  const instant = useRef(false);
  const closeTimer = useRef(undefined);
  const scrub = useRef(null);
  const id = useId();
  const S = SIZES[size] ?? SIZES.md;
  const step = S.row + GAP;
  const popOut = Math.round((popDuration * 2) / 3);

  useLayoutEffect(() => {
    if (phase !== 'open') return;
    const el = menuRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const r = root.getBoundingClientRect();
    const menuHeight = el.offsetHeight || Math.min(280, items.length * step + PAD * 2);
    const need = menuHeight + MENU_GAP;
    const resolvedSide =
      placement === 'bottom' && r.bottom + need > window.innerHeight && r.top > need
        ? 'top'
        : placement === 'top' && r.top - need < 0
          ? 'bottom'
          : placement;
    setSide(resolvedSide);

    if (portal) {
      const targetWidth = fullWidth ? Math.max(r.width, menuWidth) : Math.max(r.width, menuWidth);
      const leftPos =
        align === 'right'
          ? Math.max(8, r.right - targetWidth)
          : Math.min(r.left, window.innerWidth - targetWidth - 8);
      setPortalCoords({
        top: resolvedSide === 'bottom' ? r.bottom + MENU_GAP : undefined,
        bottom: resolvedSide === 'top' ? window.innerHeight - r.top + MENU_GAP : undefined,
        left: leftPos,
        width: targetWidth
      });
    }

    el.style.transitionDuration = instant.current ? '0ms' : '';
    el.dataset.state = 'closed';
    void el.offsetHeight;
    el.dataset.state = 'open';
    const p = pillRef.current;
    if (p) {
      p.style.transition = 'none';
      p.style.transform = `translateY(${Math.max(0, selected) * step}px)`;
      p.style.opacity = '0';
      void p.offsetHeight;
      p.style.transition = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useLayoutEffect(() => {
    const p = pillRef.current;
    if (!p || phase !== 'open') return;
    if (active === null || items[active]?.disabled) {
      p.style.opacity = '0';
      return;
    }
    const jump = instant.current || p.style.opacity !== '1';
    p.style.transitionDuration = jump ? '0ms, 150ms' : '';
    p.style.transform = `translateY(${active * step}px)`;
    p.style.opacity = '1';
    instant.current = false;
  }, [active, phase, step]);

  const open = viaKey => {
    if (disabled) return;
    clearTimeout(closeTimer.current);
    instant.current = true;
    const firstEnabled = items.findIndex(it => !it.disabled);
    const startIdx =
      selected >= 0 && !items[selected]?.disabled
        ? selected
        : viaKey
          ? (firstEnabled >= 0 ? firstEnabled : 0)
          : null;
    setActive(startIdx);
    setPhase('open');
  };

  const close = mode => {
    setActive(null);
    clearTimeout(closeTimer.current);
    const el = menuRef.current;
    if (mode === 'instant' || !el) {
      setPhase('closed');
      return;
    }
    el.style.transitionDuration = '';
    el.dataset.state = 'closed';
    setPhase('closing');
    closeTimer.current = setTimeout(() => setPhase('closed'), popOut + 20);
  };

  const pick = (i, viaKey) => {
    const it = items[i];
    if (!it || it.disabled) {
      if (!it) close('instant');
      return;
    }
    if (it.value !== current) {
      if (value === undefined) setInner(it.value);
      onChange?.(it.value, it);
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = '';
    }
    close('instant');
    triggerRef.current?.focus({ preventScroll: true });
  };

  const onTriggerKey = e => {
    const k = e.key;
    const n = items.length;
    const cur = active ?? Math.max(0, selected);
    if (phase !== 'open') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        open(true);
      }
      return;
    }
    const go = i => {
      e.preventDefault();
      instant.current = true;
      setActive(Math.min(n - 1, Math.max(0, i)));
    };
    if (k === 'ArrowDown') {
      const target = active === null ? cur : cur + 1;
      go(findNextEnabled(items, Math.min(n - 1, target), 1));
    } else if (k === 'ArrowUp') {
      const target = active === null ? cur : cur - 1;
      go(findNextEnabled(items, Math.max(0, target), -1));
    } else if (k === 'Home') {
      go(findNextEnabled(items, 0, 1));
    } else if (k === 'End') {
      go(findNextEnabled(items, n - 1, -1));
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      pick(cur, true);
    } else if (k === 'Escape' || k === 'Tab') {
      if (k === 'Escape') e.preventDefault();
      close('instant');
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      go(typeaheadIndex(items, cur, k));
    }
  };

  useEffect(() => {
    if (phase === 'closed') return undefined;
    const onDown = e => {
      const inRoot = rootRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inRoot && !inMenu) close('pop');
    };
    const onViewportChange = e => {
      if (e.type === 'scroll' && menuRef.current?.contains(e.target)) return;
      close('instant');
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (disabled && phase !== 'closed') close('instant');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const rowAt = y => {
    const s = scrub.current;
    if (!s) return null;
    const i = Math.floor((y - s.top - PAD) / step);
    if (i < 0 || i >= items.length || items[i]?.disabled) return null;
    return i;
  };
  const onListDown = e => {
    if (scrub.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    scrub.current = { id: e.pointerId, top: e.currentTarget.getBoundingClientRect().top };
    instant.current = true;
    setActive(rowAt(e.clientY));
  };
  const onListMove = e => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return;
    const i = rowAt(e.clientY);
    if (i !== active) setActive(i);
  };
  const onListUp = e => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return;
    const i = e.type === 'pointerup' ? rowAt(e.clientY) : null;
    scrub.current = null;
    if (i !== null) pick(i, false);
    else if (!rememberPosition) setActive(null);
  };
  const onListOver = e => {
    if (e.pointerType === 'touch' || scrub.current) return;
    const row = e.target.closest('[data-index]');
    if (!row) return;
    const i = Number(row.dataset.index);
    if (items[i]?.disabled) {
      if (active !== null) setActive(null);
      return;
    }
    if (i !== active) setActive(i);
  };

  const origin = `${side === 'bottom' ? 'top' : 'bottom'} ${align}`;
  const cssVars = {
    ...(accentColor ? { '--gs-accent': accentColor } : {}),
    ...(surfaceColor ? { '--gs-surface': surfaceColor } : {}),
    ...(highlightColor ? { '--gs-highlight': highlightColor } : {}),
    ...(textColor ? { '--gs-text': textColor } : {}),
    '--gs-radius': `${radius}px`,
    '--gs-inner-radius': `${Math.max(4, radius - 3)}px`,
    '--gs-chip': `${S.chip}px`,
    '--gs-row': `${S.row}px`,
    '--gs-font': `${S.font}px`,
    '--gs-menu-w': `${menuWidth}px`,
    '--gs-pop': `${popDuration}ms`,
    '--gs-pop-out': `${popOut}ms`,
    '--gs-glide': `${glideDuration}ms`,
    '--gs-origin': origin
  };

  const menuEl =
    phase !== 'closed' ? (
      <div
        ref={menuRef}
        className={`glide-select__menu${portal ? ' glide-select__menu--portal' : ''}`}
        data-state="open"
        data-side={portal ? undefined : side}
        data-align={portal ? undefined : align}
        style={
          portal
            ? {
                ...cssVars,
                top: portalCoords?.top,
                bottom: portalCoords?.bottom,
                left: portalCoords?.left,
                width: portalCoords?.width
              }
            : undefined
        }
      >
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          className="glide-select__list"
          data-live={active !== null ? '' : undefined}
          onPointerOver={onListOver}
          onPointerLeave={() => {
            if (!scrub.current && !rememberPosition) setActive(null);
          }}
          onPointerDown={onListDown}
          onPointerMove={onListMove}
          onPointerUp={onListUp}
          onPointerCancel={onListUp}
          onLostPointerCapture={onListUp}
        >
          <span ref={pillRef} className="glide-select__pill" aria-hidden="true" />
          {items.map((it, i) => (
            <div
              key={it.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              aria-disabled={it.disabled ? 'true' : undefined}
              data-index={i}
              className="glide-select__option"
            >
              <span className="glide-select__name">{it.label}</span>
              {showTags && it.tag ? <span className="glide-select__tag">{it.tag}</span> : null}
              <span className="glide-select__check" data-on={i === selected ? '' : undefined} aria-hidden="true">
                <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.5} />
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={`glide-select${fullWidth ? ' glide-select--full' : ''}${className ? ` ${className}` : ''}`}
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      style={{ ...cssVars, ...style }}
      onAnimationEnd={e => {
        if (e.animationName === 'gs-swap' && rootRef.current) delete rootRef.current.dataset.swap;
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={phase === 'open'}
        aria-controls={`${id}-list`}
        aria-activedescendant={active !== null ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className="glide-select__trigger"
        onPointerDown={e => {
          if (e.button !== 0 || disabled) return;
          e.currentTarget.focus({ preventScroll: true });
          if (phase === 'open') close('pop');
          else open(false);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="glide-select__label" key={current} data-empty={selected < 0 ? '' : undefined}>
          {selected >= 0 ? items[selected].label : placeholder}
        </span>
        <span className="glide-select__chevron" aria-hidden="true">
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.5} />
        </span>
      </button>
      {menuEl && (portal && typeof document !== 'undefined' ? createPortal(menuEl, document.body) : menuEl)}
    </div>
  );
}
