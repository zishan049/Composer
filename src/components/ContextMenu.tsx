import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { ChevronRight } from "lucide-react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  isSeparator?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState<number | null>(null);
  const [submenuCoords, setSubmenuCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  const [adjustedCoords, setAdjustedCoords] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let nextX = x;
      let nextY = y;
      if (x + rect.width  > window.innerWidth)  nextX = window.innerWidth  - rect.width  - 8;
      if (y + rect.height > window.innerHeight) nextY = window.innerHeight - rect.height - 8;
      setAdjustedCoords({ x: Math.max(8, nextX), y: Math.max(8, nextY) });
    }
  }, [x, y, items]);

  const handleItemMouseEnter = (e: React.MouseEvent, item: ContextMenuItem, index: number) => {
    if (item.submenu && !item.disabled) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setActiveSubmenuIndex(index);
      let subX = rect.right + 4;
      let subY = rect.top;
      if (subX + 180 > window.innerWidth)                    subX = rect.left - 185;
      if (subY + (item.submenu.length * 34) > window.innerHeight) subY = window.innerHeight - (item.submenu.length * 34) - 10;
      setSubmenuCoords({ x: subX, y: Math.max(10, subY) });
    } else {
      setActiveSubmenuIndex(null);
    }
  };

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{
        position: "fixed",
        left: `${adjustedCoords.x}px`,
        top:  `${adjustedCoords.y}px`,
        zIndex: 9999,
      }}
    >
      {items.map((item, index) => {
        if (item.isSeparator) {
          return <div key={index} className="ctx-separator" />;
        }

        const hasSubmenu    = item.submenu && item.submenu.length > 0;
        const isSubmenuActive = activeSubmenuIndex === index;

        return (
          <div
            key={index}
            className={`ctx-item ${item.disabled ? "ctx-item--disabled" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled && item.onClick && !hasSubmenu) {
                item.onClick();
                onClose();
              }
            }}
            onMouseEnter={(e) => handleItemMouseEnter(e, item, index)}
          >
            <div className="ctx-item-left">
              {item.icon && <span className="ctx-item-icon">{item.icon}</span>}
              <span className="ctx-item-label">{item.label}</span>
            </div>

            {hasSubmenu && (
              <ChevronRight size={10} className="ctx-submenu-arrow" />
            )}

            {!hasSubmenu && item.shortcut && (
              <span className="ctx-item-shortcut">{item.shortcut}</span>
            )}

            {/* Submenu */}
            {hasSubmenu && isSubmenuActive && !item.disabled && (
              <div
                className="ctx-submenu"
                style={{
                  position: "fixed",
                  left: `${submenuCoords.x}px`,
                  top:  `${submenuCoords.y}px`,
                }}
                onMouseLeave={() => setActiveSubmenuIndex(null)}
              >
                {item.submenu!.map((subItem, subIdx) => {
                  if (subItem.isSeparator) {
                    return <div key={subIdx} className="ctx-separator" />;
                  }
                  return (
                    <div
                      key={subIdx}
                      className={`ctx-item ${subItem.disabled ? "ctx-item--disabled" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!subItem.disabled && subItem.onClick) {
                          subItem.onClick();
                          onClose();
                        }
                      }}
                    >
                      <div className="ctx-item-left">
                        {subItem.icon && <span className="ctx-item-icon">{subItem.icon}</span>}
                        <span className="ctx-item-label">{subItem.label}</span>
                      </div>
                      {subItem.shortcut && (
                        <span className="ctx-item-shortcut">{subItem.shortcut}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
};

// Global context menu hook helper (unchanged)
export const useCustomContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const showContextMenu = (e: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const closeContextMenu = () => setContextMenu(null);

  const ContextMenuComponent = contextMenu ? (
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={contextMenu.items}
      onClose={closeContextMenu}
    />
  ) : null;

  return { showContextMenu, closeContextMenu, ContextMenuComponent };
};
