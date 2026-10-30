import type { CSSProperties, ReactNode } from 'react';
import { Body, Container, Head, Heading, Html, Preview } from 'react-email';

import { emailLogoPath } from './brand';

/*
 * Email UI kit (React Email, FixxFlow theme). Mail clients ignore stylesheets and CSS variables,
 * so these components carry inline equivalents of the light-theme tokens in DESIGN_SYSTEM.md and
 * keep table-based layout for Outlook. React escapes every text value and attribute.
 */
export const emailTokens = {
  canvas: '#f1f3f5',
  surface: '#ffffff',
  subtle: '#f1f3f5',
  text: '#212529',
  muted: '#545b62',
  action: '#ffd700',
  actionHover: '#e6c200',
  ink: '#212529',
  warningSurface: '#fff0d9',
  warningText: '#8a4b00',
  body: "Outfit,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
  heading: "'Rethink Sans',Arial,sans-serif",
} as const;

const t = emailTokens;

function fontStyles(origin: string) {
  return `@font-face{font-family:Outfit;src:url('${origin}/brand/fixxflow/fonts/Outfit-Variable.ttf') format('truetype');font-weight:100 900;font-display:swap}@font-face{font-family:'Rethink Sans';src:url('${origin}/brand/fixxflow/fonts/RethinkSans-Variable.ttf') format('truetype');font-weight:400 800;font-display:swap}h1,h2,strong,b{font-family:'Rethink Sans',Arial,sans-serif}.email-action:hover{background:${t.actionHover}!important}.email-action:focus{outline:3px solid ${t.ink};outline-offset:3px}@media(max-width:480px){.email-action-table{width:100%!important}.email-action{display:block!important;text-align:center!important}}@media(forced-colors:active){.email-action{border-color:ButtonText!important;background:ButtonFace!important;color:ButtonText!important}}`;
}

/** Outlook ignores CSS backgrounds on cells; the legacy attribute is absent from React's types. */
function cellBackground(color?: string): Record<string, string> {
  return color ? { bgcolor: color } : {};
}

const presentation = {
  role: 'presentation',
  width: '100%',
  cellPadding: 0,
  cellSpacing: 0,
} as const;

/** Page shell: preheader, branded card, header, content cell and one support footer. */
export function EmailLayout({
  title,
  preview,
  origin,
  workspaceName,
  children,
}: {
  title: string;
  preview: string;
  origin: string;
  workspaceName?: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{`${title} | FixxFlow`}</title>
        <style dangerouslySetInnerHTML={{ __html: fontStyles(origin) }} />
      </Head>
      <Body
        style={{
          margin: 0,
          padding: 0,
          background: t.canvas,
          color: t.text,
          fontFamily: t.body,
          fontSize: '16px',
          lineHeight: '24px',
        }}
      >
        {/* The layout sets the document title; keep the preview text out of a second <title>. */}
        <Preview useTitleTag={false}>{preview}</Preview>
        <table {...presentation} style={{ background: t.canvas }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 12px' }}>
                <Container
                  style={{
                    maxWidth: '560px',
                    background: t.surface,
                    border: 0,
                    borderRadius: '16px',
                  }}
                >
                  <EmailBrandBar />
                  <EmailHeader origin={origin} workspaceName={workspaceName} />
                  <table {...presentation}>
                    <tbody>
                      <tr>
                        <td
                          align="left"
                          style={{
                            padding: '20px 24px 24px',
                            textAlign: 'left',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {children}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <EmailFooter />
                </Container>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

function EmailBrandBar() {
  return (
    <table {...presentation} aria-hidden="true">
      <tbody>
        <tr>
          <td
            height="4"
            {...cellBackground(t.action)}
            style={{
              height: '4px',
              fontSize: 0,
              lineHeight: 0,
              background: t.action,
              backgroundImage: `linear-gradient(90deg,${t.action},${t.actionHover})`,
              borderRadius: '16px 16px 0 0',
            }}
          >
            {' '}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function EmailHeader({ origin, workspaceName }: { origin: string; workspaceName?: string }) {
  return (
    <table {...presentation}>
      <tbody>
        <tr>
          <td align="left" style={{ padding: '24px 24px 0', background: t.surface }}>
            <a href={origin} style={{ textDecoration: 'none' }}>
              {/* Low fetch priority stops React adding a preload tag, which mail clients ignore. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- emails cannot use next/image */}
              <img
                src={`${origin}${emailLogoPath}`}
                width="136"
                alt="FixxFlow"
                fetchPriority="low"
                style={{
                  display: 'block',
                  width: '136px',
                  maxWidth: '100%',
                  height: 'auto',
                  border: 0,
                  color: t.text,
                  fontSize: '16px',
                }}
              />
            </a>
            {workspaceName && (
              <p
                style={{
                  margin: '12px 0 0',
                  fontSize: '14px',
                  lineHeight: '22px',
                  fontWeight: 600,
                  fontFamily: t.heading,
                  color: t.text,
                  overflowWrap: 'anywhere',
                }}
              >
                {workspaceName}
              </p>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function EmailFooter() {
  return (
    <table {...presentation}>
      <tbody>
        <tr>
          <td
            align="left"
            style={{
              textAlign: 'left',
              padding: '16px 24px',
              borderTop: `1px solid ${t.subtle}`,
              color: t.muted,
              fontSize: '13px',
              lineHeight: '20px',
            }}
          >
            Need help?{' '}
            <a
              href="mailto:support@fixxflow.app"
              style={{ color: t.muted, textDecoration: 'underline' }}
            >
              Contact FixxFlow support
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Small label above the title naming why the person received the email. */
export function EmailEyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: '0 0 8px',
        color: t.muted,
        fontSize: '14px',
        lineHeight: '22px',
        fontWeight: 500,
      }}
    >
      {children}
    </p>
  );
}

export function EmailTitle({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      style={{
        margin: '0 0 16px',
        fontSize: '24px',
        lineHeight: '32px',
        fontWeight: 700,
        fontFamily: t.heading,
        letterSpacing: '-0.3px',
        color: t.text,
      }}
    >
      {children}
    </Heading>
  );
}

/** Body paragraph. `lines` keeps author line breaks without interpreting any markup. */
export function EmailText({
  children,
  lines,
  style,
}: {
  children?: ReactNode;
  lines?: string;
  style?: CSSProperties;
}) {
  return (
    <p style={{ margin: '0 0 20px', color: t.text, ...style }}>
      {lines !== undefined
        ? lines
            .split(/\r?\n/)
            .flatMap((line, index) => (index ? [<br key={index} />, line] : [line]))
        : children}
    </p>
  );
}

/**
 * Supabase evaluates Go template branches inside auth emails. They are trusted, author-written
 * constants (never user data) and must reach Supabase unescaped, so they bypass React escaping.
 */
export function EmailTemplateText({ html, style }: { html: string; style: CSSProperties }) {
  return <p style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function EmailStatus({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: '22px', color: t.text }}>
      <strong>Status:</strong> {children}
    </p>
  );
}

/** Labelled key/value rows with a visible caption for screen readers and sighted readers. */
export function EmailDetails({
  caption,
  rows,
}: {
  caption: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <table
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: '0 0 24px', textAlign: 'left', fontSize: '14px', lineHeight: '22px' }}
    >
      <caption
        style={{
          textAlign: 'left',
          fontWeight: 600,
          fontFamily: t.heading,
          color: t.text,
          padding: '0 0 8px',
        }}
      >
        {caption}
      </caption>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            <th
              scope="row"
              style={{
                width: '35%',
                padding: '6px 12px 6px 0',
                color: t.muted,
                fontWeight: 500,
                verticalAlign: 'top',
              }}
            >
              {row.label}
            </th>
            <td style={{ padding: '6px 0', color: t.text, overflowWrap: 'anywhere' }}>
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Quoted or highlighted block; the warning tone is reserved for security notices. */
export function EmailCallout({
  heading,
  tone = 'neutral',
  children,
  style,
}: {
  heading: string;
  tone?: 'neutral' | 'warning';
  children: ReactNode;
  style?: CSSProperties;
}) {
  const warning = tone === 'warning';
  const surface = warning ? t.warningSurface : t.subtle;
  return (
    <table {...presentation} style={style ?? { margin: '0 0 24px', textAlign: 'left' }}>
      <tbody>
        <tr>
          <td
            align="left"
            {...cellBackground(warning ? surface : undefined)}
            style={{
              ...(warning ? { textAlign: 'left' as const } : {}),
              padding: '16px',
              background: surface,
              borderRadius: '8px',
            }}
          >
            <h2
              style={{
                margin: '0 0 8px',
                color: warning ? t.warningText : t.text,
                fontSize: warning ? '14px' : '16px',
                lineHeight: warning ? '22px' : '24px',
                fontWeight: warning ? 700 : 600,
                fontFamily: t.heading,
              }}
            >
              {heading}
            </h2>
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmailQuote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        color: t.text,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontSize: '16px',
        lineHeight: '24px',
      }}
    >
      {children}
    </p>
  );
}

/** One-time code, large and spaced for reading aloud or copying. */
export function EmailCode({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: '0 0 24px',
        padding: '16px',
        background: t.subtle,
        border: 0,
        borderRadius: '8px',
        fontSize: '28px',
        lineHeight: '36px',
        fontWeight: 700,
        fontFamily: t.heading,
        letterSpacing: '6px',
        textAlign: 'left',
      }}
    >
      {children}
    </p>
  );
}

/**
 * Primary action: a bulletproof table button (solid yellow, charcoal label and edge) plus a short
 * underlined fallback link. Outlook reads the `mso-padding-alt` hints; phones get a full-width CTA.
 */
export function EmailAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <>
      <table
        role="presentation"
        className="email-action-table"
        style={{ margin: '4px 0 0', maxWidth: '100%' }}
        cellPadding={0}
        cellSpacing={0}
      >
        <tbody>
          <tr>
            <td
              align="center"
              {...cellBackground(t.action)}
              style={{ borderRadius: '8px', msoPaddingAlt: '12px 20px' } as CSSProperties}
            >
              <a
                className="email-action"
                href={href}
                style={
                  {
                    display: 'inline-block',
                    padding: '12px 20px',
                    minHeight: '24px',
                    border: `1px solid ${t.ink}`,
                    borderRadius: '8px',
                    background: t.action,
                    color: t.ink,
                    textAlign: 'center',
                    textDecoration: 'none',
                    overflowWrap: 'anywhere',
                    fontSize: '16px',
                    fontWeight: 600,
                    fontFamily: t.heading,
                    lineHeight: '24px',
                    msoPaddingAlt: 0,
                    msoTextRaise: '1pt',
                  } as CSSProperties
                }
              >
                {children}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ margin: '12px 0 0', fontSize: '13px', lineHeight: '20px', color: t.muted }}>
        Or{' '}
        <a href={href} style={{ color: t.ink, textDecoration: 'underline' }}>
          open this link
        </a>
        .
      </p>
    </>
  );
}

export function EmailNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        textAlign: 'left',
        margin: '24px 0 0',
        color: t.muted,
        fontSize: '14px',
        lineHeight: '22px',
      }}
    >
      {children}
    </p>
  );
}
