// Starts the GitHub OAuth web flow. Needs GITHUB_CLIENT_ID in the Vercel env.
// Scope public_repo is the minimum GitHub accepts for starring public repositories.
const crypto = require("node:crypto");

const CANONICAL_ORIGIN = process.env.HUB_ORIGIN || "https://explain-it-hub.vercel.app";

module.exports = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("Starring is not configured yet: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in the Vercel project env.");
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${CANONICAL_ORIGIN}/api/auth/callback`);
  url.searchParams.set("scope", "public_repo");
  url.searchParams.set("state", state);
  res.redirect(302, url.toString());
};
