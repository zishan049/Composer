import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust coordinates to keep the menu inside the viewport
  const [adjustedCoords, setAdjustedCoords] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let nextX = x;
      let nextY = y;

      if (x + rect.width > window.innerWidth) {
        nextX = window.innerWidth - rect.width - 8;
      }
      if (y + rect.height > window.innerHeight) {
        nextY = window.innerHeight - rect.height - 8;
      }

      setAdjustedCoords({ x: Math.max(8, nextX), y: Math.max(8, nextY) });
    }
  }, [x, y, items]);

  const handleItemMouseEnter = (e: React.MouseEvent, item: ContextMenuItem, index: number) => {
    if (item.submenu && !item.disabled) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setActiveSubmenuIndex(index);
      
      let subX = rect.right;
      let subY = rect.top;
      
      // Keep submenu in viewport bounds
      if (subX + 180 > window.innerWidth) {
        subX = rect.left - 185;
      }
      if (subY + (item.submenu.length * 36) > window.innerHeight) {
        subY = window.innerHeight - (item.submenu.length * 36) - 10;
      }
      
      setSubmenuCoords({ x: subX, y: Math.max(10, subY) });
    } else {
      setActiveSubmenuIndex(null);
    }
  };

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: `${adjustedCoords.x}px`,
        top: `${adjustedCoords.y}px`,
        zIndex: 9999,
      }}
      className="w-56 bg-paper border border-muted/30 shadow-lg rounded-sm py-1.5 font-sans-meta text-xs select-none animate-in fade-in duration-100 overflow-hidden"
    >
      {items.map((item, index) => {
        if (item.isSeparator) {
          return <div key={index} className="h-px bg-muted/20 my-1.5" />;
        }

        const hasSubmenu = item.submenu && item.submenu.length > 0;
        const isSubmenuActive = activeSubmenuIndex === index;

        return (
          <div
            key={index}
            className={`relative px-3.5 py-1.5 flex items-center justify-between cursor-pointer transition-colors duration-75
              ${item.disabled 
                ? "text-muted/40 cursor-default" 
                : "text-ink hover:bg-cream active:bg-muted/10"
              }`}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled && item.onClick && !hasSubmenu) {
                item.onClick();
                onClose();
              }
            }}
            onMouseEnter={(e) => handleItemMouseEnter(e, item, index)}
          >
            <div className="flex items-center gap-2.5">
              {item.icon && <span className="text-muted text-sm">{item.icon}</span>}
              <span className="font-medium">{item.label}</span>
            </div>

            {hasSubmenu && (
              <span className="text-muted text-[10px] pl-2">&bull;&bull;&bull;</span>
            )}

            {!hasSubmenu && item.shortcut && (
              <span className="text-muted/65 text-[10px] font-mono pl-3">{item.shortcut}</span>
            )}

            {hasSubmenu && isSubmenuActive && !item.disabled && (
              <div
                style={{
                  position: "fixed",
                  left: `${submenuCoords.x}px`,
                  top: `${submenuCoords.y}px`,
                }}
                className="w-48 bg-paper border border-muted/30 shadow-lg rounded-sm py-1.5 overflow-hidden"
                onMouseLeave={() => setActiveSubmenuIndex(null)}
              >
                {item.submenu!.map((subItem, subIdx) => {
                  if (subItem.isSeparator) {
                    return <div key={subIdx} className="h-px bg-muted/20 my-1" />;
                  }

                  return (
                    <div
                      key={subIdx}
                      className={`px-3.5 py-1.5 flex items-center justify-between cursor-pointer transition-colors duration-75
                        ${subItem.disabled 
                          ? "text-muted/40 cursor-default" 
                          : "text-ink hover:bg-cream active:bg-muted/10"
                        }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!subItem.disabled && subItem.onClick) {
                          subItem.onClick();
                          onClose();
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {subItem.icon && <span className="text-muted text-sm">{subItem.icon}</span>}
                        <span className="font-medium">{subItem.label}</span>
                      </div>
                      {subItem.shortcut && (
                        <span className="text-muted/65 text-[10px] font-mono pl-2">{subItem.shortcut}</span>
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

// Global context menu hook helper
export const useCustomContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const showContextMenu = (e: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items,
    });
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
