import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  variant?: "full" | "compact";
  priority?: boolean;
  className?: string;
  href?: string;
};

export function BrandLogo({ variant = "full", priority = false, className, href = "/" }: BrandLogoProps) {
  const classes = ["brand-logo", `brand-logo-${variant}`, className].filter(Boolean).join(" ");
  return (
    <Link className={classes} href={href} aria-label="FixxFlow home">
      {variant === "compact" ? <Image
        className="brand-logo-image"
        src="/brand/fixxflow/icon/fixxflow-icon-primary.png"
        width={1139}
        height={1151}
        alt="FixxFlow"
        fetchPriority={priority ? "high" : undefined}
        sizes="44px"
      /> : (["light", "dark"] as const).map(theme => <Image
        key={theme}
        className={`brand-logo-image brand-logo-image-${theme}`}
        src={`/brand/fixxflow/logo/fixxflow-logo-${theme === "light" ? "primary" : "dark-mode"}.png`}
        width={1353}
        height={1334}
        alt="FixxFlow — IT Support in Motion"
        fetchPriority={priority ? "high" : undefined}
        sizes="(max-width: 767px) 180px, 240px"
      />)}
    </Link>
  );
}
