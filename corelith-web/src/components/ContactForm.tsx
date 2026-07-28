'use client';

import { useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    category: 'business',
    company: '',
    message: '',
    websiteHoneypot: '',
  });

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
        setFormData({
          name: '',
          email: '',
          category: 'business',
          company: '',
          message: '',
          websiteHoneypot: '',
        });
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Failed to submit form.');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage('Network error. Please verify your connection.');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto corelith-card p-6 sm:p-10 shadow-2xl space-y-6">
      <div>
        <h3 className="text-xl font-bold text-white font-heading">
          Send an Inquiry to Corelith
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          Select your inquiry type. Submissions are routed directly to our engineering and business teams.
        </p>
      </div>

      {status === 'success' ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-xl space-y-3 animate-in fade-in duration-200 text-left">
          <div className="flex items-center gap-2 text-emerald-400 font-bold">
            <CheckCircle2 className="w-5 h-5" />
            <span>Inquiry Received</span>
          </div>
          <p className="text-sm text-gray-300">
            Thank you for reaching out to Corelith Technologies. Your inquiry reference ID is{' '}
            <strong className="text-white font-mono">{inquiryId}</strong>.
          </p>
          <p className="text-xs text-gray-400">
            Our team typically reviews and responds within 24 hours.
          </p>
          <button
            onClick={() => setStatus('idle')}
            className="pt-2 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
          >
            Send another message &rarr;
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
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
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-xs font-mono font-medium text-gray-300 mb-1">
                Full Name <span className="text-indigo-400">*</span>
              </label>
              <input
                id="name"
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                placeholder="Jane Doe"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#08090c] border border-white/10 text-white text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-mono font-medium text-gray-300 mb-1">
                Work Email <span className="text-indigo-400">*</span>
              </label>
              <input
                id="email"
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="jane@company.com"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#08090c] border border-white/10 text-white text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="category" className="block text-xs font-mono font-medium text-gray-300 mb-1">
                Inquiry Category <span className="text-indigo-400">*</span>
              </label>
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#08090c] border border-white/10 text-white text-sm focus:border-indigo-500 focus:outline-none font-mono"
              >
                <option value="business">Business & Enterprise Inquiry</option>
                <option value="product-support">Product & Early Access Support</option>
                <option value="partnership">Partnership & Distribution</option>
                <option value="security">Security Vulnerability Report</option>
                <option value="careers">Careers & Engineering Inquiry</option>
                <option value="press">Press & Media</option>
                <option value="general">General Information</option>
              </select>
            </div>

            <div>
              <label htmlFor="company" className="block text-xs font-mono font-medium text-gray-300 mb-1">
                Company / Organization
              </label>
              <input
                id="company"
                type="text"
                name="company"
                value={formData.company}
                onChange={handleChange}
                placeholder="Acme Corp (Optional)"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#08090c] border border-white/10 text-white text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="message" className="block text-xs font-mono font-medium text-gray-300 mb-1">
              Message Details <span className="text-indigo-400">*</span>
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={4}
              value={formData.message}
              onChange={handleChange}
              placeholder="Describe your request, project scale, or inquiry details..."
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#08090c] border border-white/10 text-white text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all"
            >
              {status === 'submitting' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing Submission...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Inquiry</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
