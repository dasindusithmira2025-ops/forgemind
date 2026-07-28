import { CareerRole } from '@/types';

export const careersData = {
  cultureTitle: 'Engineering with Craft & Autonomy',
  cultureDescription:
    'Corelith Technologies is built by people who take genuine pride in software engineering, system performance, interface precision, and technical rigor. We favor small, high-agency teams over bureaucratic structures.',
  values: [
    {
      title: 'High Agency & Ownership',
      description:
        'You own projects from initial system architecture to production deployment and long-term polish.',
    },
    {
      title: 'Deep Work & Low Noise',
      description:
        'We minimize unnecessary meetings and status reporting in favor of asynchronous communication, written specs, and working code.',
    },
    {
      title: 'Obsession with Performance',
      description:
        'Whether tuning compiler passes or UI frame rates, we care deeply about making software feel instantaneous.',
    },
  ],
  openPositions: [] as CareerRole[], // Honest empty state when no public roles are active
};
