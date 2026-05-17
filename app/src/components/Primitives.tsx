// Building blocks: Btn, Input, Tag.

import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { IconChevR } from "../lib/icons";

type IconComp = (p: { size?: number; color?: string }) => JSX.Element;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "ghost" | "danger";
  size?: "sm" | "lg";
  icon?: IconComp;
  iconRight?: IconComp;
  children?: ReactNode;
};

export function Btn({ variant, size, icon: Icon, iconRight: IconR, children, ...rest }: BtnProps) {
  return (
    <button className="lhq-btn" data-variant={variant} data-size={size} {...rest}>
      {Icon && <Icon size={size === "lg" ? 16 : 14} />}
      {children}
      {IconR && <IconR size={size === "lg" ? 16 : 14} />}
    </button>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  prefix?: string;
};
export function Input({ label, hint, prefix, style, ...rest }: InputProps) {
  return (
    <label style={{ display: "block" }}>
      {label && <span className="lhq-label">{label}</span>}
      <div style={{ position: "relative" }}>
        {prefix && (
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted-2)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              pointerEvents: "none",
            }}
          >
            {prefix}
          </span>
        )}
        <input
          className="lhq-input"
          style={{
            ...(prefix ? { paddingLeft: 12 + prefix.length * 7 + 4 } : null),
            ...style,
          }}
          {...rest}
        />
      </div>
      {hint && <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 6 }}>{hint}</div>}
    </label>
  );
}

type TagProps = { children: ReactNode; tone?: "accent" | "warn" | "danger"; mono?: boolean; style?: React.CSSProperties };
export function Tag({ children, tone, mono = true, style }: TagProps) {
  return (
    <span
      className="lhq-tag"
      data-tone={tone}
      style={{ fontFamily: mono ? "var(--mono)" : "var(--sans)", ...style }}
    >
      {children}
    </span>
  );
}

export function ChevR({ size = 14, color = "var(--muted-2)" }: { size?: number; color?: string }) {
  return <IconChevR size={size} color={color} />;
}
