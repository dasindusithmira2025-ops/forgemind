import { SecurityPrinciple } from '@/types';

export const securityData = {
  title: 'Security & Trust Center',
  description:
    'Corelith Technologies builds software that keeps your work on your machine, asks before it does anything irreversible, and ships releases you can verify for yourself.',
  principles: [
    {
      title: 'Private by default',
      description:
        'Telemetry is off or opt-in, never on quietly. Your work is kept separate per project, and anything that does leave your machine goes over an encrypted connection.',
      iconName: 'ShieldCheck',
    },
    {
      title: 'Asks before it acts',
      description:
        'Agents and background tasks work inside limits you set. Anything that could destroy work stops and waits for you rather than deciding on your behalf.',
      iconName: 'Lock',
    },
    {
      title: 'Releases you can verify',
      description:
        'Builds for Windows, macOS, and Linux are digitally signed and published with checksums, so you can confirm a download is genuine before you install it.',
      iconName: 'FileCheck',
    },
    {
      title: 'Responsible disclosure',
      description:
        'We welcome security researchers and developers to report potential vulnerabilities under our coordinated disclosure process.',
      iconName: 'AlertTriangle',
    },
  ] as SecurityPrinciple[],
  reportingProcess: [
    'Send encrypted details to security@corelithtechnologies.com.',
    'Include clear steps to reproduce, the affected version, and anything that helps us see it happen.',
    'We acknowledge receipt within 24 hours and keep you updated as we work on it.',
    'We agree the public advisory with you once a fix is out.',
  ],
};
