'use client';

import { useState } from 'react';

const CATEGORIES = [
  { value: 'business', label: 'Business & enterprise' },
  { value: 'product-support', label: 'Product & early access' },
  { value: 'partnership', label: 'Partnership & distribution' },
  { value: 'security', label: 'Security vulnerability' },
  { value: 'careers', label: 'Careers & engineering' },
  { value: 'press', label: 'Press & media' },
  { value: 'general', label: 'General information' },
];

const EMPTY = {
  name: '',
  email: '',
  category: 'business',
  company: '',
  message: '',
  websiteHoneypot: '',
};

export function ContactForm() {
  const [formData, setFormData] = useState(EMPTY);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [inquiryId, setInquiryId] = useState('');

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus('success');
        setInquiryId(data.inquiryId || '');
        setFormData(EMPTY);
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Submission failed. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Network error. Please check your connection and retry.');
    }
  };

  if (status === 'success') {
    return (
      <div className="panel p-6 sm:p-10">
        <p className="stamp text-signal flex items-center gap-2.5">
          <span aria-hidden="true" className="bg-signal inline-block h-1.5 w-1.5 rounded-full" />
          Inquiry received
        </p>

        <h2 className="mt-5 text-xl">Thank you — it is in the queue.</h2>

        <dl className="mt-6 border-t border-[var(--hair)]">
          <div className="flex items-baseline justify-between gap-6 border-b border-[var(--hair)] py-3">
            <dt className="stamp text-faint">Reference</dt>
            <dd className="text-lume font-mono text-sm">{inquiryId || '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-6 border-b border-[var(--hair)] py-3">
            <dt className="stamp text-faint">Typical response</dt>
            <dd className="text-lume font-mono text-sm">Within 24 hours</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="btn btn-secondary mt-8"
        >
          Send another
          <span aria-hidden="true">→</span>
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="panel p-6 sm:p-10">
      <h2 className="text-xl">Send an inquiry</h2>
      <p className="stamp text-faint mt-2.5">
        Routed to engineering, business, or security by category
      </p>

      {/* Honeypot field (hidden from legitimate users) */}
      <div className="hidden" aria-hidden="true">
        <input
          type="text"
          name="websiteHoneypot"
          tabIndex={-1}
          value={formData.websiteHoneypot}
          onChange={handleChange}
          autoComplete="off"
        />
      </div>

      {status === 'error' && (
        <p
          role="alert"
          className="border-danger text-danger mt-6 flex items-start gap-3 border-l-4 py-2 pl-4 text-sm"
        >
          {errorMessage}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 border-t border-[var(--hair)] pt-8 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="stamp text-faint mb-2.5 block">
            Full name <span className="text-iris-lift">·required</span>
          </label>
          <input
            id="name"
            type="text"
            name="name"
            required
            autoComplete="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Jane Doe"
            className="field"
          />
        </div>

        <div>
          <label htmlFor="email" className="stamp text-faint mb-2.5 block">
            Work email <span className="text-iris-lift">·required</span>
          </label>
          <input
            id="email"
            type="email"
            name="email"
            required
            autoComplete="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="jane@company.com"
            className="field"
          />
        </div>

        <div>
          <label htmlFor="category" className="stamp text-faint mb-2.5 block">
            Category <span className="text-iris-lift">·required</span>
          </label>
          <select
            id="category"
            name="category"
            value={formData.category}
            onChange={handleChange}
            className="field"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="company" className="stamp text-faint mb-2.5 block">
            Company <span className="text-faint">·optional</span>
          </label>
          <input
            id="company"
            type="text"
            name="company"
            autoComplete="organization"
            value={formData.company}
            onChange={handleChange}
            placeholder="Acme Corp"
            className="field"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="message" className="stamp text-faint mb-2.5 block">
            Message <span className="text-iris-lift">·required</span>
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={5}
            value={formData.message}
            onChange={handleChange}
            placeholder="Describe your request, project scale, or inquiry details…"
            className="field resize-y"
          />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-6">
        <button type="submit" disabled={status === 'submitting'} className="btn btn-primary">
          {status === 'submitting' ? 'Sending…' : 'Submit inquiry'}
          {status !== 'submitting' && <span aria-hidden="true">→</span>}
        </button>
        <p className="stamp text-faint">Reviewed within 24 hours</p>
      </div>
    </form>
  );
}
