import Image from "next/image";

type AvatarProps = {
  name: string;
  src?: string | null;
  size?: "small" | "medium" | "large";
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

export function Avatar({ name, src, size = "medium" }: AvatarProps) {
  return (
    <span className={`avatar avatar-${size}`} aria-label={name} role="img">
      {src ? <Image src={src} alt="" fill sizes={size === "large" ? "64px" : size === "small" ? "32px" : "40px"} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}
