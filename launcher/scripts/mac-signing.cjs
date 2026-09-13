function shouldVerifyMacCodeSignature(env = process.env) {
  return env.GITHUB_EVENT_NAME !== "pull_request"
    || env.CSC_FOR_PULL_REQUEST === "true";
}

module.exports = {
  shouldVerifyMacCodeSignature,
};
