module.exports = {
  apps: [
    {
      name: "odfu-upload-helper",
      script: "web.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: "21345",
        ROOT_DIR: process.env.HOME || process.env.USERPROFILE,
      },
    },
  ],
};