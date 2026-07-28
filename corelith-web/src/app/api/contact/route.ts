import { NextResponse } from 'next/server';
import { z } from 'zod';

const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid work email address'),
  category: z.enum([
    'product-support',
    'business',
    'partnership',
    'security',
    'careers',
    'press',
    'general',
  ]),
  company: z.string().optional(),
  message: z.string().min(10, 'Message must be at least 10 characters long'),
  websiteHoneypot: z.string().optional(),
});

// Simple in-memory rate-limiter for demonstration
const ipCache = new Map<string, number>();

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Honeypot anti-spam check
    if (body.websiteHoneypot && body.websiteHoneypot.trim() !== '') {
      // Silently reject spam without leaking details
      return NextResponse.json({ success: true, message: 'Inquiry received successfully.' });
    }

    // Rate Limiting Check
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const lastRequest = ipCache.get(ip);
    const now = Date.now();
    if (lastRequest && now - lastRequest < 10000) { // 10s cooldown
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please wait a few seconds before resubmitting.' },
        { status: 429 }
      );
    }
    ipCache.set(ip, now);

    // Validate Input
    const validatedData = contactSchema.parse(body);

    // Log received submission in server log (without secrets)
    console.log('[CORELITH_CONTACT_INQUIRY]', {
      timestamp: new Date().toISOString(),
      category: validatedData.category,
      email: validatedData.email,
      name: validatedData.name,
      company: validatedData.company || 'N/A',
    });

    return NextResponse.json({
      success: true,
      message: 'Your inquiry has been logged and assigned to the relevant Corelith team.',
      inquiryId: `CRL-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        // zod v4 renamed ZodError.errors to .issues; .errors no longer exists.
        { success: false, error: error.issues[0]?.message || 'Invalid form data provided.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'An unexpected server error occurred. Please try again later.' },
      { status: 500 }
    );
  }
}
