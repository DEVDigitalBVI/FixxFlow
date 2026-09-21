import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  variant?: "horizontal" | "dark" | "icon";
  priority?: boolean;
  className?: string;
  href?: string;
};

const assets = {
  horizontal: {
    src: "/brand/fixxflow/source/fixxflow-horizontal-raster-master.png",
    width: 2172,
    height: 724,
    alt: "FixxFlow — IT Support in Motion",
  },
  dark: {
    src: "/brand/fixxflow/logo/fixxflow-logo-dark-mode.png",
    width: 1353,
    height: 1334,
    alt: "FixxFlow — IT Support in Motion",
  },
  icon: {
    src: "/brand/fixxflow/icon/fixxflow-icon-primary.png",
    width: 1139,
    height: 1151,
    alt: "FixxFlow",
  },
} as const;

export function BrandLogo({ variant = "horizontal", priority = false, className, href = "/" }: BrandLogoProps) {
  const asset = assets[variant];
  const classes = ["brand-logo", `brand-logo-${variant}`, className].filter(Boolean).join(" ");
  return (
    <Link className={classes} href={href} aria-label="FixxFlow home">
      <Image className="brand-logo-image" src={asset.src} width={asset.width} height={asset.height} alt={asset.alt} priority={priority} sizes={variant === "icon" ? "48px" : "(max-width: 768px) 180px, 240px"} />
    </Link>
  );
}
