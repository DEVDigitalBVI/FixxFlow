import Image from 'next/image';
import Link from 'next/link';

type BrandLogoProps = {
  variant?: 'full' | 'full-inverse' | 'horizontal' | 'compact' | 'navigation';
  priority?: boolean;
  className?: string;
  href?: string;
};

export function BrandLogo({
  variant = 'full',
  priority = false,
  className,
  href = '/',
}: BrandLogoProps) {
  const classes = ['brand-logo', `brand-logo-${variant}`, className].filter(Boolean).join(' ');
  if (variant === 'navigation')
    return (
      <Link className={classes} href={href} aria-label="FixxFlow home">
        <Image
          className="brand-logo-navigation-icon"
          src="/brand/fixxflow/icon/fixxflow-icon-primary.png?v=red-navy-20261030"
          width={1139}
          height={1151}
          alt=""
          preload={priority}
          sizes="44px"
        />
        <span className="brand-logo-navigation-artwork" aria-hidden="true">
          <Image
            className="brand-logo-image brand-logo-image-light"
            src="/brand/fixxflow/logo/fixxflow-logo-horizontal-full.png?v=red-navy-20261030"
            width={2172}
            height={724}
            alt=""
            fetchPriority={priority ? 'high' : undefined}
            sizes="176px"
          />
          <Image
            className="brand-logo-image brand-logo-image-dark"
            src="/brand/fixxflow/logo/fixxflow-logo-horizontal-dark.png?v=red-navy-20261030"
            width={2172}
            height={724}
            alt=""
            fetchPriority={priority ? 'high' : undefined}
            sizes="176px"
          />
        </span>
      </Link>
    );
  return (
    <Link className={classes} href={href} aria-label="FixxFlow home">
      {variant === 'full-inverse' ? (
        <Image
          className="brand-logo-image"
          src="/brand/fixxflow/logo/fixxflow-logo-dark-mode-transparent.png?v=red-navy-20261030"
          width={1353}
          height={1334}
          alt="FixxFlow — IT Support in Motion"
          preload={priority}
          sizes="(max-width: 767px) 180px, 220px"
        />
      ) : variant === 'compact' ? (
        <Image
          className="brand-logo-image"
          src="/brand/fixxflow/icon/fixxflow-icon-primary.png?v=red-navy-20261030"
          width={1139}
          height={1151}
          alt="FixxFlow"
          preload={priority}
          sizes="44px"
        />
      ) : variant === 'horizontal' ? (
        <Image
          className="brand-logo-image"
          src="/brand/fixxflow/logo/fixxflow-logo-horizontal-full.png?v=red-navy-20261030"
          width={2172}
          height={724}
          alt="FixxFlow — IT Support in Motion"
          preload={priority}
          sizes="(max-width: 767px) 44px, 176px"
        />
      ) : (
        (['light', 'dark'] as const).map((theme) => (
          <Image
            key={theme}
            className={`brand-logo-image brand-logo-image-${theme}`}
            src={`/brand/fixxflow/logo/fixxflow-logo-${theme === 'light' ? 'primary' : 'dark-mode-transparent'}.png?v=red-navy-20261030`}
            width={1353}
            height={1334}
            alt="FixxFlow — IT Support in Motion"
            fetchPriority={priority ? 'high' : undefined}
            sizes="(max-width: 767px) 180px, 240px"
          />
        ))
      )}
    </Link>
  );
}
