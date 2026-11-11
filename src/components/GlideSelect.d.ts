import React from "react";

export interface GlideSelectOption {
  value: string;
  label: string;
  tag?: string;
  disabled?: boolean;
}

export interface GlideSelectProps {
  options: Array<string | GlideSelectOption>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, option?: GlideSelectOption) => void;
  placeholder?: string;
  showTags?: boolean;
  accentColor?: string;
  surfaceColor?: string;
  highlightColor?: string;
  textColor?: string;
  size?: "sm" | "md" | "lg";
  radius?: number;
  menuWidth?: number;
  placement?: "bottom" | "top";
  align?: "left" | "right";
  popDuration?: number;
  glideDuration?: number;
  rememberPosition?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  portal?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

declare const GlideSelect: React.FC<GlideSelectProps>;
export default GlideSelect;
