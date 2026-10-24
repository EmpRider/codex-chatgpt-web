/** The application run command uses the normal runtime; dedicated DEV commands stay isolated. */
function electronProfileArgs(root, argv = []) {
  return argv.includes("--production-profile") ? [root] : [root, "--dev-profile"];
}

module.exports = { electronProfileArgs };
