const path = require("node:path");

const rootDir = __dirname;

module.exports = {
  apps: [
    {
      name: "power-leads-client",
      cwd: path.join(rootDir, "client"),
      script: path.join(rootDir, "node_modules", "vite", "bin", "vite.js"),
      args: "preview --host 0.0.0.0 --port 5173 --strictPort",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      kill_timeout: 10_000,
      listen_timeout: 10_000,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "power-leads-api",
      cwd: rootDir,
      script: path.join("server", "dist", "index.js"),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      kill_timeout: 15_000,
      listen_timeout: 10_000,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "power-leads-worker",
      cwd: rootDir,
      script: path.join("server", "dist", "worker.js"),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      kill_timeout: 60_000,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
