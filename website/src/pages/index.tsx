import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './index.module.css';

const REPO = 'https://github.com/blbaker/daily-dispatch';

function ArrowIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

const STEPS = [
  { name: 'Capture', text: 'A small Python bridge saves every link you send from your phone through Pushbullet.' },
  { name: 'Write', text: 'Once a day a Claude Code skill reads each page and writes a prose digest with a short take on every story.' },
  { name: 'Voice', text: 'The daily-dispatch CLI writes a two-host script from the same stories and reads it with the voice service you pick.' },
  { name: 'Read', text: 'The app shows the edition and plays the episode. The backend keeps every device in sync and sends a push when something new is ready.' },
];

const PLATFORMS = [
  { name: 'Android', detail: 'Phone and e-ink builds of the same Expo app' },
  { name: 'iOS', detail: 'Expo app, built for the simulator in CI' },
  { name: 'Web', detail: 'Static export with Web Push' },
  { name: 'macOS, Linux, Windows', detail: 'The same React Native code on the Impeller engine' },
];

const DOCS = [
  { href: '/docs/setup', title: 'Get started', dek: 'Run the app, the CLI and the pipeline on your machine with sample data.' },
  { href: '/docs/pipeline', title: 'Pipeline', dek: 'Capture links and write the daily digest.' },
  { href: '/docs/podcast-providers', title: 'Podcast providers', dek: 'Script writers, voice services, the voice map and the keys each one needs.' },
  { href: '/docs/daily-podcast', title: 'Daily schedule', dek: 'Make an episode at the same time every day, or not at all.' },
  { href: '/docs/push-setup', title: 'Push notifications', dek: 'Credentials for Android, iOS and the web, and how to test one device.' },
  { href: '/docs/backend', title: 'Backend', dek: 'Deploy the AWS stack and point the clients at it.' },
];

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title="Daily Dispatch"
      description="Turn the links you send from your phone into a daily digest and a two-host podcast, read in an app for phones, e-ink tablets, the web and the desktop."
    >
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <div>
            <h1 className={styles.title}>Daily Dispatch</h1>
            <p className={styles.lede}>
              Send links from your phone during the day. Once a day they come back as a
              written digest and a two-host podcast episode, in a reading app for your phone,
              an e-ink tablet, the web or the desktop.
            </p>
            <div className={styles.ctas}>
              <Link className={styles.ctaPrimary} to={useBaseUrl('/docs/setup')}>
                Get started <ArrowIcon />
              </Link>
              <Link className={styles.ctaSecondary} to={REPO}>
                View source
              </Link>
            </div>
          </div>
          <div className={styles.heroShots}>
            <img className={styles.heroShot} src={useBaseUrl('/screenshots/phone-today.png')} alt="The Today tab on a phone" width={390} height={844} />
            <img className={styles.heroShot} src={useBaseUrl('/screenshots/eink-today.png')} alt="The Today tab in the e-ink build" width={390} height={844} />
          </div>
        </div>
      </header>

      <main>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>How it works</h2>
            <p className={styles.sectionIntro}>
              Each step runs on its own, so you can use the digest without the podcast or
              the app without the backend.
            </p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.name} className={styles.step}>
                <span className={styles.stepText}>{s.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Platforms</h2>
          </div>
          <ul className={styles.rowList}>
            {PLATFORMS.map((p) => (
              <li key={p.name} className={styles.row}>
                <span className={styles.rowName}>{p.name}</span>
                <span className={styles.rowDetail}>{p.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Read the docs</h2>
          </div>
          <ul className={styles.docList}>
            {DOCS.map((d) => (
              <li key={d.href} className={styles.docRow}>
                <Link className={styles.docLink} to={useBaseUrl(d.href)}>
                  <span className={styles.docTitle}>{d.title}</span>
                  <span className={styles.docDek}>{d.dek}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </Layout>
  );
}
