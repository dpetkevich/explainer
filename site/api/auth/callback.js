// Exchanges the OAuth code for a user token and hands it to the page in the
// URL fragment (never sent to any server). The token lives only in the
// visitor's browser; this function stores nothing.
module.exports = async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.cookies?.oauth_state) {
    res.status(400).send("OAuth state mismatch — start again from the homepage.");
    return;
  }
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await r.json();
  if (!data.access_token) {
    res.status(502).send(`GitHub token exchange failed: ${data.error_description || data.error || "unknown error"}`);
    return;
  }
  res.setHeader("Set-Cookie", "oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  res.redirect(302, `/#token=${encodeURIComponent(data.access_token)}`);
};
