module.exports = {
  apps: [
    {
      name: "api-server",
      script: "./dist/index.mjs",
      interpreter: "node",
      exec_mode: "fork",
      node_args: "--experimental-specifier-resolution=node",
    },
  ],
};
