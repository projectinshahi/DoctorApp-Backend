// Transactional email, through Resend's HTTP API.
//
// HTTP rather than SMTP because Render's free instances block the SMTP ports.
// Like push.service, it never throws and works before it is configured:
// without RESEND_API_KEY it logs what it would have sent, so signup can be
// tested end to end before an account exists.
//
// EMAIL_FROM must be an address on a domain verified in Resend. Until one is,
// Resend's own onboarding@resend.dev works, but only delivers to the email
// the Resend account was opened with.

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — would send "${subject}" to ${to}: ${text}`);
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Dr. SKM's Academy <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend refused (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('[email] send failed:', error.message);
    return false;
  }
}

function sendOtpEmail(to, code) {
  return sendEmail({
    to,
    subject: `${code} is your verification code`,
    text: `Your verification code is ${code}. It expires in 10 minutes. If you did not sign up, ignore this email.`,
    html: `<p>Your verification code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>It expires in 10 minutes. If you did not sign up, ignore this email.</p>`,
  });
}

module.exports = { sendOtpEmail };
