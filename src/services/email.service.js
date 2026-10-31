// Transactional email, through Brevo's HTTP API.
//
// HTTP rather than SMTP because Render's free instances block the SMTP ports.
// Like push.service, it never throws and works before it is configured:
// without BREVO_API_KEY it logs what it would have sent, so signup can be
// tested end to end before an account exists.

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log(`[email] BREVO_API_KEY not set — would send "${subject}" to ${to}:\n${html}`);
    return false;
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || "Dr. SKM's Academy" },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Brevo refused (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('[email] send failed:', error.message);
    return false;
  }
}

function sendVerificationEmail(to, link) {
  return sendEmail({
    to,
    subject: 'Verify your email',
    html: `<p>Welcome! Confirm your email address to finish creating your account:</p>
<p><a href="${link}">Verify my email</a></p>
<p>This link works for 24 hours. If you did not sign up, ignore this email.</p>`,
  });
}

module.exports = { sendVerificationEmail };
