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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const subject = `[${formData.category}] Website inquiry from ${formData.name}`;
    const body = [
      `Name: ${formData.name}`,
      `Email: ${formData.email}`,
      `Company: ${formData.company || 'Not provided'}`,
      `Category: ${formData.category}`,
      '',
      formData.message,
    ].join('\n');

    window.location.href = `mailto:contact@corelithtechnologies.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <form onSubmit={handleSubmit} className="panel p-6 sm:p-10">
      <h2 className="text-xl">Send an inquiry</h2>
      <p className="stamp text-ink-faint mt-2.5">
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

      <div className="mt-8 grid grid-cols-1 gap-6 border-t border-[var(--hair)] pt-8 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="stamp text-ink-faint mb-2.5 block">
            Full name <span className="text-core-ink">·required</span>
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
          <label htmlFor="email" className="stamp text-ink-faint mb-2.5 block">
            Work email <span className="text-core-ink">·required</span>
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
          <label htmlFor="category" className="stamp text-ink-faint mb-2.5 block">
            Category <span className="text-core-ink">·required</span>
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
          <label htmlFor="company" className="stamp text-ink-faint mb-2.5 block">
            Company <span className="text-ink-faint">·optional</span>
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
          <label htmlFor="message" className="stamp text-ink-faint mb-2.5 block">
            Message <span className="text-core-ink">·required</span>
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
        <button type="submit" className="btn btn-primary">
          Open email draft
          <span aria-hidden="true">→</span>
        </button>
        <p className="stamp text-ink-faint">Send from your email client</p>
      </div>
    </form>
  );
}
