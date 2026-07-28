import { SecurityPrinciple } from '@/types';

export const securityData = {
  title: 'Security & Trust Center',
  description:
    'Corelith Technologies designs software around strict data isolation, minimal privilege, signed distribution pipelines, and transparent system behavior.',
  principles: [
    {
      title: 'Secure-by-Default Architecture',
      description:
        'All client telemetry is opt-in or disabled by default. Network communication requires TLS 1.3 encryption, and data storage is isolated per local project workspace.',
      iconName: 'ShieldCheck',
    },
    {
      title: 'Least-Privilege Execution',
      description:
        'Agents, background tasks, and embedded processes operate within explicit permission boundaries. Command execution requires explicit approval configurations.',
      iconName: 'Lock',
    },
    {
      title: 'Signed Binary & Release Integrity',
      description:
        'Production releases for Windows, macOS, and Linux are digitally signed with cryptographic SHA-256 checksums provided for independent offline verification.',
      iconName: 'FileCheck',
    },
    {
      title: 'Responsible Vulnerability Disclosure',
      description:
        'We welcome security researchers and developers to report potential vulnerabilities under our coordinated disclosure framework.',
      iconName: 'AlertTriangle',
    },
  ] as SecurityPrinciple[],
  reportingProcess: [
    'Send encrypted details to security@corelithtechnologies.com.',
    'Include clear steps to reproduce, affected software versions, and proof-of-concept logs.',
    'We acknowledge receipt within 24 hours and provide regular progress updates.',
    'We coordinate public advisory release after fixes are deployed and verified.',
  ],
};
